import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRabbitMQUrl } from '../../variables';
import { RabbitMQService } from './rabbitmq.service';

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
        enableControllerDiscovery: true,
      }),
    }),
  ],
  controllers: [],
  providers: [RabbitMQService],
  exports: [RabbitMQService],
})
export class RabbitMqModule {}
