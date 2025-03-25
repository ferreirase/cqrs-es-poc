import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountDocument, AccountSchema } from '../models/account.schema';
import { GetAccountBalanceHandler } from './handlers/get-account-balance.handler';
import { GetAccountHandler } from './handlers/get-account.handler';
import { GetAccountsHandler } from './handlers/get-accounts.handler';

const QueryHandlers = [
  GetAccountHandler,
  GetAccountsHandler,
  GetAccountBalanceHandler,
];

@Module({
  imports: [
    CqrsModule,
    MongooseModule.forFeature([
      { name: AccountDocument.name, schema: AccountSchema },
    ]),
  ],
  providers: [...QueryHandlers],
  exports: [...QueryHandlers],
})
export class AccountQueriesModule {}
