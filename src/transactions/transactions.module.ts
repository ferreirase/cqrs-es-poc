import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventStoreService } from '../common/events/event-store.service';
import { EventEntity } from '../common/events/event.entity';
import { RabbitMqModule } from '../common/messaging/rabbitmq.module';
import { TransactionsController } from './controllers/transactions.controller';
import { TransactionEntity } from './models/transaction.entity';
import {
  TransactionDocument,
  TransactionSchema,
} from './models/transaction.schema';

import { AccountsModule } from '../accounts/accounts.module';
import { TransactionSchedulerService } from '../transactions/services/transaction-scheduler.service';
import { CreateTransactionHandler } from './commands/handlers/create-transaction.handler';
import { ProcessTransactionHandler } from './commands/handlers/process-transaction.handler';
import { TransactionCreatedHandler } from './events/handlers/transaction-created.handler';
import { TransactionProcessedHandler } from './events/handlers/transaction-processed.handler';
import { GetAccountTransactionsHandler } from './queries/handlers/get-account-transactions.handler';
import { GetTransactionHandler } from './queries/handlers/get-transaction.handler';
const CommandHandlers = [CreateTransactionHandler];
const EventHandlers = [TransactionCreatedHandler, TransactionProcessedHandler];
const QueryHandlers = [GetTransactionHandler, GetAccountTransactionsHandler];

@Module({
  imports: [
    CqrsModule,
    RabbitMqModule,
    TypeOrmModule.forFeature([TransactionEntity, EventEntity]),
    MongooseModule.forFeature([
      { name: TransactionDocument.name, schema: TransactionSchema },
    ]),
    AccountsModule,
  ],
  controllers: [TransactionsController],
  providers: [
    EventStoreService,
    TransactionSchedulerService,
    CreateTransactionHandler,
    ProcessTransactionHandler,
    ...EventHandlers,
    ...QueryHandlers,
    ...CommandHandlers,
  ],
})
export class TransactionsModule {}
