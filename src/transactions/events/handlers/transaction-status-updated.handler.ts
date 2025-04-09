import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionEntity } from '../../models/transaction.entity';
import { TransactionDocument } from '../../models/transaction.schema';
import { TransactionStatusUpdatedEvent } from '../impl/transaction-status-updated.event';

@EventsHandler(TransactionStatusUpdatedEvent)
export class TransactionStatusUpdatedHandler
  implements IEventHandler<TransactionStatusUpdatedEvent>
{
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private readonly loggingService: LoggingService,
  ) {
    this.loggingService.info('TransactionStatusUpdatedHandler initialized');
  }

  async handle(event: TransactionStatusUpdatedEvent) {
    this.loggingService.info(
      `[TransactionStatusUpdatedHandler] Handling event: ${JSON.stringify(
        event,
      )}`,
    );

    const { id, status, processedAt, error } = event;

    try {
      // Busca a transação existente
      const transactionQuerySide = await this.transactionModel.findOne({ id });
      const transactionCommandSide = await this.transactionRepository.findOne({
        where: { id },
      });

      if (!transactionQuerySide && !transactionCommandSide) {
        this.loggingService.error(
          `[TransactionStatusUpdatedHandler] Transaction with ID ${id} not found`,
        );
        return;
      }

      // Log do status atual antes da atualização
      this.loggingService.info(
        `[TransactionStatusUpdatedHandler] Current status for transaction ${id}`,
      );

      // Atualiza os campos da transação
      const updateData: any = { status };

      if (processedAt) {
        updateData.processedAt = processedAt;
      }

      if (error) {
        updateData.error = error;
      }

      this.loggingService.info(
        `[TransactionStatusUpdatedHandler] Updating transaction ${id} with data:`,
        { updateData },
      );

      // Realiza a atualização
      const updatedTransactionQuerySide =
        await this.transactionModel.findOneAndUpdate(
          { id },
          { $set: updateData },
          { new: true },
        );

      // Atualiza o lado do comando (PostgreSQL)
      if (transactionCommandSide) {
        Object.assign(transactionCommandSide, updateData);
        await this.transactionRepository.save(transactionCommandSide);
      }

      if (!updatedTransactionQuerySide && !transactionCommandSide) {
        this.loggingService.error(
          `[TransactionStatusUpdatedHandler] Failed to update transaction ${id}`,
        );
        return;
      }

      this.loggingService.info(
        `[TransactionStatusUpdatedHandler] Transaction ${id} status updated successfully`,
        {
          querySideStatus: updatedTransactionQuerySide?.status,
          commandSideStatus: transactionCommandSide?.status,
        },
      );
    } catch (error) {
      this.loggingService.error(
        `[TransactionStatusUpdatedHandler] Error updating transaction read model: ${error.message}`,
        {
          error,
          stackTrace: error.stack,
          transactionId: id,
          attemptedStatus: status,
        },
      );
      throw error;
    }
  }
}
