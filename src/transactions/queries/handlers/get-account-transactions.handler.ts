import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TransactionDocument } from '../../models/transaction.schema';
import { GetAccountTransactionsQuery } from '../impl/get-account-transactions.query';

@QueryHandler(GetAccountTransactionsQuery)
export class GetAccountTransactionsHandler
  implements IQueryHandler<GetAccountTransactionsQuery>
{
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
  ) {}

  async execute(query: GetAccountTransactionsQuery) {
    return this.transactionModel
      .find({
        $or: [
          { sourceAccountId: query.accountId },
          { destinationAccountId: query.accountId },
        ],
      })
      .sort({ createdAt: -1 })
      .exec();
  }
}
