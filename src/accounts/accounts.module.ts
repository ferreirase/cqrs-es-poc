import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventStoreService } from '../common/events/event-store.service';
import { EventEntity } from '../common/events/event.entity';
import { RabbitMqModule } from '../common/messaging/rabbitmq.module';
import { AccountsController } from './controllers/accounts.controller';
import { AccountEntity } from './models/account.entity';
import { AccountDocument, AccountSchema } from './models/account.schema';

import { CreateAccountHandler } from './commands/handlers/create-account.handler';
import { UpdateAccountBalanceHandler } from './commands/handlers/update-account-balance.handler';
import { AccountBalanceUpdatedHandler } from './events/handlers/account-balance-updated.handler';
import { AccountCreatedHandler } from './events/handlers/account-created.handler';
import { GetAccountBalanceHandler } from './queries/handlers/get-account-balance.handler';
import { GetAccountHandler } from './queries/handlers/get-account.handler';
import { GetAccountsHandler } from './queries/handlers/get-accounts.handler';

const CommandHandlers = [CreateAccountHandler, UpdateAccountBalanceHandler];
const EventHandlers = [AccountCreatedHandler, AccountBalanceUpdatedHandler];
const QueryHandlers = [
  GetAccountHandler,
  GetAccountsHandler,
  GetAccountBalanceHandler,
];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([AccountEntity, EventEntity]),
    MongooseModule.forFeature([
      { name: AccountDocument.name, schema: AccountSchema },
    ]),
    RabbitMqModule,
  ],
  controllers: [AccountsController],
  providers: [
    EventStoreService,
    ...CommandHandlers,
    ...EventHandlers,
    ...QueryHandlers,
  ],
  exports: [TypeOrmModule],
})
export class AccountsModule {}
