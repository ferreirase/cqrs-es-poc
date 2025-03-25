import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TransactionDocument } from '../../models/transaction.schema';
import { TransactionProcessedEvent } from '../impl/transaction-processed.event';

@EventsHandler(TransactionProcessedEvent)
export class TransactionProcessedHandler
  implements IEventHandler<TransactionProcessedEvent>
{
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
  ) {}

  async handle(event: TransactionProcessedEvent) {
    const { id, status, error } = event;

    await this.transactionModel.findOneAndUpdate(
      { id },
      {
        $set: {
          status,
          processedAt: new Date(),
          error: error,
        },
      },
    );

    console.log(`Transaction read model updated: ${id} with status ${status}`);
  }
}
