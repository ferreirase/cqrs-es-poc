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
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
  ) {}

  async handle(event: TransactionCreatedEvent) {
    const {
      id,
      sourceAccountId,
      destinationAccountId,
      amount,
      type,
      description,
    } = event;

    await this.transactionModel.create({
      id,
      sourceAccountId,
      destinationAccountId,
      amount,
      type,
      status: TransactionStatus.PENDING,
      description,
      createdAt: new Date(),
    });

    console.log(`Transaction read model created: ${id}`);
  }
}
