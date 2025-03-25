import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from '../../accounts/models/account.entity';
import {
  AccountDocument,
  AccountSchema,
} from '../../accounts/models/account.schema';
import { TransactionEntity } from '../../transactions/models/transaction.entity';
import {
  TransactionDocument,
  TransactionSchema,
} from '../../transactions/models/transaction.schema';
import { RabbitMqModule } from '../messaging/rabbitmq.module';
import { SyncController } from './sync.controller';
import { DataSyncService } from './sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccountEntity, TransactionEntity]),
    MongooseModule.forFeature([
      { name: AccountDocument.name, schema: AccountSchema },
      { name: TransactionDocument.name, schema: TransactionSchema },
    ]),
    RabbitMqModule,
  ],
  controllers: [SyncController],
  providers: [DataSyncService, AmqpConnection],
  exports: [DataSyncService],
})
export class SyncModule {}
