import { ConfigService } from '@nestjs/config';

// RabbitMQ config
export const getRabbitMQHost = (configService: ConfigService): string =>
  configService.get<string>('RABBITMQ_HOST');

export const getRabbitMQPort = (configService: ConfigService): number =>
  configService.get<number>('RABBITMQ_PORT');

export const getRabbitMQUser = (configService: ConfigService): string =>
  configService.get<string>('RABBITMQ_USER');

export const getRabbitMQPassword = (configService: ConfigService): string =>
  configService.get<string>('RABBITMQ_PASSWORD');

export const getRabbitMQUrl = (configService: ConfigService): string =>
  `amqp://${getRabbitMQUser(configService)}:${getRabbitMQPassword(
    configService,
  )}@${getRabbitMQHost(configService)}:${getRabbitMQPort(configService)}`;

// MongoDB config
export const getNodeEnv = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV');

const mongoUser = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_USER')
    : 'admin';

const mongoPass = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_PASSWORD')
    : 'admin';

const mongoHost = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_HOST')
    : 'localhost';

const mongoPort = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_PORT')
    : '27017';

const mongoDb = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_DB')
    : 'transaction_db';

export const mongoUri = (configService: ConfigService): string =>
  `mongodb://${mongoUser(configService)}:${mongoPass(
    configService,
  )}@${mongoHost(configService)}:${mongoPort(configService)}/`;

// Postgres config
export const getPostgresHost = (configService: ConfigService): string =>
  configService.get<string>('POSTGRES_HOST');

export const getPostgresPort = (configService: ConfigService): number =>
  configService.get<number>('POSTGRES_PORT');

export const getPostgresUser = (configService: ConfigService): string =>
  configService.get<string>('POSTGRES_USER');

export const getPostgresPassword = (configService: ConfigService): string =>
  configService.get<string>('POSTGRES_PASSWORD');

export const getPostgresDb = (configService: ConfigService): string =>
  configService.get<string>('POSTGRES_DB');
