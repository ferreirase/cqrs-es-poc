import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventStoreService } from '../common/events/event-store.service';
import { EventEntity } from '../common/events/event.entity';
import { RabbitMQModule } from '../common/messaging/rabbitmq.module';
import { MonitoringModule } from '../common/monitoring/monitoring.module';
import { TransactionsController } from './controllers/transactions.controller';
import { TransactionEntity } from './models/transaction.entity';
import { TransactionSchema } from './models/transaction.schema';

import { AccountsModule } from '../accounts/accounts.module';
import { AccountEntity } from '../accounts/models/account.entity';
import { AccountSchema } from '../accounts/models/account.schema';
import { TransactionContextService } from '../transactions/services/transaction-context.service';
import { UserEntity } from '../users/models/user.entity';
import { UserSchema } from '../users/models/user.schema';
import { TransactionAggregate } from './aggregates/transaction.aggregate';
import { CreateTransactionHandler } from './commands/handlers/create-transaction.handler';
import { ProcessTransactionHandler as ExistingProcessTransactionHandler } from './commands/handlers/process-transaction.handler';
import { SagaCommandHandlers } from './commands/handlers/saga-handlers.index';
import { EventHandlers } from './events/handlers';
import { GetAccountTransactionsHandler } from './queries/handlers/get-account-transactions.handler';
import { GetAllTransactionsHandler } from './queries/handlers/get-all-transactions.handler';
import { GetTransactionHandler } from './queries/handlers/get-transaction.handler';
import { TransactionAggregateRepository } from './repositories/transaction-aggregate.repository';
import { WithdrawalSaga } from './sagas/withdrawal.saga';

const CommandHandlers = [CreateTransactionHandler, ...SagaCommandHandlers];
const QueryHandlers = [
  GetTransactionHandler,
  GetAccountTransactionsHandler,
  GetAllTransactionsHandler,
];
const Sagas = [WithdrawalSaga];
const Aggregates = [TransactionAggregate];
const Repositories = [TransactionAggregateRepository];

@Module({
  imports: [
    CqrsModule,
    RabbitMQModule,
    MonitoringModule,
    TypeOrmModule.forFeature([
      TransactionEntity,
      EventEntity,
      UserEntity,
      AccountEntity,
    ]),
    MongooseModule.forFeature([
      { name: 'TransactionDocument', schema: TransactionSchema },
      { name: 'UserDocument', schema: UserSchema },
      { name: 'AccountDocument', schema: AccountSchema },
    ]),
    AccountsModule,
  ],
  controllers: [TransactionsController],
  providers: [
    EventStoreService,
    TransactionContextService,
    ExistingProcessTransactionHandler,
    ...CommandHandlers,
    ...EventHandlers,
    ...QueryHandlers,
    ...Sagas,
    ...Aggregates,
    ...Repositories,
  ],
})
export class TransactionsModule {}
