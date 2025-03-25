import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ProcessTransactionCommand } from '../commands/impl/process-transaction.command';

interface ScheduledTransaction {
  id: string;
  executeAt: Date;
}

@Injectable()
export class TransactionSchedulerService {
  private scheduledTransactions: Map<string, ScheduledTransaction> = new Map();

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly commandBus: CommandBus,
  ) {
    // Run a job every minute to check for transactions to process
    this.setupPeriodicCheck();
  }

  /**
   * Schedule a transaction to be processed after the specified delay
   * @param transactionId The ID of the transaction to process
   * @param delayInMilliseconds Delay in milliseconds (defaults to 1 minute)
   */
  scheduleTransaction(
    transactionId: string,
    delayInMilliseconds = 30000, // 30 seconds
  ): void {
    const executeAt = new Date(Date.now() + delayInMilliseconds);

    this.scheduledTransactions.set(transactionId, {
      id: transactionId,
      executeAt,
    });

    console.log(
      `Transaction ${transactionId} scheduled for processing at ${executeAt.toISOString()}`,
    );
  }

  /**
   * Setup a job that runs every 10 seconds to check for transactions ready to be processed
   */
  private setupPeriodicCheck(): void {
    const job = new CronJob('*/10 * * * * *', () => {
      this.processReadyTransactions();
    });

    this.schedulerRegistry.addCronJob('process-scheduled-transactions', job);
    job.start();
  }

  /**
   * Process all transactions that are due
   */
  private async processReadyTransactions(): Promise<void> {
    const now = new Date();
    const transactionsToProcess: string[] = [];

    // Find transactions that are ready to be processed
    this.scheduledTransactions.forEach((transaction, id) => {
      if (transaction.executeAt <= now) {
        transactionsToProcess.push(id);
      }
    });

    // Process each transaction and remove from the scheduled list
    for (const transactionId of transactionsToProcess) {
      try {
        console.log(`Processing scheduled transaction ${transactionId}`);
        await this.commandBus.execute(
          new ProcessTransactionCommand(transactionId),
        );
      } catch (error) {
        console.error(
          `Error processing transaction ${transactionId}:`,
          error.message,
        );
      } finally {
        this.scheduledTransactions.delete(transactionId);
      }
    }
  }
}
