import { Module, OnModuleInit } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountsModule } from '../accounts/accounts.module';
import { AccountEntity } from '../accounts/models/account.entity';
import { AccountSchema } from '../accounts/models/account.schema';
import { EventDeduplicationService } from '../common/events/event-deduplication.service';
import { EventStoreService } from '../common/events/event-store.service';
import { EventEntity } from '../common/events/event.entity';
import { RabbitMQModule } from '../common/messaging/rabbitmq.module';
import { RabbitMQService } from '../common/messaging/rabbitmq.service';
import { MonitoringModule } from '../common/monitoring/monitoring.module';
import { TransactionContextService } from '../transactions/services/transaction-context.service';
import { UserEntity } from '../users/models/user.entity';
import { UserSchema } from '../users/models/user.schema';
import { TransactionAggregate } from './aggregates/transaction.aggregate';
import { CreateTransactionHandler } from './commands/handlers/create-transaction.handler';
import { ProcessTransactionHandler as ExistingProcessTransactionHandler } from './commands/handlers/process-transaction.handler';
import { SagaCommandHandlers } from './commands/handlers/saga-handlers.index';
import { TransactionsController } from './controllers/transactions.controller';
import { EventHandlers } from './events/handlers';
import { TransactionEntity } from './models/transaction.entity';
import {
  TransactionDocument,
  TransactionSchema,
} from './models/transaction.schema';
import { GetAccountTransactionsHandler } from './queries/handlers/get-account-transactions.handler';
import { GetAllTransactionsHandler } from './queries/handlers/get-all-transactions.handler';
import { GetTransactionHandler } from './queries/handlers/get-transaction.handler';
import { TransactionAggregateRepository } from './repositories/transaction-aggregate.repository';
import { WithdrawalSaga } from './sagas/withdrawal.saga';

const CommandHandlers = [CreateTransactionHandler, ...SagaCommandHandlers];
const QueryHandlers = [
  GetTransactionHandler,
  GetAccountTransactionsHandler,
  GetAllTransactionsHandler,
];
const Sagas = [WithdrawalSaga];
const Aggregates = [TransactionAggregate];
const Repositories = [TransactionAggregateRepository];

@Module({
  imports: [
    CqrsModule,
    RabbitMQModule,
    MonitoringModule,
    TypeOrmModule.forFeature([
      TransactionEntity,
      EventEntity,
      UserEntity,
      AccountEntity,
    ]),
    MongooseModule.forFeature([
      { name: TransactionDocument.name, schema: TransactionSchema },
      { name: 'UserDocument', schema: UserSchema },
      { name: 'AccountDocument', schema: AccountSchema },
    ]),
    AccountsModule,
  ],
  controllers: [TransactionsController],
  providers: [
    EventDeduplicationService,
    EventStoreService,
    TransactionContextService,
    ExistingProcessTransactionHandler,
    ...CommandHandlers,
    ...EventHandlers,
    ...QueryHandlers,
    ...Sagas,
    ...Aggregates,
    ...Repositories,
  ],
})
export class TransactionsModule implements OnModuleInit {
  constructor(private readonly rabbitMQService: RabbitMQService) {}

  private readonly exchangeName = 'paymaker-exchange';

  async onModuleInit() {
    // Criar e vincular todas as filas necessárias para o fluxo de transações
    try {
      // Fila de comandos de saque
      await this.rabbitMQService.createQueueAndBind(
        'withdrawal_commands_queue',
        'commands.withdrawal',
        {
          durable: true,
          exchangeName: this.exchangeName,
        },
      );

      // Fila de verificação de saldo
      await this.rabbitMQService.createQueueAndBind(
        'check_balance_commands_queue',
        'commands.check_balance',
        {
          durable: true,
          exchangeName: this.exchangeName,
        },
      );

      // Fila de reserva de saldo
      await this.rabbitMQService.createQueueAndBind(
        'reserve_balance_commands_queue',
        'commands.reserve_balance',
        {
          durable: true,
          exchangeName: this.exchangeName,
        },
      );

      // Fila de processamento de transação
      await this.rabbitMQService.createQueueAndBind(
        'process_transaction_commands_queue',
        'commands.process_transaction',
        {
          durable: true,
          exchangeName: this.exchangeName,
        },
      );

      // Fila de confirmação de transação
      await this.rabbitMQService.createQueueAndBind(
        'confirm_transaction_commands_queue',
        'commands.confirm_transaction',
        {
          durable: true,
          exchangeName: this.exchangeName,
        },
      );

      // Fila de atualização de extrato
      await this.rabbitMQService.createQueueAndBind(
        'update_statement_commands_queue',
        'commands.update_statement',
        {
          durable: true,
          exchangeName: this.exchangeName,
        },
      );

      // Fila de notificação de usuário
      await this.rabbitMQService.createQueueAndBind(
        'notify_user_commands_queue',
        'commands.notify_user',
        {
          durable: true,
          exchangeName: this.exchangeName,
        },
      );

      // Fila de liberação de saldo (compensação)
      await this.rabbitMQService.createQueueAndBind(
        'release_balance_commands_queue',
        'commands.release_balance',
        {
          durable: true,
          exchangeName: this.exchangeName,
        },
      );

      console.log(
        '✅ Todas as filas RabbitMQ foram criadas e vinculadas com sucesso!',
      );
    } catch (error) {
      console.error('❌ Erro ao inicializar filas RabbitMQ:', error);
      throw error;
    }
  }
}
