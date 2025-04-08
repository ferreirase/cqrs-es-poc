import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RabbitMQModule } from '../../common/messaging/rabbitmq.module';
import { MonitoringModule } from '../../common/monitoring/monitoring.module';
import { UserEntity } from '../models/user.entity';
import { CommandHandlers } from './handlers';

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([UserEntity]),
    RabbitMQModule,
    MonitoringModule,
  ],
  providers: [...CommandHandlers],
  exports: [...CommandHandlers],
})
export class CommandsModule {}
