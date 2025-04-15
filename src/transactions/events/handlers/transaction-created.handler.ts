import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionEntity } from '../../models/transaction.entity';
import {
  TransactionDocument,
  TransactionStatus,
} from '../../models/transaction.schema';
import { TransactionCreatedEvent } from '../impl/transaction-created.event';

@EventsHandler(TransactionCreatedEvent)
export class TransactionCreatedHandler
  implements IEventHandler<TransactionCreatedEvent>
{
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private readonly loggingService: LoggingService,
  ) {
    this.loggingService.info('TransactionCreatedHandler initialized');
  }

  async handle(event: TransactionCreatedEvent) {
    this.loggingService.info(
      `[TransactionCreatedHandler] Handling event: ${JSON.stringify(event)}`,
    );

    const {
      id,
      sourceAccountId,
      destinationAccountId,
      amount,
      type,
      description,
    } = event;

    try {
      // Verifica se a transação já existe para evitar duplicação
      const existingTransaction = await this.transactionRepository.findOne({
        where: { id },
      });

      if (existingTransaction) {
        this.loggingService.warn(
          `[TransactionCreatedHandler] Transaction with ID ${id} already exists, skipping creation`,
        );
        return;
      }

      // Criar a transação no banco de dados relacional primeiro
      const transaction = await this.transactionRepository.save({
        id,
        sourceAccountId,
        destinationAccountId,
        amount,
        type,
        status: TransactionStatus.PENDING,
        description,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.loggingService.info(
        `[TransactionCreatedHandler] Transaction created in relational database: ${id}`,
      );

      // Criar a transação no MongoDB
      await this.transactionModel.create({
        id,
        sourceAccountId,
        destinationAccountId,
        amount,
        type,
        status: TransactionStatus.PENDING,
        description,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.loggingService.info(
        `[TransactionCreatedHandler] Transaction read model created in MongoDB: ${id}`,
      );

      return transaction;
    } catch (error) {
      this.loggingService.error(
        `[TransactionCreatedHandler] Error creating transaction: ${error.message}`,
        { error, stackTrace: error.stack },
      );
      throw error;
    }
  }
}
