import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionEntity } from '../../models/transaction.entity';
import { TransactionDocument } from '../../models/transaction.schema';
import { TransactionCompletedEvent } from '../impl/transaction-completed.event';

@EventsHandler(TransactionCompletedEvent)
export class TransactionCompletedHandler
  implements IEventHandler<TransactionCompletedEvent>
{
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private readonly loggingService: LoggingService,
  ) {
    this.loggingService.info('TransactionCompletedHandler initialized');
  }

  async handle(event: TransactionCompletedEvent) {
    const { transactionId, success } = event;

    try {
      this.loggingService.info(
        `[TransactionCompletedHandler] Processing transaction completed event for ${transactionId}`,
        { success },
      );

      // Atualizar o lado Command (TypeORM)
      const commandSideResult = await this.transactionRepository.update(
        { id: transactionId },
        {
          updatedAt: new Date(),
        },
      );

      if (!commandSideResult.affected) {
        this.loggingService.warn(
          `[TransactionCompletedHandler] No command-side transaction found for ${transactionId}`,
        );
      }

      // Atualizar o lado Query (MongoDB)
      const querySideResult = await this.transactionModel.findOneAndUpdate(
        { id: transactionId },
        {
          $set: {
            updatedAt: new Date(),
          },
        },
        { new: true },
      );

      if (!querySideResult) {
        this.loggingService.warn(
          `[TransactionCompletedHandler] No query-side transaction found for ${transactionId}`,
        );
      }

      this.loggingService.info(
        `[TransactionCompletedHandler] Transaction ${transactionId} completed event processed successfully`,
      );
    } catch (error) {
      this.loggingService.error(
        `[TransactionCompletedHandler] Error processing transaction completed event: ${error.message}`,
        {
          error,
          stackTrace: error.stack,
          transactionId,
        },
      );
      throw error;
    }
  }
}
