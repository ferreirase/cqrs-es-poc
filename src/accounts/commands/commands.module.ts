import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventStoreService } from '../../common/events/event-store.service';
import { EventEntity } from '../../common/events/event.entity';
import { RabbitMQService } from '../../common/messaging/rabbitmq.service';
import { AccountEntity } from '../models/account.entity';
import { CreateAccountHandler } from './handlers/create-account.handler';
import { UpdateAccountBalanceHandler } from './handlers/update-account-balance.handler';

const CommandHandlers = [CreateAccountHandler, UpdateAccountBalanceHandler];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([AccountEntity, EventEntity]),
  ],
  providers: [
    ...CommandHandlers,
    EventStoreService,
    RabbitMQService,
  ],
  exports: [...CommandHandlers],
})
export class AccountCommandsModule {}