import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
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
  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private rabbitMQService: RabbitMQService,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private prometheusService: PrometheusService,
  ) {}

  async execute(command: CreateTransactionCommand): Promise<TransactionEntity> {
    const commandName = 'CreateTransactionCommand';
    const startTime = Date.now();

    // Log detalhado do início do comando com todos os argumentos
    this.loggingService.logHandlerStart(commandName, {
      sourceAccountId: command.sourceAccountId,
      destinationAccountId: command.destinationAccountId,
      amount: command.amount,
      type: command.type,
      description: command.description,
    });

    try {
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

      const event = new TransactionCreatedEvent(
        transaction.id,
        transaction.sourceAccountId,
        transaction.destinationAccountId,
        transaction.amount,
        transaction.type,
        transaction.description,
      );

      this.eventBus.publish(event);

      // Publicar no RabbitMQ com metadados adicionais de métricas
      this.rabbitMQService.publish('events', 'transaction.created', {
        ...transaction,
        processingMetadata: {
          startTime,
          executionTime: (Date.now() - startTime) / 1000,
        },
      });

      // Registrar métricas de sucesso
      const executionTime = (Date.now() - startTime) / 1000;

      this.prometheusService
        .getCounter('commands_total')
        .inc({ command: commandName, status: 'success' }, 1);

      this.prometheusService
        .getHistogram('command_duration_seconds')
        .observe({ command: commandName }, executionTime);

      // Registrar detalhes da transação criada
      this.prometheusService.getCounter('command_results').inc(
        {
          command: commandName,
          result: 'transaction_created',
          status: 'success',
        },
        1,
      );

      // Log detalhado do final do comando com o resultado
      this.loggingService.logCommandSuccess(
        commandName,
        {
          id: transaction.id,
          sourceAccountId: transaction.sourceAccountId,
          type: transaction.type,
          amount: transaction.amount,
        },
        executionTime,
        {
          transactionId: transaction.id,
          status: transaction.status,
        },
      );

      return transaction;
    } catch (error) {
      // Registrar métricas de erro
      this.prometheusService
        .getCounter('commands_total')
        .inc({ command: commandName, status: 'error' }, 1);

      this.prometheusService.getCounter('command_results').inc(
        {
          command: commandName,
          result: 'transaction_error',
          status: 'error',
        },
        1,
      );

      // Log erro detalhado
      this.loggingService.logCommandError(commandName, error, {
        sourceAccountId: command.sourceAccountId,
        destinationAccountId: command.destinationAccountId,
        amount: command.amount,
        type: command.type,
      });

      throw error;
    }
  }
}
