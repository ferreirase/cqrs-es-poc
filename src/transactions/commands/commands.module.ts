import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountCommandsModule } from '../../accounts/commands/commands.module';
import { RabbitMQService } from '../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../common/monitoring/logging.service';
import { TransactionEntity } from '../models/transaction.entity';
import { TransactionAggregateRepository } from '../repositories/transaction-aggregate.repository';
import { CreateTransactionHandler } from './handlers/create-transaction.handler';

const CommandHandlers = [CreateTransactionHandler];

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([TransactionEntity]),
    AccountCommandsModule,
  ],
  providers: [
    ...CommandHandlers,
    RabbitMQService,
    TransactionAggregateRepository,
    LoggingService,
  ],
  exports: [...CommandHandlers],
})
export class TransactionCommandsModule {}
