import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from '../../common/events/event.entity';
import { RabbitMQService } from '../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../common/monitoring/logging.service';
import { AccountEntity } from '../models/account.entity';
import { CreateAccountHandler } from './handlers/create-account.handler';
import { UpdateAccountBalanceHandler } from './handlers/update-account-balance.handler';

const CommandHandlers = [CreateAccountHandler, UpdateAccountBalanceHandler];

@Module({
  imports: [CqrsModule, TypeOrmModule.forFeature([AccountEntity, EventEntity])],
  providers: [...CommandHandlers, RabbitMQService, LoggingService],
  exports: [...CommandHandlers],
})
export class AccountCommandsModule {}
