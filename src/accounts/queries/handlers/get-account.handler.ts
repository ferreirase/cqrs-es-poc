import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountDocument } from '../../models/account.schema';
import { GetAccountQuery } from '../impl/get-account.query';

@QueryHandler(GetAccountQuery)
export class GetAccountHandler implements IQueryHandler<GetAccountQuery> {
  constructor(
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
  ) {}

  async execute(query: GetAccountQuery) {
    return await this.accountModel.findOne({ id: query.id }).exec();
  }
}
