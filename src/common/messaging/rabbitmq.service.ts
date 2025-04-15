import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleInit {
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(
    @Inject(AmqpConnection) private readonly amqpConnection: AmqpConnection,
  ) {}

  /**
   * Retorna o status da conexão AMQP.
   */
  public get isConnected(): boolean {
    // Acessa a conexão injetada pela biblioteca @golevelup
    // Pode ser necessário ajustar dependendo da versão exata e API
    try {
      return this.amqpConnection?.managedConnection?.isConnected() ?? false;
    } catch (e) {
      this.logger.warn(
        `Error checking RabbitMQ connection status: ${e.message}`,
      );
      return false;
    }
  }

  /**
   * Configura o prefetch count globalmente quando o módulo iniciar
   */
  async onModuleInit() {
    try {
      // Definir prefetch count para 1 no nível do canal
      // Isso limita cada consumidor a pegar apenas 1 mensagem por vez
      await this.setPrefetchCount(2);
    } catch (error) {
      this.logger.error('Failed to set RabbitMQ prefetch count', error.message);
    }
  }

  /**
   * Set the prefetch count for the current channel
   * @param count Number of messages to prefetch at once
   * @param isGlobal Whether the setting applies per consumer (false) or globally (true)
   */
  async setPrefetchCount(
    count: number,
    isGlobal: boolean = false,
  ): Promise<void> {
    try {
      await this.amqpConnection.channel.prefetch(count, isGlobal);
      this.logger.log(
        `RabbitMQ prefetch count set to ${count} (${
          isGlobal ? 'global' : 'per consumer'
        })`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to set RabbitMQ prefetch count to ${count}:`,
        error.message,
      );
      throw new HttpException(
        `Failed to set RabbitMQ prefetch count: ${error.message}`,
        500,
      );
    }
  }

  /**
   * Publish a message to a specific queue using the configured exchange
   * @param queue The queue name
   * @param routingKey The routing key
   * @param message The message payload
   * @param options Additional publishing options
   */
  async publish<T>(
    queue: string,
    routingKey: string,
    message: T,
    options?: {
      persistent?: boolean;
      headers?: any;
      expiration?: string;
      exchangeName?: string; // Add this
    },
  ): Promise<void> {
    try {
      const exchange = options?.exchangeName || 'paymaker-exchange';
      await this.amqpConnection.publish(
        exchange,
        routingKey,
        JSON.stringify(message),
        {
          persistent: options?.persistent ?? true,
          headers: options?.headers,
          expiration: options?.expiration,
        },
      );

      this.logger.debug(
        `Published message to queue: ${queue}, routingKey: ${routingKey}`,
      );
    } catch (error) {
      this.logger.error(
        `Error publishing message to queue ${queue}`,
        error.message,
      );
      throw new HttpException(
        `Error publishing message to queue ${queue}: ${error.message}`,
        500,
      );
    }
  }

  /**
   * Publish a message to the exchange with a routing key
   * @param routingKey The routing key
   * @param message The message payload
   * @param options Additional publishing options
   */
  async publishToExchange<T>(
    routingKey: string,
    message: T,
    options?: {
      persistent?: boolean;
      headers?: any;
      expiration?: string;
      exchangeName?: string; // Adicionado opção para definir nome da exchange
    },
  ): Promise<void> {
    try {
      // Use the exchange configured in the module
      const exchangeName = options?.exchangeName || 'paymaker-exchange';

      await this.amqpConnection.publish(
        exchangeName, // CORRIGIDO: usar a exchange configurada em vez de string vazia
        routingKey,
        JSON.stringify(message),
        {
          persistent: options?.persistent ?? true,
          headers: options?.headers,
          expiration: options?.expiration,
        },
      );

      this.logger.debug(
        `Published message to exchange ${exchangeName} with routingKey: ${routingKey}`,
      );
    } catch (error) {
      this.logger.error(
        `Error publishing message to exchange with routing key ${routingKey}`,
        error.message,
      );
      throw new HttpException(
        `Error publishing message to exchange with routing key ${routingKey}: ${error.message}`,
        500,
      );
    }
  }

  /**
   * Subscribe to a queue and process messages
   * NOTE: This default implementation handles ack/nack internally.
   * For the orchestrator pattern, the handler passed should NOT ack/nack.
   */
  async subscribe<T>(
    queue: string,
    handler: (message: T, originalMessage: ConsumeMessage) => Promise<void>,
    prefetchCount: number = 1, // Default prefetch 1 para orquestrador
    autoAck: boolean = true, // Flag para controlar ack/nack automático
  ): Promise<void> {
    try {
      await this.amqpConnection.channel.assertQueue(queue, { durable: true });
      await this.setPrefetchCount(prefetchCount);
      this.logger.debug(
        `Set prefetch count to ${prefetchCount} for queue: ${queue}`,
      );

      await this.amqpConnection.channel.consume(
        queue,
        async (msg: ConsumeMessage | null) => {
          if (!msg) return;

          try {
            const content = JSON.parse(msg.content.toString()) as T;
            await handler(content, msg); // Passar o originalMessage para o handler
            if (autoAck) {
              this.ack(msg); // Ack automático se autoAck for true
            }
          } catch (error) {
            this.logger.error(
              `Error processing message from queue ${queue}: ${error.message}`,
              error.stack,
            );
            if (autoAck) {
              this.nack(msg, false, false); // Nack automático (sem requeue) se autoAck for true
            }
            // Se autoAck for false, o handler é responsável pelo ack/nack
            // A rejeição da promessa do handler pode ser usada para NACK pelo chamador (orquestrador)
            else {
              throw error; // Re-lançar o erro para o chamador (orquestrador) lidar com NACK
            }
          }
        },
        { noAck: false }, // Sempre usar ack manual (noAck: false)
      );

      this.logger.debug(`Subscribed to queue: ${queue}`);
    } catch (error) {
      this.logger.error(
        `Error subscribing to queue ${queue}: ${error.message}`,
      );
      throw new HttpException(
        `Error subscribing to queue ${queue}: ${error.message}`,
        500,
      );
    }
  }

  /**
   * Acknowledge a message.
   * @param message The original message received from RabbitMQ.
   */
  public ack(message: ConsumeMessage): void {
    try {
      this.amqpConnection.channel.ack(message);
      this.logger.verbose(
        `Message ACKed: deliveryTag=${message.fields.deliveryTag}`,
      );
    } catch (error) {
      this.logger.error(`Failed to ACK message: ${error.message}`, error.stack);
      // O que fazer aqui? A mensagem pode ser reprocessada.
      // Lançar erro pode parar o consumidor dependendo de como é chamado.
      throw error; // Re-lançar para indicar falha no ack
    }
  }

  /**
   * Reject a message.
   * @param message The original message received from RabbitMQ.
   * @param allUpTo If true, reject all messages up to this one.
   * @param requeue If true, the message will be requeued.
   */
  public nack(
    message: ConsumeMessage,
    allUpTo: boolean = false,
    requeue: boolean = false,
  ): void {
    try {
      this.amqpConnection.channel.nack(message, allUpTo, requeue);
      this.logger.warn(
        `Message NACKed: deliveryTag=${message.fields.deliveryTag}, requeue=${requeue}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to NACK message: ${error.message}`,
        error.stack,
      );
      throw error; // Re-lançar para indicar falha no nack
    }
  }

  /**
   * Create a queue and bind it to the exchange with a routing key
   * @param queue The queue name
   * @param routingKey The routing key or array of routing keys
   * @param options Queue options
   */
  async createQueueAndBind(
    queue: string,
    routingKey: string | string[],
    options: {
      durable?: boolean;
      exclusive?: boolean;
      autoDelete?: boolean;
      deadLetterExchange?: string;
      messageTtl?: number;
      exchangeName?: string; // Add this parameter
    } = {},
  ): Promise<void> {
    try {
      const queueOptions = {
        durable: options.durable ?? true,
        exclusive: options.exclusive ?? false,
        autoDelete: options.autoDelete ?? false,
        arguments: {
          'x-message-ttl': options.messageTtl,
          'x-dead-letter-exchange': options.deadLetterExchange,
        },
      };

      await this.amqpConnection.channel.assertQueue(queue, queueOptions);

      // Use the exchange name from options or the default one from your module
      const exchangeName = options.exchangeName || 'paymaker-exchange';
      const routingKeys = Array.isArray(routingKey) ? routingKey : [routingKey];

      for (const key of routingKeys) {
        await this.amqpConnection.channel.bindQueue(queue, exchangeName, key);
        this.logger.debug(
          `Queue ${queue} bound to exchange ${exchangeName} with routing key ${key}`,
        );
      }
    } catch (error) {
      this.logger.error('Error creating queue/binding', error.message);
      throw new HttpException(
        `Error creating queue/binding: ${error.message}`,
        500,
      );
    }
  }
}
