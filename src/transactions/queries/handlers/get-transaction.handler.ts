import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TransactionDocument } from '../../models/transaction.schema';
import { GetTransactionQuery } from '../impl/get-transaction.query';

@QueryHandler(GetTransactionQuery)
export class GetTransactionHandler
  implements IQueryHandler<GetTransactionQuery>
{
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
  ) {}

  async execute(query: GetTransactionQuery) {
    const transaction = await this.transactionModel.findOne({
      id: query.id,
    });

    if (!transaction) {
      throw new NotFoundException(
        `Transaction with ID "${query.id}" not found`,
      );
    }

    return transaction;
  }
}
