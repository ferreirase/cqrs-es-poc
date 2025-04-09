import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

// Define the expected message structure
interface CheckBalanceMessage {
  commandName: 'CheckAccountBalanceCommand';
  payload: {
    transactionId: string;
    accountId: string;
    amount: number;
  };
}

@Injectable()
/* implements ICommandHandler<CheckAccountBalanceCommand> */
export class CheckAccountBalanceHandler {
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
  ) {}

  @RabbitSubscribe({
    exchange: 'paymaker-exchange', // Ensure this matches your config
    routingKey: 'commands.check_balance',
    queue: 'check_balance_commands_queue', // Define a queue name
    queueOptions: {
      durable: true,
    },
  })
  async handleCheckBalanceCommand(msg: CheckBalanceMessage): Promise<void> {
    const message = JSON.parse(msg as unknown as string) as CheckBalanceMessage;

    const handlerName = 'CheckAccountBalanceHandler';
    const startTime = Date.now();

    // Extract data from message
    const { transactionId, accountId, amount } = message.payload;

    this.loggingService.logHandlerStart(handlerName, {
      transactionId,
      accountId,
      amount,
    });

    try {
      const account = await this.accountRepository.findOne({
        where: { id: accountId },
      });

      if (!account) {
        throw new NotFoundException(`Account with ID "${accountId}" not found`);
      }

      const isBalanceSufficient = account.balance >= amount;

      this.loggingService.info(
        `[${handlerName}] Account ${accountId} balance: ${account.balance}, required: ${amount}, sufficient: ${isBalanceSufficient}`,
        { transactionId },
      );

      // Load the transaction aggregate
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        throw new NotFoundException(
          `Transaction aggregate with ID "${transactionId}" not found`,
        );
      }

      // Update transaction status in the aggregate (via event)
      transactionAggregate.checkBalance(
        transactionId,
        accountId,
        isBalanceSufficient,
        amount,
      );

      // Apply and publish events (e.g., BalanceCheckedEvent)
      await this.transactionAggregateRepository.save(transactionAggregate);

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId, accountId, isBalanceSufficient },
        executionTime,
        { operation: 'balance_checked_and_event_published' },
      );
    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.error(
        `[${handlerName}] Error checking balance: ${error.message}`,
        { transactionId, accountId, amount, error: error.stack },
      );

      // Attempt to load the transaction aggregate to record the failure
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Update transaction status in the aggregate (failure event)
          transactionAggregate.checkBalance(
            transactionId,
            accountId,
            false,
            amount,
          );

          // Apply and publish failure event
          await this.transactionAggregateRepository.save(transactionAggregate);
          this.loggingService.warn(
            `[${handlerName}] Recorded balance check failure in aggregate due to error.`,
            { transactionId },
          );
        } else {
          this.loggingService.error(
            `[${handlerName}] Could not find aggregate ${transactionId} to record balance check failure.`,
            { error: error.stack },
          );
        }
      } catch (aggError) {
        this.loggingService.error(
          `[${handlerName}] Error updating transaction aggregate after balance check failure: ${aggError.message}`,
          { transactionId, error: aggError.stack },
        );
      }

      throw error;
    }
  }
}
