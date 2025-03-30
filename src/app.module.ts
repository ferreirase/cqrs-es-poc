import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './accounts/accounts.module';
import { RabbitMQService } from './common/messaging/rabbitmq.service';
import { MonitoringModule } from './common/monitoring/monitoring.module';
import { SyncModule } from './common/sync/sync.module';
import { TransactionsModule } from './transactions/transactions.module';
import {
  getMongoUri,
  getNodeEnv,
  getPostgresDb,
  getPostgresHost,
  getPostgresPassword,
  getPostgresPort,
  getPostgresUser,
  getRabbitMQUrl,
} from './variables';

@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        exchanges: [
          {
            name: 'paymaker-exchange',
            type: 'topic',
          },
        ],
        uri: getRabbitMQUrl(configService),
        connectionInitOptions: { wait: true },
        defaultRpcTimeout: 10000,
      }),
    }),
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
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: getNodeEnv(configService) === 'production' ? false : true, // Não use isso em produção
      }),
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: getMongoUri(configService),
      }),
    }),
    CqrsModule,
    AccountsModule,
    TransactionsModule,
    SyncModule,
    MonitoringModule,
  ],
  providers: [RabbitMQService],
})
export class AppModule {}
