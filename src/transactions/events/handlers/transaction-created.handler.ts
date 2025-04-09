import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
    @InjectModel('TransactionDocument')
    private transactionModel: Model<TransactionDocument>,
  ) {
    console.log('TransactionCreatedHandler initialized');
  }

  async handle(event: TransactionCreatedEvent) {
    console.log(
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
      const createdTransaction = await this.transactionModel.create({
        id,
        sourceAccountId,
        destinationAccountId,
        amount,
        type,
        status: TransactionStatus.PENDING,
        description,
        createdAt: new Date(),
      });

      console.log(`Transaction read model created: ${id}`, createdTransaction);
    } catch (error) {
      console.error(`Error creating transaction read model: ${error.message}`);
      throw error;
    }
  }
}
