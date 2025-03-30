import { RabbitMQModule as NestRabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRabbitMQUrl } from '../../variables';
import { RabbitMQService } from './rabbitmq.service';

@Module({
  imports: [
    NestRabbitMQModule.forRootAsync({
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
  ],
  providers: [RabbitMQService],
  exports: [RabbitMQService, NestRabbitMQModule],
})
export class RabbitMQModule {}
