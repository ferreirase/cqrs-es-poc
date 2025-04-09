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
    transactionId: string;
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    description: string;
  };
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
  async handleWithdrawalCommand(msg: any): Promise<void> {
    const handlerName = 'WithdrawalHandler';
    const startTime = Date.now();

    const queueMessage = JSON.parse(
      msg as unknown as string,
    ) as WithdrawalMessage;

    // Validação robusta da mensagem recebida
    if (!queueMessage || typeof queueMessage !== 'object') {
      this.loggingService.error(
        `[${handlerName}] Received invalid message format: ${typeof queueMessage}`,
        { receivedMessage: JSON.stringify(queueMessage) },
      );
      // Não relance o erro - isso apenas reenviaria a mensagem para a fila em loop
      return;
    }

    // Log da mensagem recebida para debug
    this.loggingService.info(`[${handlerName}] Received message from queue:`, {
      receivedMessage: JSON.stringify(queueMessage),
    });

    // Validar a estrutura da mensagem
    if (!queueMessage.payload || typeof queueMessage.payload !== 'object') {
      this.loggingService.error(
        `[${handlerName}] Missing or invalid payload in message`,
        { receivedMessage: JSON.stringify(queueMessage) },
      );
      // Não relance o erro - isso apenas reenviaria a mensagem para a fila em loop
      return;
    }

    // Validar campos obrigatórios
    const { sourceAccountId, destinationAccountId, amount, description } =
      queueMessage.payload;

    if (!sourceAccountId || !amount) {
      this.loggingService.error(
        `[${handlerName}] Missing required fields in payload`,
        {
          receivedPayload: JSON.stringify(queueMessage.payload),
          sourceAccountId: sourceAccountId || 'MISSING',
          amount: amount || 'MISSING',
        },
      );
      // Não relance o erro - isso apenas reenviaria a mensagem para a fila em loop
      return;
    }

    try {
      // Se já existe um ID na mensagem (reprocessamento), verificar se a transação já existe
      if (queueMessage.payload.transactionId) {
        const existingTransaction =
          await this.transactionAggregateRepository.findOneByTransactionId(
            queueMessage.payload.transactionId,
          );

        if (existingTransaction) {
          this.loggingService.info(
            `[${handlerName}] Transaction ${queueMessage.payload.transactionId} already exists, skipping processing`,
            { transactionId: queueMessage.payload.transactionId },
          );
          return; // Evita reprocessamento
        }
      }

      const transactionId = queueMessage.payload.transactionId || uuidv4();

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
        { operation: 'published_check_balance_command' },
      );

      return;
    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;

      this.loggingService.logCommandError(handlerName, error, {
        payload: queueMessage.payload,
        executionTime,
      });
      // Consider implementing retry/dead-letter queue logic here
      // For now, just rethrow
      throw error;
    }
  }
}
