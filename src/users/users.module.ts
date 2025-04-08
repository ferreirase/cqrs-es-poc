import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RabbitMQModule } from '../common/messaging/rabbitmq.module';
import { MonitoringModule } from '../common/monitoring/monitoring.module';
import { CommandsModule } from './commands/commands.module';
import { CommandHandlers } from './commands/handlers';
import { UsersController } from './controllers/users.controller';
import { EventHandlers } from './events/handlers';
import { UserEntity } from './models/user.entity';
import { UserDocument, UserSchema } from './models/user.schema';
import { QueryHandlers } from './queries/handlers';
import { QueriesModule } from './queries/queries.module';

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([UserEntity]),
    MongooseModule.forFeature([
      { name: UserDocument.name, schema: UserSchema },
    ]),
    CommandsModule,
    QueriesModule,
    RabbitMQModule,
    MonitoringModule,
  ],
  controllers: [UsersController],
  providers: [...CommandHandlers, ...EventHandlers, ...QueryHandlers],
})
export class UsersModule {}
