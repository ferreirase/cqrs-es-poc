import { RabbitMQModule as NestRabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
        uri: `amqp://${configService.get('RABBITMQ_USER')}:${configService.get(
          'RABBITMQ_PASSWORD',
        )}@${configService.get('RABBITMQ_HOST')}:${configService.get(
          'RABBITMQ_PORT',
        )}`,
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
  providers: [RabbitMQService],
  exports: [RabbitMQService, NestRabbitMQModule],
})
export class RabbitMQModule {}
