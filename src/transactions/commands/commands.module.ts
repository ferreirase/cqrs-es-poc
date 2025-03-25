import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountCommandsModule } from '../../accounts/commands/commands.module';
import { EventStoreService } from '../../common/events/event-store.service';
import { EventEntity } from '../../common/events/event.entity';
import { RabbitMQService } from '../../common/messaging/rabbitmq.service';
import { TransactionEntity } from '../models/transaction.entity';
import { CreateTransactionHandler } from './handlers/create-transaction.handler';

const CommandHandlers = [CreateTransactionHandler];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([TransactionEntity, EventEntity]),
    AccountCommandsModule,
  ],
  providers: [...CommandHandlers, EventStoreService, RabbitMQService],
  exports: [...CommandHandlers],
})
export class TransactionCommandsModule {}
