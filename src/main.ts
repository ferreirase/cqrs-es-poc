import {
  INestApplicationContext,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import process from 'node:process';
import { AppModule } from './app.module';
import { RabbitMQOrchestratorService } from './common/messaging/rabbitmq-orchestrator.service';
import { CheckAccountBalanceHandler } from './transactions/commands/handlers/check-account-balance.handler';
import { ConfirmTransactionHandler } from './transactions/commands/handlers/confirm-transaction.handler';
import { NotifyUserHandler } from './transactions/commands/handlers/notify-user.handler';
import { ProcessTransactionHandler } from './transactions/commands/handlers/process-transaction.handler';
import { ReleaseBalanceHandler } from './transactions/commands/handlers/release-balance.handler';
import { ReserveBalanceHandler } from './transactions/commands/handlers/reserve-balance.handler';
import { UpdateAccountStatementHandler } from './transactions/commands/handlers/update-account-statement.handler';
import { WithdrawalHandler } from './transactions/commands/handlers/withdrawal.handler';
import { TransactionsModule } from './transactions/transactions.module';

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

// Mapa de handlerKey (string) para a CLASSE do handler
const handlerClassMap = {
  WithdrawalHandler,
  CheckAccountBalanceHandler,
  ReserveBalanceHandler,
  ProcessTransactionHandler,
  ConfirmTransactionHandler,
  UpdateAccountStatementHandler,
  NotifyUserHandler,
  ReleaseBalanceHandler,
};

// Mapa de handlerKey (string) para o NOME DO MÉTODO a ser chamado
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
  console.log('>>> [Primary] Entering bootstrapPrimary function.');
  const app = await NestFactory.createApplicationContext(AppModule);
  console.log('>>> [Primary] Application context created.');
  const orchestrator = app.get(RabbitMQOrchestratorService);
  if (!orchestrator) {
    console.error(
      '>>> [Primary] CRITICAL: Failed to get RabbitMQOrchestratorService instance!',
    );
    process.exit(1);
  }
  console.log(
    '>>> [Primary] Orchestrator instance obtained. Initialization should follow.',
  );
}

if (cluster.isPrimary) {
  console.log('>>> Starting Primary Process...');
  const numCPUs = availableParallelism();
  console.log(`>>> [Primary] Starting ${numCPUs} workers...`);

  Logger.log(
    `Primary ${process.pid} is running, starting ${numCPUs} workers...`,
  );

  // Inicializar o orquestrador no primário
  bootstrapPrimary().catch(err => {
    console.error(`>>> [Primary] Bootstrap failed: ${err.message}`, err.stack);
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
  console.log(`>>> Starting Worker Process ${process.pid}...`);
  Logger.log(`Worker ${process.pid} starting...`);

  bootstrapWorker()
    .then(async appInstance => {
      Logger.log(`Worker ${process.pid} bootstrapped.`);
      console.log(
        `>>> [Worker ${process.pid}] Bootstrap complete. IPC listener setup.`,
      );

      // Não precisa mais pré-buscar o WithdrawalHandler aqui, faremos sob demanda

      console.log(`>>> [Worker ${process.pid}] Setting up IPC listener.`);
      process.on('message', async (task: TaskPayload) => {
        console.log(
          `>>> [Worker ${process.pid}] IPC message received. Task ID: ${task.taskId}, Handler Key: ${task.handlerKey}`,
        );

        let messageData = task.messageContent;
        if (typeof messageData === 'string') {
          try {
            messageData = JSON.parse(messageData);
          } catch (parseError) {
            console.error(
              `>>> [Worker ${process.pid}] FAILED to parse message content string: ${parseError.message}`,
            );
            Logger.error(
              `[Worker ${process.pid}] Error parsing IPC message content: ${parseError.message}`,
              parseError.stack,
              { originalContent: task.messageContent },
            );
            // Enviar falha de volta? Ou apenas logar e falhar a execução?
            // Por agora, vamos deixar a execução falhar abaixo.
          }
        }

        Logger.debug(
          `[Worker ${process.pid}] Parsed/Final task content:`,
          messageData,
        );

        let result: TaskResult;
        let handlerInstance: any;
        try {
          const HandlerClass = handlerClassMap[task.handlerKey];
          const methodName = handlerMethodMap[task.handlerKey];

          if (!HandlerClass) {
            throw new Error(
              `No Handler CLASS mapped for handler key: ${task.handlerKey}`,
            );
          }
          if (!methodName) {
            throw new Error(
              `No Handler METHOD mapped for handler key: ${task.handlerKey}`,
            );
          }

          // Obter a instância do handler SEMPRE via TransactionsModule
          try {
            const transactionsModuleRef =
              appInstance.select(TransactionsModule);
            handlerInstance = transactionsModuleRef.get(HandlerClass, {
              strict: false,
            });
            console.log(
              `>>> [Worker ${process.pid}] Successfully got instance for ${task.handlerKey} via module.`,
            );
          } catch (moduleGetError) {
            console.error(
              `>>> [Worker ${process.pid}] CRITICAL: Failed to get ${task.handlerKey} instance via module: ${moduleGetError.message}`,
              moduleGetError.stack,
            );
            // Se não conseguir obter via módulo, é um erro fatal de configuração
            throw new Error(
              `Failed to resolve ${task.handlerKey} from TransactionsModule: ${moduleGetError.message}`,
            );
          }

          if (
            !handlerInstance ||
            typeof handlerInstance[methodName] !== 'function'
          ) {
            // Este erro agora é menos provável, mas mantido como segurança
            throw new Error(
              `Handler instance obtained, but method ${task.handlerKey}.${methodName} not found or not a function.`,
            );
          }

          Logger.log(
            `[Worker ${process.pid}] Invoking ${task.handlerKey}.${methodName} for task ${task.taskId}`,
          );
          await handlerInstance[methodName](messageData);

          // Se chegou aqui, sucesso
          result = { taskId: task.taskId, success: true };
          console.log(
            `>>> [Worker ${process.pid}] Task ${task.taskId} completed successfully.`,
          );
        } catch (error) {
          Logger.error(
            `[Worker ${process.pid}] Error processing task ${task.taskId} (${task.handlerKey}): ${error.message}`,
            error.stack,
            { messageData },
          );
          result = {
            taskId: task.taskId,
            success: false,
            error: error.message,
          };
          console.error(
            `>>> [Worker ${process.pid}] Task ${task.taskId} FAILED: ${error.message}`,
          );
        }

        // Enviar resultado de volta para o processo primário
        process.send(result);
      });

      // Sinalizar que o worker está pronto
      if (process.send) {
        process.send({ status: 'ready', pid: process.pid });
        console.log(
          `>>> [Worker ${process.pid}] Sent ready signal to primary.`,
        );
      }
    })
    .catch(err => {
      Logger.error(
        `Worker ${process.pid} failed to bootstrap: ${err.message}`,
        err.stack,
      );
      process.exit(1);
    });
}
