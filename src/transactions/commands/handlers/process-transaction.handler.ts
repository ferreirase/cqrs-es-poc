import { HttpException, Logger } from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  EventBus,
  ICommandHandler,
} from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateAccountBalanceCommand } from '../../../accounts/commands/impl/update-account-balance.command';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { TransactionProcessedEvent } from '../../events/impl/transaction-processed.event';
import {
  TransactionEntity,
  TransactionStatus,
} from '../../models/transaction.entity';
import { ProcessTransactionCommand } from '../impl/process-transaction.command';

@CommandHandler(ProcessTransactionCommand)
export class ProcessTransactionHandler
  implements ICommandHandler<ProcessTransactionCommand>
{
  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private commandBus: CommandBus,
    private rabbitmqService: RabbitMQService,
    private eventBus: EventBus,
  ) {}

  async execute(command: ProcessTransactionCommand): Promise<void> {
    const { transactionId } = command;

    const transaction = await this.transactionRepository.findOneBy({
      id: transactionId,
    });

    if (!transaction) {
      throw new HttpException(
        `Transaction with id ${transactionId} not found`,
        404,
      );
    }

    if (transaction.status !== TransactionStatus.PENDING) return;

    try {
      switch (transaction.type) {
        case 'deposit':
          await this.commandBus.execute(
            new UpdateAccountBalanceCommand(
              transaction.sourceAccountId,
              transaction.amount,
            ),
          );
          break;
        case 'withdrawal':
          await this.commandBus.execute(
            new UpdateAccountBalanceCommand(
              transaction.sourceAccountId,
              -transaction.amount,
            ),
          );
          break;
        case 'transfer':
          if (!transaction.destinationAccountId) {
            throw new HttpException(
              'Destination account is required for transfers',
              400,
            );
          }
          await this.commandBus.execute(
            new UpdateAccountBalanceCommand(
              transaction.sourceAccountId,
              -transaction.amount,
            ),
          );
          await this.commandBus.execute(
            new UpdateAccountBalanceCommand(
              transaction.destinationAccountId,
              transaction.amount,
            ),
          );
          break;
      }

      transaction.status = TransactionStatus.COMPLETED;
      transaction.processedAt = new Date();

      await this.transactionRepository.save(transaction);

      this.eventBus.publish(
        new TransactionProcessedEvent(transaction.id, transaction.status),
      );

      this.rabbitmqService.publish('events', 'transaction.processed', {
        id: transactionId,
        status: TransactionStatus.COMPLETED,
        processedAt: transaction.processedAt,
      });

      Logger.log(`Transaction with id ${transactionId} processed successfully`);
    } catch (error) {
      transaction.status = TransactionStatus.FAILED;
      transaction.processedAt = new Date();
      await this.transactionRepository.save(transaction);

      this.rabbitmqService.publish('events', 'transaction.failed', {
        id: transactionId,
        status: TransactionStatus.FAILED,
        processedAt: transaction.processedAt,
      });

      throw new HttpException(
        `Failed to process transaction with id ${transactionId}: ${error.message}`,
        500,
      );
    }
  }
}
