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

    if (
      !msg ||
      typeof msg !== 'object' ||
      !msg.payload ||
      typeof msg.payload !== 'object'
    ) {
      this.loggingService.error(
        `[${handlerName}] Received invalid message structure. Missing or invalid payload.`,
        { receivedMessage: msg },
      );
      throw new Error(
        'Invalid message structure received by ProcessTransactionHandler',
      );
    }

    const { transactionId } = msg.payload;

    if (!transactionId) {
      this.loggingService.error(
        `[${handlerName}] Invalid payload content received. Missing transactionId.`,
        { payload: msg.payload },
      );
      throw new Error(
        'Invalid payload content for ProcessTransactionCommand: Missing transactionId',
      );
    }

    this.loggingService.logHandlerStart(handlerName, { transactionId });

    let transactionDetails: TransactionEntity | null = null;
    let sourceAccountId: string;
    let destinationAccountId: string;
    let amount: number;
    let description: string;
    let transactionType: TransactionType;

    const queryRunner =
      this.accountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      transactionDetails = await queryRunner.manager.findOne(
        TransactionEntity,
        {
          where: { id: transactionId },
        },
      );

      if (!transactionDetails) {
        let retries = 5;
        while (retries > 0 && !transactionDetails) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          transactionDetails = await queryRunner.manager.findOne(
            TransactionEntity,
            {
              where: { id: transactionId },
            },
          );
          retries--;

          this.loggingService.info(
            `[${handlerName}] Retrying to find transaction ${transactionId}... (${retries} retries left)`,
          );
        }

        if (!transactionDetails) {
          throw new NotFoundException(
            `Transaction details not found for ID: ${transactionId} after retries`,
          );
        }
      }

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

      if (Number(sourceAccount.balance) < Number(amount)) {
        throw new Error(
          `Insufficient balance in source account ${sourceAccountId}`,
        );
      }

      const sourcePreviousBalance = sourceAccount.balance;
      const destPreviousBalance = destinationAccount
        ? destinationAccount.balance
        : null;

      sourceAccount.balance = Number(sourceAccount.balance) - Number(amount);
      sourceAccount.updatedAt = new Date();
      await queryRunner.manager.save(sourceAccount);

      if (destinationAccount) {
        destinationAccount.balance =
          Number(destinationAccount.balance) + Number(amount);
        destinationAccount.updatedAt = new Date();
        await queryRunner.manager.save(destinationAccount);
      }

      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        throw new NotFoundException(
          `CRITICAL: Transaction aggregate not found for ID ${transactionId} during processing.`,
        );
      }

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

      await this.transactionAggregateRepository.save(transactionAggregate);

      this.loggingService.info(
        `[${handlerName}] Transaction aggregate ${transactionId} status updated to PROCESSED`,
      );

      await queryRunner.commitTransaction();

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
          payload: msg.payload,
        },
      );

      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
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
