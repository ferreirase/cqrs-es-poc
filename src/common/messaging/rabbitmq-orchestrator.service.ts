import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import * as cluster from 'node:cluster';
import { randomInt } from 'node:crypto';
import { RabbitMQService } from '../messaging/rabbitmq.service';

interface TaskPayload {
  taskId: string;
  handlerKey: string; // Identifica qual handler executar no worker
  messageContent: any; // Conteúdo da mensagem original
}

interface TaskResult {
  taskId: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class RabbitMQOrchestratorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RabbitMQOrchestratorService.name);
  // Mapeamento de queues para identificadores de handler (usados no worker)
  private readonly commandQueues = [
    {
      queue: 'withdrawal_commands_queue',
      routingKey: 'commands.withdrawal',
      handlerKey: 'WithdrawalHandler',
    },
    {
      queue: 'check_balance_commands_queue',
      routingKey: 'commands.check_balance',
      handlerKey: 'CheckAccountBalanceHandler',
    },
    {
      queue: 'reserve_balance_commands_queue',
      routingKey: 'commands.reserve_balance',
      handlerKey: 'ReserveBalanceHandler',
    },
    {
      queue: 'process_transaction_commands_queue',
      routingKey: 'commands.process_transaction',
      handlerKey: 'ProcessTransactionHandler',
    },
    {
      queue: 'confirm_transaction_commands_queue',
      routingKey: 'commands.confirm_transaction',
      handlerKey: 'ConfirmTransactionHandler',
    },
    {
      queue: 'update_statement_commands_queue',
      routingKey: 'commands.update_statement',
      handlerKey: 'UpdateAccountStatementHandler',
    },
    {
      queue: 'notify_user_commands_queue',
      routingKey: 'commands.notify_user',
      handlerKey: 'NotifyUserHandler',
    },
    {
      queue: 'release_balance_commands_queue',
      routingKey: 'commands.release_balance',
      handlerKey: 'ReleaseBalanceHandler',
    },
    // Adicione outros command handlers/queues aqui
  ];

  private activeWorkers: cluster.Worker[] = [];
  private pendingTasks = new Map<
    string,
    {
      msg: ConsumeMessage;
      worker: cluster.Worker;
      resolve: (value: unknown) => void;
      reject: (reason?: any) => void;
    }
  >();

  constructor(private readonly rabbitMQService: RabbitMQService) {}

  async onApplicationBootstrap() {
    if (cluster.default.isPrimary) {
      this.logger.log('Primary process initializing RabbitMQ subscriptions...');
      await this.initializePrimaryProcess();
    } else {
      // Workers não inicializam subscriptions, apenas recebem tarefas via IPC
      this.logger.log(`Worker ${process.pid} started, awaiting tasks via IPC.`);
    }
  }

  private async initializePrimaryProcess() {
    this.setupWorkerListeners();

    for (const q of this.commandQueues) {
      try {
        // A criação da fila ainda acontece no TransactionsModule onModuleInit (precisa garantir que só rode no primário)
        // Vamos usar o subscribe com autoAck=false
        await this.rabbitMQService.subscribe<any>(
          q.queue,
          (messageContent: any, originalMessage: ConsumeMessage) =>
            this.handleReceivedMessage(
              q.handlerKey,
              q.queue,
              messageContent,
              originalMessage,
            ),
          1, // Prefetch 1
          false, // autoAck = false -> Orquestrador controla ack/nack
        );
        this.logger.log(`Primary subscribed to queue: ${q.queue}`);
      } catch (error) {
        this.logger.error(
          `Failed to subscribe to queue ${q.queue}: ${error.message}`,
          error.stack,
        );
      }
    }
  }

  // Handler chamado pelo subscribe
  private async handleReceivedMessage(
    handlerKey: string,
    queue: string,
    messageContent: any,
    originalMessage: ConsumeMessage,
  ) {
    try {
      await this.delegateTaskToWorker(
        handlerKey,
        queue,
        messageContent,
        originalMessage,
      );
      // Se delegateTaskToWorker resolver, a mensagem foi enviada ao worker e o ack/nack será tratado no callback do worker
    } catch (delegationError) {
      // Se delegateTaskToWorker rejeitar (ex: no workers ou erro interno), o nack deve ser feito aqui
      this.logger.error(
        `Failed to delegate task from queue ${queue}: ${delegationError.message}. NACKing message.`,
      );
      try {
        this.rabbitMQService.nack(originalMessage, false, false); // Nack sem requeue
      } catch (nackError) {
        this.logger.error(
          `Failed to NACK message from ${queue} after delegation error: ${nackError.message}`,
        );
      }
    }
  }

  private setupWorkerListeners() {
    // Garante que pegamos workers já existentes se o serviço iniciar depois
    this.activeWorkers = Object.values(cluster.default.workers || {});
    this.activeWorkers.forEach(worker => {
      if (!worker.isConnected || worker.isDead()) {
        this.logger.warn(
          `Removing disconnected/dead worker ${worker.id} during initial setup.`,
        );
        this.activeWorkers = this.activeWorkers.filter(w => w.id !== worker.id);
      } else {
        this.setupMessageHandler(worker);
      }
    });

    cluster.default.on('fork', worker => {
      this.logger.log(`Worker ${worker.process.pid} forked.`);
      this.activeWorkers.push(worker);
      this.setupMessageHandler(worker);
    });

    cluster.default.on('exit', (worker, code, signal) => {
      this.logger.warn(
        `Worker ${worker.process.pid} died. Code: ${code}, Signal: ${signal}.`,
      );
      const deadWorkerId = worker.id;
      this.activeWorkers = this.activeWorkers.filter(
        w => w.id !== deadWorkerId,
      );

      // Lidar com tarefas pendentes do worker que morreu
      this.pendingTasks.forEach((task, taskId) => {
        if (task.worker.id === deadWorkerId) {
          this.logger.warn(
            `Task ${taskId} was assigned to dead worker ${deadWorkerId}. NACKing associated message.`,
          );
          try {
            this.rabbitMQService.nack(task.msg, false, false); // Nack sem requeue
          } catch (nackError) {
            this.logger.error(
              `Failed to NACK message for task ${taskId} from dead worker: ${nackError.message}`,
            );
          }
          task.reject(
            new Error(
              `Worker ${deadWorkerId} died before completing task ${taskId}`,
            ),
          );
          this.pendingTasks.delete(taskId); // Remover da lista de pendentes
        }
      });
    });

    cluster.default.on('disconnect', worker => {
      this.logger.warn(`Worker ${worker.process.pid} disconnected.`);
      // Tratar como 'exit' para remover e lidar com tasks pendentes?
      const disconnectedWorkerId = worker.id;
      this.activeWorkers = this.activeWorkers.filter(
        w => w.id !== disconnectedWorkerId,
      );
      this.pendingTasks.forEach((task, taskId) => {
        if (task.worker.id === disconnectedWorkerId) {
          // ... (lógica similar ao 'exit' para NACK e rejeitar) ...
          this.logger.warn(
            `Task ${taskId} was assigned to disconnected worker ${disconnectedWorkerId}. NACKing associated message.`,
          );
          try {
            this.rabbitMQService.nack(task.msg, false, false);
          } catch (nackError) {
            this.logger.error(
              `Failed to NACK message for task ${taskId} from disconnected worker: ${nackError.message}`,
            );
          }
          task.reject(
            new Error(
              `Worker ${disconnectedWorkerId} disconnected before completing task ${taskId}`,
            ),
          );
          this.pendingTasks.delete(taskId);
        }
      });
    });
  }

  private setupMessageHandler(worker: cluster.Worker) {
    // Remover listener antigo para evitar duplicação se chamado múltiplas vezes
    worker.removeAllListeners('message');
    worker.removeAllListeners('error');

    worker.on('message', (result: TaskResult) => {
      const task = this.pendingTasks.get(result.taskId);
      if (!task) {
        this.logger.warn(
          `Received result for unknown, timed out, or already processed task ID: ${result.taskId}`,
        );
        return;
      }

      this.logger.debug(
        `Received result for task ${result.taskId} from worker ${worker.process.pid}: Success=${result.success}`,
      );

      try {
        if (result.success) {
          this.rabbitMQService.ack(task.msg); // Usar método público
          task.resolve(true);
          this.logger.verbose(`Task ${result.taskId} ACKed successfully.`);
        } else {
          this.logger.error(
            `Task ${result.taskId} failed in worker ${worker.process.pid}: ${result.error}. NACKing message.`,
          );
          this.rabbitMQService.nack(task.msg, false, false); // Usar método público, sem requeue
          task.reject(new Error(result.error || 'Task failed in worker'));
        }
      } catch (amqpError) {
        // Se ack/nack falhar aqui, a mensagem ficará pendente no broker e será reentregue após timeout
        this.logger.error(
          `Error during ACK/NACK for task ${result.taskId} after worker response: ${amqpError.message}`,
          amqpError.stack,
        );
        // Rejeitar a promessa original para sinalizar falha no processamento final
        task.reject(amqpError);
      } finally {
        this.pendingTasks.delete(result.taskId); // Remover a tarefa da lista de pendentes
      }
    });

    worker.on('error', error => {
      this.logger.error(
        `Error event from worker ${worker.process.pid}: ${error.message}`,
        error.stack,
      );
      // Worker pode ou não morrer após um erro. O listener 'exit' cuidará se ele morrer.
    });
  }

  private delegateTaskToWorker(
    handlerKey: string,
    queue: string,
    messageContent: any,
    originalMessage: ConsumeMessage,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const availableWorkers = this.activeWorkers.filter(
        w => w.isConnected() && !w.isDead(),
      );

      if (availableWorkers.length === 0) {
        this.logger.error(
          'No active and connected workers available to delegate task.',
        );
        // Nack será feito no handleReceivedMessage que chamou esta função
        return reject(new Error('No active workers available'));
      }

      // Seleção simples (round-robin implícito ou aleatório)
      const workerIndex = randomInt(availableWorkers.length);
      const selectedWorker = availableWorkers[workerIndex];
      const taskId = `${queue}-${
        originalMessage.fields.deliveryTag
      }-${Date.now()}-${randomInt(1000)}`;

      const taskPayload: TaskPayload = {
        taskId,
        handlerKey,
        messageContent,
      };

      // Guardar a mensagem original para ack/nack futuro
      this.pendingTasks.set(taskId, {
        msg: originalMessage,
        worker: selectedWorker,
        resolve,
        reject,
      });

      this.logger.debug(
        `Delegating task ${taskId} (queue: ${queue}, handler: ${handlerKey}) to worker ${selectedWorker.process.pid}`,
      );

      selectedWorker.send(taskPayload, error => {
        if (error) {
          this.logger.error(
            `Failed to send task ${taskId} to worker ${selectedWorker.process.pid}: ${error.message}`,
            error.stack,
          );
          // Se falhou ao enviar, remover task pendente e rejeitar a promessa (causará NACK no handler)
          this.pendingTasks.delete(taskId);
          reject(new Error(`Failed to send task to worker: ${error.message}`));
        } else {
          // Envio bem sucedido, a promessa resolverá/rejeitará quando o worker responder
          this.logger.verbose(
            `Task ${taskId} sent successfully to worker ${selectedWorker.process.pid}`,
          );
          // O resolve original da Promise é chamado pelo message handler do worker
        }
      });

      // Implementar timeout para tasks? Opcional.
      // setTimeout(() => {
      //   if (this.pendingTasks.has(taskId)) {
      //     const taskInfo = this.pendingTasks.get(taskId);
      //     this.logger.warn(`Task ${taskId} timed out waiting for worker ${taskInfo?.worker.process.pid}. NACKing.`);
      //     try {
      //         this.rabbitMQService.nack(originalMessage, false, false);
      //     } catch (nackError) {
      //         this.logger.error(`Error NACKing timed out task ${taskId}: ${nackError.message}`);
      //     }
      //     taskInfo?.reject(new Error(`Task ${taskId} timed out`));
      //     this.pendingTasks.delete(taskId);
      //   }
      // }, 60000); // Timeout de 60 segundos
    });
  }
}
