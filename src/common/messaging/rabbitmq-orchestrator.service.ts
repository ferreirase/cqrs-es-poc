import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import cluster, { Worker } from 'node:cluster';
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

  private activeWorkers: Worker[] = [];
  private pendingTasks = new Map<
    string,
    {
      msg: ConsumeMessage;
      worker: Worker;
      resolve: (value: unknown) => void;
      reject: (reason?: any) => void;
    }
  >();

  constructor(private readonly rabbitMQService: RabbitMQService) {}

  async onApplicationBootstrap() {
    console.log('>>> [Orchestrator] Entering onApplicationBootstrap.'); // Log Simples
    if (cluster.isPrimary) {
      console.log('>>> [Orchestrator] Determined to be Primary process.'); // Log Simples
      this.logger.log(
        '[Orchestrator] Primary process initializing RabbitMQ subscriptions...',
      );
      await this.initializePrimaryProcess();
    } else {
      console.log(
        '>>> [Orchestrator] Determined to be Worker process. Skipping init.',
      ); // Log Simples
      this.logger.log(
        `[Orchestrator] Worker ${process.pid} started, awaiting tasks via IPC.`,
      );
    }
  }

  private async initializePrimaryProcess() {
    console.log('>>> [Orchestrator] Entering initializePrimaryProcess.');
    this.setupWorkerListeners();

    // Verificar status da conexão antes de subscrever
    const connected = this.rabbitMQService.isConnected;
    console.log(
      `>>> [Orchestrator] RabbitMQ Connection Status Check: ${connected}`,
    );
    if (!connected) {
      console.error(
        '>>> [Orchestrator] CRITICAL: RabbitMQ is not connected! Cannot subscribe.',
      );
      // Poderia tentar reconectar ou sair, dependendo da estratégia
      return;
    }

    console.log(
      '>>> [Orchestrator] Starting subscription loop with REAL callback...',
    );
    for (const q of this.commandQueues) {
      console.log(
        `>>> [Orchestrator] Preparing to subscribe to queue: ${q.queue} with REAL callback.`,
      );
      try {
        await this.rabbitMQService.subscribe<any>(
          q.queue,
          // Restaurar o callback original que delega a tarefa
          (messageContent: any, originalMessage: ConsumeMessage) =>
            this.handleReceivedMessage(
              q.handlerKey,
              q.queue,
              messageContent,
              originalMessage,
            ),
          1, // Prefetch 1
          false, // autoAck = false
        );
        this.logger.log(
          `[Orchestrator] Primary subscribed to queue: ${q.queue} with REAL callback.`,
        );
      } catch (error) {
        this.logger.error(
          `[Orchestrator] Failed to subscribe to queue ${q.queue}: ${error.message}`,
          error.stack,
        );
        console.error(
          `>>> [Orchestrator] ERROR subscribing to ${q.queue}: ${error.message}`,
        ); // Log Simples
      }
    }
    console.log(
      '>>> [Orchestrator] Finished subscription loop with REAL callback.',
    );
  }

  // Handler chamado pelo subscribe
  private async handleReceivedMessage(
    handlerKey: string,
    queue: string,
    messageContent: any,
    originalMessage: ConsumeMessage,
  ) {
    console.log(
      `>>> [Orchestrator] handleReceivedMessage called for queue ${queue}, handler ${handlerKey}.`,
    );
    try {
      await this.delegateTaskToWorker(
        handlerKey,
        queue,
        messageContent,
        originalMessage,
      );
      console.log(
        `>>> [Orchestrator] delegateTaskToWorker promise resolved for queue ${queue}. Waiting for worker result.`,
      );
      // Se a delegação for bem-sucedida, NÃO fazemos ack/nack aqui. Esperamos a resposta do worker.
    } catch (delegationError) {
      console.error(
        `>>> [Orchestrator] delegateTaskToWorker promise REJECTED for queue ${queue}: ${delegationError.message}. NACKing.`,
      );
      this.logger.error(
        `[Orchestrator] Failed to delegate task from queue ${queue}: ${delegationError.message}. NACKing message.`,
      );
      // NACK aqui apenas se a *delegação* (envio IPC ou encontrar worker) falhar
      try {
        this.rabbitMQService.nack(originalMessage, false, false);
      } catch (nackError) {
        this.logger.error(
          `[Orchestrator] Failed to NACK message from ${queue} after delegation error: ${nackError.message}`,
        );
      }
    }
  }

  private setupWorkerListeners() {
    // Garante que pegamos workers já existentes se o serviço iniciar depois
    this.activeWorkers = Object.values(cluster.workers || {});
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

    cluster.on('fork', worker => {
      this.logger.log(`Worker ${worker.process.pid} forked.`);
      this.activeWorkers.push(worker);
      this.setupMessageHandler(worker);
    });

    cluster.on('exit', (worker, code, signal) => {
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

    cluster.on('disconnect', worker => {
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

    this.activeWorkers.forEach(worker => this.setupMessageHandler(worker));
  }

  // Este handler recebe a resposta do worker e faz o ack/nack final
  private setupMessageHandler(worker: Worker) {
    worker.removeAllListeners('message');
    worker.removeAllListeners('error');

    worker.on('message', (result: TaskResult) => {
      const task = this.pendingTasks.get(result.taskId);
      if (!task) {
        this.logger.warn(
          `[Orchestrator] Received result for unknown/processed task ID: ${result.taskId}`,
        );
        return;
      }

      // Logar resultado recebido
      this.logger.log(
        `[Orchestrator] Received result for task ${result.taskId} from worker ${worker.process.pid}:`,
        result,
      );

      try {
        if (result.success) {
          this.logger.verbose(
            `[Orchestrator] Task ${result.taskId} succeeded in worker. ACKing RabbitMQ message.`,
          );
          this.rabbitMQService.ack(task.msg);
          task.resolve(true);
        } else {
          this.logger.error(
            `[Orchestrator] Task ${result.taskId} failed in worker: ${result.error}. NACKing RabbitMQ message (no requeue).`,
          );
          this.rabbitMQService.nack(task.msg, false, false); // NACK aqui, baseado no resultado do worker
          task.reject(new Error(result.error || 'Task failed in worker'));
        }
      } catch (amqpError) {
        this.logger.error(
          `[Orchestrator] Error during ACK/NACK for task ${result.taskId} after worker response: ${amqpError.message}`,
          amqpError.stack,
        );
        task.reject(amqpError);
      } finally {
        this.pendingTasks.delete(result.taskId);
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
    console.log(
      `>>> [Orchestrator] Entering delegateTaskToWorker for queue ${queue}.`,
    );
    return new Promise((resolve, reject) => {
      const availableWorkers = this.activeWorkers.filter(
        w => w.isConnected() && !w.isDead(),
      );
      if (availableWorkers.length === 0) {
        console.error('>>> [Orchestrator] No active workers.');
        return reject(new Error('No active workers available'));
      }
      const workerIndex = randomInt(availableWorkers.length);
      const selectedWorker = availableWorkers[workerIndex];
      const taskId = `${queue}-${
        originalMessage.fields.deliveryTag
      }-${Date.now()}-${randomInt(1000)}`;

      // !! MUDANÇA AQUI: Enviar apenas o PAYLOAD para o worker !!
      // Verificar se messageContent tem a estrutura esperada
      let payloadToSend = messageContent; // Default se não tiver .payload
      if (
        messageContent &&
        typeof messageContent === 'object' &&
        messageContent.hasOwnProperty('payload')
      ) {
        payloadToSend = messageContent.payload;
        console.log(
          `>>> [Orchestrator] Extracted payload to send for task ${taskId}.`,
        );
      } else {
        console.warn(
          `>>> [Orchestrator] Message content for task ${taskId} does not have a 'payload' property. Sending content as is.`,
        );
      }

      const taskPayload: TaskPayload = {
        taskId,
        handlerKey,
        messageContent: payloadToSend, // Enviar o payload extraído (ou o conteúdo original)
      };

      this.pendingTasks.set(taskId, {
        msg: originalMessage,
        worker: selectedWorker,
        resolve,
        reject,
      });
      console.log(
        `>>> [Orchestrator] Prepared task ${taskId}. Attempting to send to worker ${selectedWorker.process.pid}.`,
      );

      selectedWorker.send(taskPayload, error => {
        if (error) {
          console.error(
            `>>> [Orchestrator] FAILED to send task ${taskId} to worker ${selectedWorker.process.pid}: ${error.message}`,
          );
          this.logger.error(
            `[Orchestrator] Failed to send task ${taskId}: ${error.message}`,
            error.stack,
          );
          this.pendingTasks.delete(taskId);
          reject(new Error(`Failed to send task to worker: ${error.message}`));
        } else {
          console.log(
            `>>> [Orchestrator] SUCCESSFULLY sent task ${taskId} to worker ${selectedWorker.process.pid}.`,
          );
          // A promessa AGORA resolve, indicando que o envio foi bem-sucedido.
          // O resultado real da tarefa virá pela mensagem do worker.
          resolve();
        }
      });
    });
  }
}
