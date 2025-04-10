import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './accounts/accounts.module';
import { EventEntity } from './common/events/event.entity';
import { EventsModule } from './common/events/events.module';
import { RabbitMQModule } from './common/messaging/rabbitmq.module';
import { RabbitMQService } from './common/messaging/rabbitmq.service';
import { MonitoringModule } from './common/monitoring/monitoring.module';
import { WorkerModule } from './common/workers/worker.module';
import { WorkersModule } from './common/workers/workers.module';
import { TransactionsModule } from './transactions/transactions.module';
import { UsersModule } from './users/users.module';
import {
  getNodeEnv,
  getPostgresDb,
  getPostgresHost,
  getPostgresPassword,
  getPostgresPort,
  getPostgresUser,
  mongoUri,
} from './variables';

@Module({
  imports: [
    WorkersModule,
    WorkerModule.forRoot(),
    RabbitMQModule,
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      envFilePath:
        process.env.NODE_ENV === 'production' ? '.env' : '.env.local',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: getPostgresHost(configService),
        port: getPostgresPort(configService),
        username: getPostgresUser(configService),
        password: getPostgresPassword(configService),
        database: getPostgresDb(configService),
        entities: [__dirname + '/**/*.entity{.ts,.js}', EventEntity],
        synchronize: getNodeEnv(configService) === 'production' ? false : true,
      }),
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: mongoUri(configService),
      }),
    }),
    CqrsModule,
    EventsModule,
    AccountsModule,
    TransactionsModule,
    UsersModule,
    MonitoringModule,
  ],
  providers: [RabbitMQService],
})
export class AppModule {}
