import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { EventStoreService } from '../../../common/events/event-store.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionStatusUpdatedEvent } from '../../events/impl/transaction-status-updated.event';
import { TransactionEntity } from '../../models/transaction.entity';
import { TransactionDocument } from '../../models/transaction.schema';
import { UpdateTransactionStatusCommand } from '../impl/update-transaction-status.command';

@CommandHandler(UpdateTransactionStatusCommand)
export class UpdateTransactionStatusHandler
  implements ICommandHandler<UpdateTransactionStatusCommand>
{
  constructor(
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectModel(TransactionDocument.name)
    private readonly transactionModel: Model<TransactionDocument>,
    private readonly eventBus: EventBus,
    private readonly eventStore: EventStoreService,
    private readonly loggingService: LoggingService,
  ) {}

  async execute(command: UpdateTransactionStatusCommand): Promise<void> {
    const { transactionId, status, processedAt, error } = command;

    try {
      this.loggingService.info(
        `[UpdateTransactionStatusHandler] Starting status update for transaction ${transactionId}`,
        { status, processedAt, error },
      );

      // 1. Verificar se a transação existe no lado do Command
      const transaction = await this.transactionRepository.findOne({
        where: { id: transactionId },
      });

      if (!transaction) {
        this.loggingService.warn(
          `[UpdateTransactionStatusHandler] Transaction ${transactionId} not found in command database`,
        );
      } else {
        this.loggingService.info(
          `[UpdateTransactionStatusHandler] Found transaction ${transactionId} with current status: ${transaction.status}`,
        );
      }

      // 2. Atualizar do lado do Command (TypeORM)
      const updateData = {
        status,
        ...(processedAt && { processedAt }),
        updatedAt: new Date(),
        ...(error && { error }),
      };

      const updateResult = await this.transactionRepository.update(
        { id: transactionId },
        updateData,
      );

      this.loggingService.info(
        `[UpdateTransactionStatusHandler] Command side updated for transaction ${transactionId}`,
        { affected: updateResult.affected, status, updateData },
      );

      // 3. Verificar e atualizar do lado Query (MongoDB)
      const queryTransaction = await this.transactionModel.findOne({
        id: transactionId,
      });

      if (!queryTransaction) {
        this.loggingService.warn(
          `[UpdateTransactionStatusHandler] Transaction ${transactionId} not found in query database, skipping update`,
        );
      } else {
        this.loggingService.info(
          `[UpdateTransactionStatusHandler] Query transaction current status before update: ${queryTransaction.status}`,
        );

        // Atualizar o documento no MongoDB
        const queryUpdateData: any = { status };

        if (processedAt) {
          queryUpdateData.processedAt = processedAt;
        }

        if (error) {
          queryUpdateData.error = error;
        }

        const queryResult = await this.transactionModel.findOneAndUpdate(
          { id: transactionId },
          { $set: queryUpdateData },
          { new: true },
        );

        this.loggingService.info(
          `[UpdateTransactionStatusHandler] Query side updated for transaction ${transactionId}`,
          {
            previousStatus: queryTransaction.status,
            newStatus: queryResult.status,
          },
        );
      }

      // 4. Criar e publicar o evento de atualização de status
      const statusEvent = new TransactionStatusUpdatedEvent(
        transactionId,
        status,
        processedAt,
        error,
      );

      // 5. Salvar o evento no Event Store
      await this.eventStore.saveEvent(
        'transaction.status.updated',
        statusEvent,
        transactionId,
      );

      // 6. Publicar evento para que os handlers registrados o processem
      this.eventBus.publish(statusEvent);

      this.loggingService.info(
        `[UpdateTransactionStatusHandler] Published status update event for transaction ${transactionId}`,
        { status },
      );

      // Status atualizado com sucesso
      this.loggingService.info(
        `[UpdateTransactionStatusHandler] Transaction status update completed for ${transactionId}`,
        { status, previousStatus: transaction?.status || 'unknown' },
      );
    } catch (error) {
      this.loggingService.error(
        `[UpdateTransactionStatusHandler] Error updating transaction status: ${error.message}`,
        { error: error.message, stack: error.stack, transactionId, status },
      );
      throw error;
    }
  }
}
