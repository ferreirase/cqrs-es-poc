import {
  INestApplicationContext,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { availableParallelism } from 'node:os';
import * as process from 'node:process';
import { AppModule } from './app.module';
import { RabbitMQOrchestratorService } from './common/messaging/rabbitmq-orchestrator.service';
const cluster = require('node:cluster');

// Interfaces para comunicação IPC
interface TaskPayload {
  taskId: string;
  handlerKey: string;
  messageContent: any;
}

interface TaskResult {
  taskId: string;
  success: boolean;
  error?: string;
}

// Mapeamento de handlerKey para método (poderia ser mais robusto)
// Assumindo que os handlers de comando têm um método padrão, ex: handleCommand
// ou mapear explicitamente: handlerKey -> classe -> método
const handlerMethodMap = {
  WithdrawalHandler: 'consumeWithdrawalCommand',
  CheckAccountBalanceHandler: 'handleCheckBalanceCommand',
  ReserveBalanceHandler: 'handleReserveBalanceCommand',
  ProcessTransactionHandler: 'handleProcessTransactionCommand',
  ConfirmTransactionHandler: 'handleConfirmTransactionCommand',
  UpdateAccountStatementHandler: 'handleUpdateStatementCommand',
  NotifyUserHandler: 'handleNotifyUserCommand',
  ReleaseBalanceHandler: 'handleReleaseBalanceCommand',
};

async function bootstrapWorker(): Promise<INestApplicationContext> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe());

  app.getHttpAdapter().get('/health', (_, res) => {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Inicializar a aplicação (necessário para DI)
  await app.init();

  // Iniciar o listener HTTP
  await app.listen(3001, () => {
    Logger.log(
      `Worker ${process.pid} Application is running on: http://localhost:3001`,
    );
  });

  return app; // Retorna a instância para acesso ao container DI
}

async function bootstrapPrimary() {
  // Cria uma instância do app sem iniciar o servidor HTTP, apenas para DI
  const app = await NestFactory.createApplicationContext(AppModule);
  Logger.log('[Primary] Application context created.');

  // Obter o serviço orquestrador e inicializá-lo
  const orchestrator = app.get(RabbitMQOrchestratorService);
  if (!orchestrator) {
    Logger.error(
      '[Primary] Failed to get RabbitMQOrchestratorService instance!',
    );
    process.exit(1);
  }
  // O onApplicationBootstrap do orchestrator será chamado automaticamente pela inicialização do contexto
  Logger.log('[Primary] RabbitMQOrchestratorService should be initializing...');

  // Opcional: Fechar o contexto após um tempo ou evento se ele não for mais necessário?
  // await app.close();
}

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();

  Logger.log(
    `Primary ${process.pid} is running, starting ${numCPUs} workers...`,
  );

  // Inicializar o orquestrador no primário
  bootstrapPrimary().catch(err => {
    Logger.error(
      `[Primary] Failed to initialize orchestrator: ${err.message}`,
      err.stack,
    );
    process.exit(1);
  });

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    Logger.warn(
      `Worker ${worker.process.pid} died with code ${code} and signal ${signal}. Forking a new one...`,
    );
    // A lógica de NACK das tasks pendentes está no orchestrator
    cluster.fork(); // Fork a new worker when one dies
  });
} else {
  // Worker process
  Logger.log(`Worker ${process.pid} starting...`);

  bootstrapWorker()
    .then(appInstance => {
      Logger.log(`Worker ${process.pid} bootstrapped and listening for tasks.`);

      process.on('message', async (task: TaskPayload) => {
        Logger.debug(
          `Worker ${process.pid} received task: ${task.taskId} for handler ${task.handlerKey}`,
        );

        let result: TaskResult;
        try {
          // Encontrar o nome do método baseado no handlerKey
          const methodName = handlerMethodMap[task.handlerKey];
          if (!methodName) {
            throw new Error(
              `No method mapped for handler key: ${task.handlerKey}`,
            );
          }

          // Obter a instância do handler do container DI do worker
          // Precisamos importar os tipos dos handlers ou usar appInstance.get<any>(...) com string
          const handlerInstance = appInstance.get(task.handlerKey);
          if (
            !handlerInstance ||
            typeof handlerInstance[methodName] !== 'function'
          ) {
            throw new Error(
              `Handler instance or method ${task.handlerKey}.${methodName} not found in worker DI container.`,
            );
          }

          // Executar o handler
          await handlerInstance[methodName](task.messageContent);

          result = { taskId: task.taskId, success: true };
          Logger.debug(
            `Worker ${process.pid} completed task ${task.taskId} successfully.`,
          );
        } catch (error) {
          Logger.error(
            `Worker ${process.pid} failed task ${task.taskId}: ${error.message}`,
            error.stack,
          );
          result = {
            taskId: task.taskId,
            success: false,
            error: error.message,
          };
        }

        // Enviar resultado de volta para o processo primário
        if (process.send) {
          // Verificar se send existe (pode não existir em alguns cenários)
          process.send(result);
        } else {
          Logger.error(
            `Worker ${process.pid} cannot send result for task ${task.taskId}: process.send is undefined.`,
          );
        }
      });

      process.on('uncaughtException', err => {
        Logger.error(
          `[Worker ${process.pid}] Uncaught Exception: ${err.message}`,
          err.stack,
        );
        // Considerar sair do processo worker para ser reiniciado pelo primário
        process.exit(1);
      });

      process.on('unhandledRejection', (reason, promise) => {
        Logger.error(
          `[Worker ${process.pid}] Unhandled Rejection at:`,
          promise,
          'reason:',
          reason,
        );
        // Considerar sair do processo worker
        process.exit(1);
      });
    })
    .catch(err => {
      Logger.error(
        `[Worker ${process.pid}] Failed to bootstrap: ${err.message}`,
        err.stack,
      );
      process.exit(1); // Sair se o bootstrap falhar
    });
}
