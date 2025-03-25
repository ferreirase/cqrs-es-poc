import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountDocument } from '../../models/account.schema';
import { GetAccountsQuery } from '../impl/get-accounts.query';

@QueryHandler(GetAccountsQuery)
export class GetAccountsHandler implements IQueryHandler<GetAccountsQuery> {
  constructor(
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
  ) {}

  async execute() {
    return this.accountModel.find().exec();
  }
} 