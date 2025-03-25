import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TransactionDocument,
  TransactionStatus,
} from '../../models/transaction.schema';
import { TransactionSchedulerService } from '../../services/transaction-scheduler.service';
import { TransactionCreatedEvent } from '../impl/transaction-created.event';

@EventsHandler(TransactionCreatedEvent)
export class TransactionCreatedHandler
  implements IEventHandler<TransactionCreatedEvent>
{
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
    private schedulerService: TransactionSchedulerService,
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

    // agendar a transação para execução ou posso chamar o command handler diretamente aqui
    this.schedulerService.scheduleTransaction(id);

    console.log(`Transaction read model created: ${id}`);
  }
}
