import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TransactionDocument,
  TransactionSchema,
} from '../models/transaction.schema';
import { GetAccountTransactionsHandler } from './handlers/get-account-transactions.handler';
import { GetTransactionHandler } from './handlers/get-transaction.handler';

const QueryHandlers = [GetTransactionHandler, GetAccountTransactionsHandler];

@Module({
  imports: [
    CqrsModule,
    MongooseModule.forFeature([
      { name: TransactionDocument.name, schema: TransactionSchema },
    ]),
  ],
  providers: [...QueryHandlers],
  exports: [...QueryHandlers],
})
export class TransactionQueriesModule {}
