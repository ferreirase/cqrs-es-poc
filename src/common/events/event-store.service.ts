import {
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConsumeMessage } from 'amqplib';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQService } from '../messaging/rabbitmq.service';
import { EventEntity } from './event.entity';
import { IEvent } from './event.interface';

@Injectable()
export class EventStoreService implements OnModuleInit {
  private readonly logger = new Logger(EventStoreService.name);

  constructor(
    @InjectRepository(EventEntity)
    private eventRepository: Repository<EventEntity>,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async onModuleInit() {
    try {
      await this.rabbitMQService.createQueueAndBind(
        'events',
        ['transaction.*', 'account.*'],
        { durable: true },
      );

      await this.rabbitMQService.subscribe<any>(
        'events',
        this.handleTransactionEvent.bind(this),
      );

      this.logger.log('Successfully subscribed to transaction events queue');
    } catch (error) {
      this.logger.error(
        `Failed to initialize TransactionsService: ${error.message}`,
      );
      throw new HttpException(
        `Failed to initialize TransactionsService: ${error.message}`,
        500,
      );
    }
  }

  public handleTransactionEvent(data: string, amqpMsg: ConsumeMessage) {
    const { routingKey } = amqpMsg.fields;
    const parsedData = JSON.parse(data);

    try {
      this.saveEvent(routingKey, parsedData, parsedData.id);
      this.logger.log(`Successfully processed event: ${routingKey}`);
    } catch (error) {
      this.logger.error(
        `Error processing transaction event: ${error.message}`,
        {
          transactionId: parsedData.id,
          routingKey,
          error,
        },
      );
      throw new HttpException(
        `Error processing transaction event: ${error.message}`,
        500,
      );
    }
  }

  saveEvent(eventType: string, data: JSON, aggregateId: string): IEvent {
    const event: IEvent = {
      id: uuidv4(),
      type: eventType,
      timestamp: new Date(),
      data: data,
    };

    const eventEntity = this.eventRepository.create({
      id: event.id,
      type: eventType,
      timestamp: event.timestamp,
      data: JSON.stringify(data),
      aggregateId,
    });

    this.eventRepository.save(eventEntity);

    return event;
  }

  async getEventsByAggregateId(aggregateId: string): Promise<IEvent[]> {
    const events = await this.eventRepository.find({
      where: { aggregateId },
      order: { timestamp: 'ASC' },
    });

    return events.map(event => ({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      data: JSON.parse(event.data),
    }));
  }
}
