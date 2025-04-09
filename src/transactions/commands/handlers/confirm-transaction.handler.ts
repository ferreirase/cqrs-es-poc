import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { ConfirmTransactionCommand } from '../../commands/impl/confirm-transaction.command';
import { TransactionConfirmedEvent } from '../../events/impl/transaction-confirmed.event';
import {
  TransactionEntity,
  TransactionStatus,
} from '../../models/transaction.entity';

@CommandHandler(ConfirmTransactionCommand)
export class ConfirmTransactionHandler
  implements ICommandHandler<ConfirmTransactionCommand>
{
  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private rabbitMQService: RabbitMQService,
  ) {}

  async execute(command: ConfirmTransactionCommand): Promise<void> {
    const { transactionId, sourceAccountId, destinationAccountId, amount } =
      command;

    this.loggingService.info(
      `[ConfirmTransactionHandler] Confirming transaction: ${transactionId}`,
    );

    try {
      // Buscar a transação
      const transaction = await this.transactionRepository.findOne({
        where: { id: transactionId },
      });

      if (!transaction) {
        throw new NotFoundException(
          `Transaction with ID "${transactionId}" not found`,
        );
      }

      // Atualizar status da transação para CONFIRMED
      transaction.status = TransactionStatus.CONFIRMED;
      transaction.updatedAt = new Date();
      await this.transactionRepository.save(transaction);

      // Publicar evento indicando que a transação foi confirmada com sucesso
      this.eventBus.publish(
        new TransactionConfirmedEvent(
          transactionId,
          sourceAccountId,
          destinationAccountId,
          amount,
          true,
        ),
      );

      // Publicar no RabbitMQ
      this.rabbitMQService.publish('events', 'transaction.confirmed', {
        id: transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        status: TransactionStatus.CONFIRMED,
        success: true,
        confirmedAt: new Date(),
        type: transaction.type,
      });

      this.loggingService.info(
        `[ConfirmTransactionHandler] Successfully confirmed transaction ${transactionId}`,
      );
    } catch (error) {
      this.loggingService.error(
        `[ConfirmTransactionHandler] Error confirming transaction: ${error.message}`,
      );

      // Publicar evento indicando falha na confirmação
      this.eventBus.publish(
        new TransactionConfirmedEvent(
          transactionId,
          sourceAccountId,
          destinationAccountId,
          amount,
          false,
        ),
      );

      // Publicar no RabbitMQ
      this.rabbitMQService.publish('events', 'transaction.confirmed', {
        id: transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        status: TransactionStatus.FAILED,
        success: false,
        error: error.message,
        confirmedAt: new Date(),
      });

      throw error;
    }
  }
}
