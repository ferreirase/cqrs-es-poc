import { ConfigService } from '@nestjs/config';

export const getRabbitMQUrl = (configService: ConfigService): string =>
  configService.getOrThrow<string>('RABBITMQ_URL');

export const getNodeEnv = (configService: ConfigService): string =>
  configService.getOrThrow<string>('NODE_ENV');

export const getMongoUri = (configService: ConfigService): string =>
  configService.getOrThrow<string>('MONGO_URI');
('mongodb://localhost:27017/transaction_query_db');

// postgres config
export const getPostgresHost = (configService: ConfigService): string =>
  configService.getOrThrow<string>('POSTGRES_HOST');

export const getPostgresPort = (configService: ConfigService): number =>
  configService.getOrThrow<number>('POSTGRES_PORT');

export const getPostgresUser = (configService: ConfigService): string =>
  configService.getOrThrow<string>('POSTGRES_USER');

export const getPostgresPassword = (configService: ConfigService): string =>
  configService.getOrThrow<string>('POSTGRES_PASSWORD');

export const getPostgresDb = (configService: ConfigService): string =>
  configService.getOrThrow<string>('POSTGRES_DB');
