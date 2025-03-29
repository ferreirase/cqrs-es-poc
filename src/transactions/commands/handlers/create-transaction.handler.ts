import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Counter } from '@opentelemetry/api';
import { MetricService, Span } from 'nestjs-otel';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { TransactionCreatedEvent } from '../../events/impl/transaction-created.event';
import {
  TransactionEntity,
  TransactionStatus,
} from '../../models/transaction.entity';
import { CreateTransactionCommand } from '../impl/create-transaction.command';

@CommandHandler(CreateTransactionCommand)
export class CreateTransactionHandler
  implements ICommandHandler<CreateTransactionCommand>
{
  private customMetricCounter: Counter;

  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private rabbitMQService: RabbitMQService,
    private eventBus: EventBus,
    private metricService: MetricService,
  ) {
    this.customMetricCounter = this.metricService.getCounter('custom_counter', {
      description: 'CreateTransactionCommand Counter',
    });
  }

  @Span('CREATE_TRANSACTION')
  async execute(command: CreateTransactionCommand): Promise<TransactionEntity> {
    const {
      id,
      sourceAccountId,
      destinationAccountId,
      amount,
      type,
      description,
    } = command;

    const transactionId = id || uuidv4();

    // Criar a transação com status PENDING
    const transaction = this.transactionRepository.create({
      id: transactionId,
      sourceAccountId,
      destinationAccountId,
      amount,
      type,
      status: TransactionStatus.PENDING,
      description,
      createdAt: new Date(),
    });

    await this.transactionRepository.save(transaction);

    this.eventBus.publish(
      new TransactionCreatedEvent(
        transaction.id,
        transaction.sourceAccountId,
        transaction.destinationAccountId,
        transaction.amount,
        transaction.type,
        transaction.description,
      ),
    );

    this.rabbitMQService.publish('events', 'transaction.created', transaction);

    this.customMetricCounter.add(1);

    return transaction;
  }
}
