import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountDocument } from '../../models/account.schema';
import { GetAccountBalanceQuery } from '../impl/get-account-balance.query';

@QueryHandler(GetAccountBalanceQuery)
export class GetAccountBalanceHandler
  implements IQueryHandler<GetAccountBalanceQuery>
{
  constructor(
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
  ) {}

  async execute(query: GetAccountBalanceQuery) {
    const account = await this.accountModel.findOne({ id: query.id }).exec();

    if (!account) {
      throw new NotFoundException(`Account with ID "${query.id}" not found`);
    }

    return account.balance;
  }
}
