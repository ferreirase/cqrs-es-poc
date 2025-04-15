import { Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountBalanceUpdatedEvent } from '../../../accounts/events/impl/account-balance-updated.event';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import {
  TransactionEntity,
  TransactionType,
} from '../../models/transaction.entity';
import { TransactionStatus } from '../../models/transaction.schema';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';
import { TransactionContextService } from '../../services/transaction-context.service';

// Define the expected message structure from RabbitMQ
interface ProcessTransactionMessage {
  commandName: 'ProcessTransactionCommand';
  payload: {
    transactionId: string;
    // Saga only sends ID, handler fetches details
  };
}

@Injectable()
export class ProcessTransactionHandler {
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private transactionContextService: TransactionContextService,
  ) {}

  async handleProcessTransactionCommand(
    msg: ProcessTransactionMessage,
  ): Promise<void> {
    const handlerName = 'ProcessTransactionHandler';
    const startTime = Date.now();

    const queueMessage = JSON.parse(
      msg as unknown as string,
    ) as ProcessTransactionMessage;

    const { transactionId } = queueMessage.payload;

    this.loggingService.logHandlerStart(handlerName, { transactionId });

    let transactionDetails: TransactionEntity | null = null;
    let sourceAccountId: string;
    let destinationAccountId: string;
    let amount: number;
    let description: string;
    let transactionType: TransactionType;

    // Keep TypeORM transaction logic here for atomic account updates
    const queryRunner =
      this.accountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Fetch transaction details needed for processing
      transactionDetails = await queryRunner.manager.findOne(
        TransactionEntity,
        {
          where: { id: transactionId },
        },
      );

      if (!transactionDetails) {
        throw new NotFoundException(
          `Transaction details not found for ID: ${transactionId}`,
        );
      }

      // Assign details to variables
      sourceAccountId = transactionDetails.sourceAccountId;
      destinationAccountId = transactionDetails.destinationAccountId;
      amount = transactionDetails.amount;
      description = transactionDetails.description;
      transactionType = transactionDetails.type;

      this.loggingService.info(
        `[${handlerName}] Fetched details for transaction: ${transactionId}`,
        {
          sourceAccountId,
          destinationAccountId,
          amount,
          type: transactionType,
        },
      );

      // 2. Lock and verify source and destination accounts
      const sourceAccount = await queryRunner.manager
        .getRepository(AccountEntity)
        .findOne({
          where: { id: sourceAccountId },
          lock: { mode: 'pessimistic_write' },
        });

      if (!sourceAccount) {
        throw new NotFoundException(
          `Source account with ID "${sourceAccountId}" not found`,
        );
      }

      // Check for destination account only if it exists (pure withdrawal might not have one)
      let destinationAccount: AccountEntity | null = null;
      if (destinationAccountId) {
        destinationAccount = await queryRunner.manager
          .getRepository(AccountEntity)
          .findOne({
            where: { id: destinationAccountId },
            lock: { mode: 'pessimistic_write' },
          });

        if (!destinationAccount) {
          throw new NotFoundException(
            `Destination account with ID "${destinationAccountId}" not found`,
          );
        }
      }

      // Verify source account balance
      if (Number(sourceAccount.balance) < Number(amount)) {
        throw new Error(
          `Insufficient balance in source account ${sourceAccountId}`,
        );
      }

      // Store previous balances for events
      const sourcePreviousBalance = sourceAccount.balance;
      const destPreviousBalance = destinationAccount
        ? destinationAccount.balance
        : null;

      // 3. Update account balances
      sourceAccount.balance = Number(sourceAccount.balance) - Number(amount);
      sourceAccount.updatedAt = new Date();
      await queryRunner.manager.save(sourceAccount);

      if (destinationAccount) {
        destinationAccount.balance =
          Number(destinationAccount.balance) + Number(amount);
        destinationAccount.updatedAt = new Date();
        await queryRunner.manager.save(destinationAccount);
      }

      // 4. Load the transaction aggregate
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        // If aggregate doesn't exist here, it's a major issue
        throw new NotFoundException(
          `CRITICAL: Transaction aggregate not found for ID ${transactionId} during processing.`,
        );
      }

      // 5. Apply the processTransaction event to the aggregate
      transactionAggregate.processTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        true,
        description,
        TransactionStatus.PROCESSED,
        transactionType,
      );

      // 6. Save aggregate (publishes TransactionProcessedEvent)
      await this.transactionAggregateRepository.save(transactionAggregate);

      this.loggingService.info(
        `[${handlerName}] Transaction aggregate ${transactionId} status updated to PROCESSED`,
      );

      // 7. Commit the database transaction (account updates)
      await queryRunner.commitTransaction();

      // 8. Publish account balance update events (consider moving to listeners)
      this.eventBus.publish(
        new AccountBalanceUpdatedEvent(
          sourceAccountId,
          sourcePreviousBalance,
          sourceAccount.balance,
          -amount,
        ),
      );

      if (destinationAccount) {
        this.eventBus.publish(
          new AccountBalanceUpdatedEvent(
            destinationAccountId,
            destPreviousBalance,
            destinationAccount.balance,
            amount,
          ),
        );
      }

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId, sourceAccountId, destinationAccountId, amount },
        executionTime,
        { operation: 'transaction_processed_and_committed' },
      );
    } catch (error) {
      // Rollback database transaction on any error
      await queryRunner.rollbackTransaction();

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.error(
        `[${handlerName}] Error processing transaction: ${error.message}`,
        {
          transactionId,
          sourceAccountId,
          destinationAccountId,
          amount,
          error: error.stack,
          payload: queueMessage.payload,
        },
      );

      // Attempt to load aggregate and record failure event
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Ensure we have necessary details for the failure event
          const finalSource =
            sourceAccountId || transactionDetails?.sourceAccountId;
          const finalDest =
            destinationAccountId || transactionDetails?.destinationAccountId;
          const finalAmount = amount ?? transactionDetails?.amount ?? 0;
          const finalDesc =
            description || transactionDetails?.description || 'N/A';
          const finalType =
            transactionType ||
            transactionDetails?.type ||
            TransactionType.WITHDRAWAL;

          if (finalSource && finalAmount > 0) {
            transactionAggregate.processTransaction(
              transactionId,
              finalSource,
              finalDest,
              finalAmount,
              false,
              finalDesc,
              TransactionStatus.FAILED,
              finalType,
            );
            await this.transactionAggregateRepository.save(
              transactionAggregate,
            );

            // Publish explicit failure event (optional, aggregate save already does)
            /*
               const failedEvent = new TransactionProcessedEvent(
                transactionId, finalSource, finalDest, finalAmount, false, finalDesc, TransactionStatus.FAILED, finalType, error.message
               );
               this.eventBus.publish(failedEvent);
               */
            this.loggingService.warn(
              `[${handlerName}] Recorded transaction processing failure in aggregate for ${transactionId}.`,
            );
          } else {
            this.loggingService.error(
              `[${handlerName}] Cannot record failure for ${transactionId}: Missing critical details (sourceAccount, amount).`,
            );
          }
        } else {
          this.loggingService.error(
            `[${handlerName}] Aggregate ${transactionId} not found for failure reporting.`,
          );
        }
      } catch (aggError) {
        this.loggingService.error(
          `[${handlerName}] Error saving aggregate during error handling: ${aggError.message}`,
          { transactionId, error: aggError.stack },
        );
      }

      throw error;
    } finally {
      await queryRunner.release();
      this.loggingService.info(
        `[${handlerName}] Finished processing message for ${transactionId}.`,
      );
    }
  }
}
