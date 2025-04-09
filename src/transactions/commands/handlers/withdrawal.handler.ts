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
    const queueMessage = JSON.parse(
      msg as unknown as string,
    ) as WithdrawalMessage;

    const handlerName = 'WithdrawalHandler';
    const startTime = Date.now();

    try {
      const { sourceAccountId, destinationAccountId, amount, description } =
        queueMessage.payload;

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
