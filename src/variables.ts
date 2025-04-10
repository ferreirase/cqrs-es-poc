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

const user = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_USER')
    : 'admin';

const pass = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_PASSWORD')
    : 'mongodb';

const host = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_HOST')
    : 'localhost';

const port = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_PORT')
    : '27017';

const db = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_DB')
    : 'transaction_db';

const authSource = (configService: ConfigService): string =>
  configService.get<string>('NODE_ENV') === 'production'
    ? configService.get<string>('MONGO_AUTH_SOURCE')
    : 'admin';

export const mongoUri = (configService: ConfigService): string =>
  `mongodb://${user(configService)}:${pass(configService)}@${host(
    configService,
  )}:${port(configService)}/${db(configService)}?authSource=${authSource(
    configService,
  )}`;

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
