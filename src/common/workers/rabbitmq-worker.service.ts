import { Injectable, Logger } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import { RabbitMQService } from '../messaging/rabbitmq.service';
import { WorkerThreadService } from './worker-thread.service';

@Injectable()
export class RabbitMQWorkerService {
  private readonly logger = new Logger(RabbitMQWorkerService.name);
  private readonly messageHandlers = new Map<string, Function>();

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly workerThreadService: WorkerThreadService,
  ) {}

  /**
   * Registra um handler para uma fila específica e configura o consumo através de worker threads
   * @param queue Nome da fila
   * @param handler Função que manipula as mensagens
   */
  public async registerQueueWorker<T>(
    queue: string,
    handler: (message: T, originalMessage: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    this.logger.log(`Registering worker-based handler for queue '${queue}'`);

    // Armazenar o handler original para uso em cenários de fallback
    this.messageHandlers.set(queue, handler);

    try {
      // Usar o método subscribe do RabbitMQService, mas modificando o handler
      // para que envie a mensagem para o pool de workers
      await this.rabbitMQService.subscribe<T>(
        queue,
        async (message: T, originalMessage: ConsumeMessage) => {
          try {
            // Enfileirar a tarefa para processamento em worker threads
            await this.workerThreadService.queueTask(queue, {
              content: message,
              properties: {
                deliveryTag: originalMessage.fields.deliveryTag,
                messageId: originalMessage.properties.messageId,
                correlationId: originalMessage.properties.correlationId,
                replyTo: originalMessage.properties.replyTo,
                timestamp: originalMessage.properties.timestamp,
              },
            });

            // O serviço RabbitMQService já faz o ack/nack após chamar o handler
          } catch (error) {
            this.logger.error(
              `Error queueing message from ${queue} to worker: ${error.message}`,
            );

            // Em caso de erro, chamar o handler original diretamente como fallback
            await handler(message, originalMessage);
          }
        },
      );

      this.logger.log(`Worker-based consumer registered for queue: ${queue}`);
    } catch (error) {
      this.logger.error(
        `Error registering worker-based consumer for queue ${queue}: ${error.message}`,
      );
      throw error;
    }
  }
}
