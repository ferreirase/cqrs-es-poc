import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { v4 as uuidv4 } from 'uuid';
import { EventStoreService } from '../../../common/events/event-store.service';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionAggregate } from '../../aggregates/transaction.aggregate';
import { TransactionType } from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';
import { TransactionContextService } from '../../services/transaction-context.service';

// Define the expected message structure
interface WithdrawalMessage {
  commandName: 'WithdrawalCommand';
  payload: {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    description: string;
  };
  // Add correlationId, etc., if needed
}

@Injectable()
// @CommandHandler(WithdrawalCommand)
export class WithdrawalHandler /* implements ICommandHandler<WithdrawalCommand> */ {
  constructor(
    // private commandBus: CommandBus,
    private rabbitMQService: RabbitMQService,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private eventStoreService: EventStoreService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private transactionContextService: TransactionContextService,
  ) {}

  @RabbitSubscribe({
    exchange: 'paymaker-exchange',
    routingKey: 'commands.withdrawal',
    queue: 'withdrawal_commands_queue',
    queueOptions: {
      durable: true,
    },
  })
  async handleWithdrawalCommand(msg: WithdrawalMessage): Promise<void> {
    const handlerName = 'WithdrawalHandler';
    const startTime = Date.now();

    try {
      const { sourceAccountId, destinationAccountId, amount, description } =
        msg.payload;

      const transactionId = uuidv4();

      this.loggingService.logHandlerStart(handlerName, {
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        description,
      });

      const transactionAggregate = new TransactionAggregate();

      transactionAggregate.createTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      await this.transactionAggregateRepository.save(transactionAggregate);

      await new Promise(resolve => setTimeout(resolve, 100));

      await this.transactionContextService.setInitialContext(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      const checkBalancePayload = {
        commandName: 'CheckAccountBalanceCommand',
        payload: {
          transactionId,
          accountId: sourceAccountId,
          amount,
        },
      };

      await this.rabbitMQService.publishToExchange(
        'commands.check_balance',
        checkBalancePayload,
      );

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId, sourceAccountId, amount },
        executionTime,
        { operation: 'published_check_balance' },
      );

      return;
    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandError(handlerName, error, {
        payload: msg.payload,
      });
      // Consider implementing retry/dead-letter queue logic here
      // For now, just rethrow
      throw error;
    }
  }

  // Removed original execute method
  /*
  async execute(command: WithdrawalCommand): Promise<void> {
    try {
      const { id, sourceAccountId, destinationAccountId, amount, description } =
        command;

      const transactionId = id || uuidv4();

      this.loggingService.info(
        `[WithdrawalHandler] Starting withdrawal saga for transaction: ${transactionId}`,
        { transactionId, sourceAccountId, destinationAccountId, amount },
      );

      // Criar um novo agregado de transação
      const transactionAggregate = new TransactionAggregate();

      // Aplicar o evento de criação de transação ao agregado
      transactionAggregate.createTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      // Salvar o agregado - IMPORTANTE: isso publica os eventos, incluindo TransactionCreatedEvent
      await this.transactionAggregateRepository.save(transactionAggregate);

      // Aguarde assincronamente para garantir que o evento foi processado
      await new Promise(resolve => setTimeout(resolve, 100));

      // Armazenar o contexto inicial da transação no TransactionContextService
      await this.transactionContextService.setInitialContext(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      // Iniciar a saga verificando o saldo da conta
      await this.commandBus.execute(
        new CheckAccountBalanceCommand(transactionId, sourceAccountId, amount),
      );

      this.loggingService.info(
        `[WithdrawalHandler] Withdrawal saga started for transaction ${transactionId}`,
      );

      return;
    } catch (error) {
      this.loggingService.error(
        `[WithdrawalHandler] Error starting withdrawal saga: ${error.message}`,
        { error: error.message, stack: error.stack },
      );

      throw error;
    }
  }
  */
}
