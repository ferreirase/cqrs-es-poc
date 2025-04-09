import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';

@Injectable()
export class RabbitMQService {
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(
    @Inject(AmqpConnection) private readonly amqpConnection: AmqpConnection,
  ) {}

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
   * @param queue The queue name
   * @param handler The function to process messages
   */
  async subscribe<T>(
    queue: string,
    handler: (message: T, originalMessage: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    try {
      await this.amqpConnection.channel.assertQueue(queue, { durable: true });

      await this.amqpConnection.channel.consume(
        queue,
        async (msg: any) => {
          if (!msg) return;

          try {
            const content = JSON.parse(msg.content.toString()) as T;
            await handler(content, msg);
            this.amqpConnection.channel.ack(msg);
          } catch (error) {
            this.logger.error(
              `Error processing message from queue ${queue}`,
              error.message,
            );
            this.amqpConnection.channel.nack(msg, false, false);
          }
        },
        { noAck: false },
      );

      this.logger.debug(`Subscribed to queue: ${queue}`);
    } catch (error) {
      this.logger.error(`Error subscribing to queue ${queue}`, error.message);
      throw new HttpException(
        `Error subscribing to queue ${queue}: ${error.message}`,
        500,
      );
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
