import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import {
  TransactionEntity,
  TransactionStatus,
} from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

// Define the expected message structure from RabbitMQ
interface ReleaseBalanceMessage {
  commandName: 'ReleaseBalanceCommand';
  payload: {
    transactionId: string;
    accountId: string; // Source Account ID whose balance needs release
    amount: number;
    reason: string; // Reason for compensation
  };
}

@Injectable()
export class ReleaseBalanceHandler {
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
  ) {}

  @RabbitSubscribe({
    exchange: 'paymaker-exchange', // Ensure this matches your config
    routingKey: 'commands.release_balance',
    queue: 'release_balance_commands_queue', // Define a queue name
    queueOptions: {
      durable: true,
    },
  })
  async handleReleaseBalanceCommand(msg: ReleaseBalanceMessage): Promise<void> {
    const handlerName = 'ReleaseBalanceHandler';
    const startTime = Date.now();

    const queueMessage = JSON.parse(
      msg as unknown as string,
    ) as ReleaseBalanceMessage;

    const { transactionId, accountId, amount, reason } = queueMessage.payload;

    this.loggingService.logHandlerStart(handlerName, {
      ...queueMessage.payload,
    });

    // Keep TypeORM transaction for consistency
    const queryRunner =
      this.accountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let compensationSuccess = false;
    let compensationError: string | undefined = undefined;

    try {
      // 1. Fetch transaction to check current status
      const transaction = await queryRunner.manager
        .getRepository(TransactionEntity)
        .findOne({
          where: { id: transactionId },
        });

      if (!transaction) {
        // If transaction not found, maybe already compensated or never existed?
        // Log a warning and potentially exit gracefully.
        this.loggingService.warn(
          `[${handlerName}] Transaction ${transactionId} not found. Assuming already compensated or does not exist.`,
          { transactionId, accountId },
        );
        await queryRunner.commitTransaction(); // Commit empty transaction
        // Do not publish BalanceReleasedEvent if TX not found
        return;
      }

      // 2. Check if compensation is possible/needed
      if (
        transaction.status === TransactionStatus.CONFIRMED ||
        transaction.status === TransactionStatus.COMPLETED
      ) {
        // Cannot compensate a completed/confirmed transaction
        throw new Error(
          `Cannot release balance for transaction ${transactionId} already in status ${transaction.status}`,
        );
      }
      if (
        transaction.status === TransactionStatus.FAILED ||
        transaction.status === TransactionStatus.CANCELED
      ) {
        // Already failed/cancelled, potentially compensated. Log and exit.
        this.loggingService.warn(
          `[${handlerName}] Transaction ${transactionId} is already in status ${transaction.status}. Skipping release balance.`,
          { transactionId, accountId },
        );
        await queryRunner.commitTransaction(); // Commit empty transaction
        // Do not publish BalanceReleasedEvent again
        return;
      }

      // 3. Fetch account (lock for update)
      const account = await queryRunner.manager
        .getRepository(AccountEntity)
        .findOne({
          where: { id: accountId },
          lock: { mode: 'pessimistic_write' },
        });

      if (!account) {
        // Account must exist if balance was reserved/processed
        throw new NotFoundException(
          `Account with ID "${accountId}" not found during balance release.`,
        );
      }

      // 4. Reverse balance ONLY if transaction was processed (debited)
      let balanceReversed = false;
      if (transaction.status === TransactionStatus.PROCESSED) {
        this.loggingService.info(
          `[${handlerName}] Transaction ${transactionId} was PROCESSED. Reversing balance for account ${accountId}.`,
        );
        account.balance = Number(account.balance) + Number(amount); // Add back the amount
        account.updatedAt = new Date();
        await queryRunner.manager.save(account);
        balanceReversed = true;
      } else {
        this.loggingService.info(
          `[${handlerName}] Transaction ${transactionId} status is ${transaction.status}. No balance reversal needed for account ${accountId}.`,
        );
      }

      // 5. Update transaction status to FAILED
      const previousStatus = transaction.status;
      transaction.status = TransactionStatus.FAILED; // Final state after compensation
      transaction.error = reason; // Store the reason for failure
      transaction.updatedAt = new Date();
      await queryRunner.manager.save(transaction);
      this.loggingService.info(
        `[${handlerName}] Transaction ${transactionId} status updated from ${previousStatus} to ${transaction.status}.`,
      );

      // 6. Load the transaction aggregate
      // Use repository outside queryRunner to load aggregate state from events
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        // This is less critical here, but log a warning
        this.loggingService.warn(
          `[${handlerName}] Transaction aggregate ${transactionId} not found while releasing balance. Event might not reflect latest state.`,
          { transactionId, accountId },
        );
        // Proceed with commit even if aggregate isn't found for event publishing
      } else {
        // 7. Apply the releaseBalance event to the aggregate
        transactionAggregate.releaseBalance(
          transactionId,
          accountId,
          amount,
          true, // Mark compensation operation as successful
          reason, // Pass the original reason
          undefined, // No error in the release operation itself
        );

        // 8. Save aggregate (publishes BalanceReleasedEvent)
        await this.transactionAggregateRepository.save(transactionAggregate);
        this.loggingService.info(
          `[${handlerName}] Applied releaseBalance to aggregate ${transactionId}.`,
        );
      }

      // 9. Commit the database transaction
      await queryRunner.commitTransaction();
      compensationSuccess = true;

      this.loggingService.info(
        `[${handlerName}] Successfully released/compensated balance for transaction ${transactionId}, account ${accountId}. Balance reversed: ${balanceReversed}`,
      );
    } catch (error) {
      // Rollback database transaction on error
      await queryRunner.rollbackTransaction();
      compensationSuccess = false;
      compensationError = error.message;

      this.loggingService.error(
        `[${handlerName}] Error releasing balance: ${error.message}`,
        {
          transactionId,
          accountId,
          amount,
          reason,
          error: error.stack,
          payload: queueMessage.payload,
        },
      );

      // Attempt to load aggregate again to publish failure event for the *compensation itself*
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Publish failure event via aggregate for the release operation
          transactionAggregate.releaseBalance(
            transactionId,
            accountId,
            amount,
            false, // Mark compensation operation as failed
            reason, // Original reason
            compensationError, // Error during this release attempt
          );
          await this.transactionAggregateRepository.save(transactionAggregate);
          this.loggingService.warn(
            `[${handlerName}] Recorded balance release failure in aggregate due to error.`,
            { transactionId },
          );
        } else {
          this.loggingService.error(
            `[${handlerName}] Aggregate ${transactionId} not found for failure reporting during release error.`,
          );
        }
      } catch (aggError) {
        this.loggingService.error(
          `[${handlerName}] Error saving aggregate during release error handling: ${aggError.message}`,
          { transactionId, error: aggError.stack },
        );
      }

      throw error; // Rethrow original error
    } finally {
      // Release the query runner
      await queryRunner.release();
      const executionTime = (Date.now() - startTime) / 1000;
      if (compensationSuccess) {
        this.loggingService.logCommandSuccess(
          handlerName,
          queueMessage.payload,
          executionTime,
          { operation: 'balance_released_event_published' },
        );
      } else {
        this.loggingService.logCommandError(
          handlerName,
          new Error(compensationError || 'Release balance failed'),
          queueMessage.payload,
        );
      }
      this.loggingService.info(
        `[${handlerName}] Finished processing message for ${transactionId}/${accountId}.`,
      );
    }
  }
}
