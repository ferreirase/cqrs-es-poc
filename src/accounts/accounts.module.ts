import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RabbitMQModule } from '../common/messaging/rabbitmq.module';
import { MonitoringModule } from '../common/monitoring/monitoring.module';
import { CreateAccountHandler } from './commands/handlers/create-account.handler';
import { UpdateAccountBalanceHandler } from './commands/handlers/update-account-balance.handler';
import { AccountsController } from './controllers/accounts.controller';
import { AccountEntity } from './models/account.entity';
import { AccountDocument, AccountSchema } from './models/account.schema';
import { GetAccountBalanceHandler } from './queries/handlers/get-account-balance.handler';
import { GetAccountHandler } from './queries/handlers/get-account.handler';
import { GetAccountsHandler } from './queries/handlers/get-accounts.handler';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccountEntity]),
    MongooseModule.forFeature([
      { name: AccountDocument.name, schema: AccountSchema },
    ]),
    CqrsModule,
    MonitoringModule,
    RabbitMQModule,
  ],
  controllers: [AccountsController],
  providers: [
    CreateAccountHandler,
    UpdateAccountBalanceHandler,
    GetAccountBalanceHandler,
    GetAccountHandler,
    GetAccountsHandler,
  ],
})
export class AccountsModule {}
