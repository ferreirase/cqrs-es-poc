import { RabbitMQModule as NestRabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRabbitMQUrl } from '../../variables';
import { RabbitMQOrchestratorService } from './rabbitmq-orchestrator.service';
import { RabbitMQService } from './rabbitmq.service';

@Module({
  imports: [
    NestRabbitMQModule.forRootAsync(NestRabbitMQModule, {
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
        prefetchCount: 2,
        channels: {
          default: {
            prefetchCount: 2,
            default: true,
          },
        },
      }),
    }),
  ],
  providers: [RabbitMQService, RabbitMQOrchestratorService],
  exports: [RabbitMQService, NestRabbitMQModule, RabbitMQOrchestratorService],
})
export class RabbitMQModule {}
