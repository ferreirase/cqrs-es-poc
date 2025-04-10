import { config } from 'dotenv'; // Opcional: Para carregar .env localmente
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AccountEntity } from '../../src/accounts/models/account.entity';
import { EventEntity } from '../../src/common/events/event.entity';
import { TransactionEntity } from '../../src/transactions/models/transaction.entity';
import { UserEntity } from '../../src/users/models/user.entity';

// Carrega variáveis do .env se existir (para desenvolvimento)
config();

/**
 * Resolve caminhos absolutos para migrations
 *
 * Em desenvolvimento: aponta para ./src/database/migrations/*.ts
 * Em produção: aponta para ./dist/src/database/migrations/*.js
 *
 * Ambos funcionam independente de onde a aplicação é executada,
 * graças ao uso de path.resolve() que converte para caminhos absolutos.
 */
const migrationsDir = path.resolve(__dirname, '../../src/database/migrations');

// Verificar se estamos em ambiente de produção (usando os arquivos compilados)
const isProduction = process.env.NODE_ENV === 'production';
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Database: ${process.env.POSTGRES_DB || 'local_db'}`);
console.log(`Host: ${process.env.POSTGRES_HOST || 'localhost'}`);

const migrationPattern = isProduction
  ? `${migrationsDir.replace('/src/', '/dist/src/')}/*.js` // Versão compilada em produção
  : `${migrationsDir}/*.{ts,js}`; // Versão TypeScript em desenvolvimento

// Lê as variáveis de ambiente injetadas pelo Kubernetes ConfigMap em produção
const options: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'transaction_db',

  // Lista explícita de entidades
  entities: [UserEntity, AccountEntity, TransactionEntity, EventEntity],

  // Diretório onde as migrations serão encontradas (usando caminho absoluto)
  migrations: [migrationPattern],

  // NÃO use synchronize: true com migrations!
  synchronize: false,

  // Habilita logging de migração (opcional)
  logging: true,
  migrationsRun: false, // Não rodar automaticamente na conexão
  migrationsTableName: 'typeorm_migrations', // Nome da tabela de controle
};

// DataSource é usado pela CLI do TypeORM v0.3+
export const AppDataSource = new DataSource(options);
