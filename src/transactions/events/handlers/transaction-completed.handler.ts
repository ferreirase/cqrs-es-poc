import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { EventDeduplicationService } from '../../../common/events/event-deduplication.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionEntity } from '../../models/transaction.entity';
import {
  TransactionDocument,
  TransactionStatus,
} from '../../models/transaction.schema';
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
    private readonly eventDeduplicationService: EventDeduplicationService,
  ) {
    this.loggingService.info('TransactionCompletedHandler initialized');
  }

  async handle(event: TransactionCompletedEvent) {
    const handlerName = 'TransactionCompletedHandler';
    // Verificar se este evento é duplicado
    if (
      this.eventDeduplicationService.isDuplicateOrProcessing(
        'TransactionCompletedEvent',
        event.transactionId,
      )
    ) {
      this.loggingService.warn(
        `[${handlerName}] Duplicate completed event detected for transaction ${event.transactionId}. Skipping.`,
        { eventType: 'TransactionCompletedEvent' },
      );
      return;
    }

    this.loggingService.info(
      `[${handlerName}] Processing transaction completed event ${event.transactionId}`,
      { success: event.success },
    );

    try {
      // Verificar o status ANTES de atualizar
      const transaction = await this.transactionRepository.findOne({
        where: { id: event.transactionId },
        select: ['id', 'status'], // Otimização: buscar apenas o status
      });

      if (!transaction) {
        this.loggingService.warn(
          `[${handlerName}] Transaction ${event.transactionId} not found. Cannot mark as completed.`,
        );
        return;
      }

      // Se já está COMPLETED, não fazer nada
      if (transaction.status === TransactionStatus.COMPLETED) {
        this.loggingService.info(
          `[${handlerName}] Transaction ${event.transactionId} already marked as COMPLETED. Skipping update.`,
        );
        return;
      }

      // Se está FAILED, logar um aviso mas NÃO mudar para COMPLETED
      if (transaction.status === TransactionStatus.FAILED) {
        this.loggingService.warn(
          `[${handlerName}] Received completed event for transaction ${event.transactionId} which is already FAILED. Status will remain FAILED.`,
        );
        return; // Não sobrescrever o status FAILED
      }

      // Apenas atualiza se o estado atual não for final
      this.loggingService.info(
        `[${handlerName}] Updating transaction ${event.transactionId} to COMPLETED (previous status: ${transaction.status}).`,
      );

      // Atualizar o status da transação para COMPLETED no PostgreSQL
      await this.transactionRepository.update(
        { id: event.transactionId },
        {
          status: TransactionStatus.COMPLETED,
          updatedAt: new Date(),
        },
      );

      // Atualizar também no MongoDB
      await this.transactionModel.updateOne(
        { id: event.transactionId },
        {
          $set: {
            status: TransactionStatus.COMPLETED,
            updatedAt: new Date(),
          },
        },
      );

      this.loggingService.info(
        `[${handlerName}] Successfully marked transaction ${event.transactionId} as COMPLETED in both databases.`,
      );
    } catch (error) {
      this.loggingService.error(
        `[${handlerName}] Error processing completion event: ${error.message}`,
        { transactionId: event.transactionId, error: error.stack },
      );
      // Não relançar o erro
    }
  }
}
