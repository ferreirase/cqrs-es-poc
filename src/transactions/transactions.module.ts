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
import { RabbitMQWorkerService } from '../common/workers';
import { UserEntity } from '../users/models/user.entity';
import { UserSchema } from '../users/models/user.schema';

import { TransactionAggregate } from './aggregates/transaction.aggregate';
import { CreateTransactionHandler } from './commands/handlers/create-transaction.handler';
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
import { TransactionContextService } from './services/transaction-context.service';

import { CheckAccountBalanceHandler } from './commands/handlers/check-account-balance.handler';
import { ProcessTransactionHandler } from './commands/handlers/process-transaction.handler';
import { ReserveBalanceHandler } from './commands/handlers/reserve-balance.handler';
import { WithdrawalHandler } from './commands/handlers/withdrawal.handler';

const AllCommandHandlers = [CreateTransactionHandler, ...SagaCommandHandlers];

const AllQueryHandlers = [
  GetTransactionHandler,
  GetAccountTransactionsHandler,
  GetAllTransactionsHandler,
];

const AllSagas = [WithdrawalSaga];

const AllAggregates = [TransactionAggregate];

const AllRepositories = [TransactionAggregateRepository];

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
    RabbitMQWorkerService,
    ...AllCommandHandlers,
    ...EventHandlers,
    ...AllQueryHandlers,
    ...AllSagas,
    ...AllAggregates,
    ...AllRepositories,
  ],
})
export class TransactionsModule implements OnModuleInit {
  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly rabbitMQWorkerService: RabbitMQWorkerService,
    private readonly withdrawalHandlerInstance: WithdrawalHandler,
    private readonly checkAccountBalanceHandlerInstance: CheckAccountBalanceHandler,
    private readonly reserveBalanceHandlerInstance: ReserveBalanceHandler,
    private readonly processTransactionHandlerInstance: ProcessTransactionHandler,
  ) {}

  private readonly exchangeName = 'paymaker-exchange';

  async onModuleInit() {
    try {
      try {
        await this.rabbitMQService.setPrefetchCount(1);
        console.log(
          '✅ RabbitMQ prefetch count configurado para 1 em todos os consumidores',
        );
      } catch (error) {
        console.error('❌ Erro ao configurar RabbitMQ prefetch count:', error);
      }

      await this.rabbitMQService.createQueueAndBind(
        'withdrawal_commands_queue',
        'commands.withdrawal',
        { durable: true, exchangeName: this.exchangeName },
      );
      await this.rabbitMQService.createQueueAndBind(
        'check_balance_commands_queue',
        'commands.check_balance',
        { durable: true, exchangeName: this.exchangeName },
      );
      await this.rabbitMQService.createQueueAndBind(
        'reserve_balance_commands_queue',
        'commands.reserve_balance',
        { durable: true, exchangeName: this.exchangeName },
      );
      await this.rabbitMQService.createQueueAndBind(
        'process_transaction_commands_queue',
        'commands.process_transaction',
        { durable: true, exchangeName: this.exchangeName },
      );
      await this.rabbitMQService.createQueueAndBind(
        'confirm_transaction_commands_queue',
        'commands.confirm_transaction',
        { durable: true, exchangeName: this.exchangeName },
      );
      await this.rabbitMQService.createQueueAndBind(
        'update_statement_commands_queue',
        'commands.update_statement',
        { durable: true, exchangeName: this.exchangeName },
      );
      await this.rabbitMQService.createQueueAndBind(
        'notify_user_commands_queue',
        'commands.notify_user',
        { durable: true, exchangeName: this.exchangeName },
      );
      await this.rabbitMQService.createQueueAndBind(
        'release_balance_commands_queue',
        'commands.release_balance',
        { durable: true, exchangeName: this.exchangeName },
      );

      console.log(
        '✅ Todas as filas RabbitMQ foram criadas e vinculadas com sucesso!',
      );

      // Comentado para evitar conflito com @RabbitSubscribe
      // await this.setupThreadedConsumers();
    } catch (error) {
      console.error('❌ Erro ao inicializar filas RabbitMQ:', error);
      throw error;
    }
  }

  /**
   * Configura o processamento multi-thread para filas de alto volume.
   * DEPRECATED: O handler agora usa @RabbitSubscribe diretamente.
   */
  /*
  private async setupThreadedConsumers() {
    try {
      // Registrar worker para WithdrawalHandler
      if (this.withdrawalHandlerInstance && this.withdrawalHandlerInstance.consumeWithdrawalCommand) { // CORRIGIDO: Verificar consumeWithdrawalCommand
        console.log('🧵 Configurando worker para withdrawal_commands_queue (via setupThreadedConsumers) - ISSO PODE CAUSAR DUPLICIDADE COM @RabbitSubscribe');
        await this.rabbitMQWorkerService.registerQueueWorker(
          'withdrawal_commands_queue',
          // CORRIGIDO: Usar consumeWithdrawalCommand
          this.withdrawalHandlerInstance.consumeWithdrawalCommand.bind(this.withdrawalHandlerInstance),
        );
      } else {
         console.warn('Instância ou método consumeWithdrawalCommand de WithdrawalHandler não disponível para worker.');
      }

      // ... (Registrar outros workers - MANTIDO PARA EXEMPLO, mas podem precisar de ajuste similar se também usarem @RabbitSubscribe)
      if (this.checkAccountBalanceHandlerInstance && this.checkAccountBalanceHandlerInstance.handleCheckBalanceCommand) {
        console.log('🧵 Configurando worker para check_balance_commands_queue');
        await this.rabbitMQWorkerService.registerQueueWorker(
          'check_balance_commands_queue',
          this.checkAccountBalanceHandlerInstance.handleCheckBalanceCommand.bind(this.checkAccountBalanceHandlerInstance),
        );
      } else {
        console.warn('Instância ou método handleCheckBalanceCommand de CheckAccountBalanceHandler não disponível para worker.');
      }

      if (this.reserveBalanceHandlerInstance && this.reserveBalanceHandlerInstance.handleReserveBalanceCommand) {
        console.log('🧵 Configurando worker para reserve_balance_commands_queue');
        await this.rabbitMQWorkerService.registerQueueWorker(
          'reserve_balance_commands_queue',
          this.reserveBalanceHandlerInstance.handleReserveBalanceCommand.bind(this.reserveBalanceHandlerInstance),
        );
      } else {
         console.warn('Instância ou método handleReserveBalanceCommand de ReserveBalanceHandler não disponível para worker.');
      }

      if (this.processTransactionHandlerInstance && this.processTransactionHandlerInstance.handleProcessTransactionCommand) {
        console.log('🧵 Configurando worker para process_transaction_commands_queue');
        await this.rabbitMQWorkerService.registerQueueWorker(
          'process_transaction_commands_queue',
          this.processTransactionHandlerInstance.handleProcessTransactionCommand.bind(this.processTransactionHandlerInstance),
        );
      } else {
         console.warn('Instância ou método handleProcessTransactionCommand de ProcessTransactionHandler não disponível para worker.');
      }

      console.log('✅ Processamento multi-thread configurado com sucesso! (via setupThreadedConsumers)');
    } catch (error) {
      console.error('❌ Erro ao configurar processamento multi-thread:', error);
    }
  }
  */
}
