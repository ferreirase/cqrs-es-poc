import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

// Define the expected message structure from RabbitMQ
// Based on TransactionProcessedEvent payload used in saga
interface ConfirmTransactionMessage {
  commandName: 'ConfirmTransactionCommand';
  payload: {
    transactionId: string;
    sourceAccountId: string;
    destinationAccountId: string | null;
    amount: number;
    // Description might not be strictly needed for confirmation logic itself,
    // but could be fetched if required for the event.
    // For now, assume aggregate.confirmTransaction handles null description.
  };
}

@Injectable()
export class ConfirmTransactionHandler {
  constructor(
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private eventBus: EventBus,
  ) {}

  @RabbitSubscribe({
    exchange: 'paymaker-exchange', // Ensure this matches your config
    routingKey: 'commands.confirm_transaction',
    queue: 'confirm_transaction_commands_queue', // Define a queue name
    queueOptions: {
      durable: true,
    },
  })
  async handleConfirmTransactionCommand(
    msg: ConfirmTransactionMessage,
  ): Promise<void> {
    const handlerName = 'ConfirmTransactionHandler';
    const startTime = Date.now();

    const message = JSON.parse(
      msg as unknown as string,
    ) as ConfirmTransactionMessage;

    const { transactionId, sourceAccountId, destinationAccountId, amount } =
      message.payload;

    this.loggingService.logHandlerStart(handlerName, {
      transactionId,
      sourceAccountId,
      destinationAccountId,
      amount,
    });

    try {
      // Load the transaction aggregate
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        this.loggingService.error(
          `[${handlerName}] CRITICAL: Transaction aggregate not found for ID: ${transactionId}. Cannot confirm.`,
          { transactionId, ...message.payload },
        );
        throw new NotFoundException(
          `Transaction aggregate with ID "${transactionId}" not found. Cannot confirm.`,
        );
      }

      // Apply the confirmTransaction domain logic/event to the aggregate
      // Pass data from the message. Assume description is not needed or fetched elsewhere if required by event.
      transactionAggregate.confirmTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        null, // Description - pass null, aggregate event needs it but handler doesn't fetch
        true, // Success
        undefined, // No error on success path
      );

      // Save the aggregate, which publishes the enriched TransactionConfirmedEvent
      await this.transactionAggregateRepository.save(transactionAggregate);

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId, sourceAccountId, destinationAccountId, amount },
        executionTime,
        { operation: 'transaction_confirmed_event_published' },
      );
    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.error(
        `[${handlerName}] Error confirming transaction (applying event): ${error.message}`,
        {
          transactionId,
          ...message.payload,
          error: error.stack,
        },
      );

      // Attempt to load aggregate again to publish failure event
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Publish failure event via aggregate
          transactionAggregate.confirmTransaction(
            transactionId,
            sourceAccountId, // Use data from original message
            destinationAccountId,
            amount,
            null, // Description
            false, // Failure
            error.message, // Pass error message
          );
          await this.transactionAggregateRepository.save(transactionAggregate);
          this.loggingService.warn(
            `[${handlerName}] Recorded transaction confirmation failure in aggregate due to error.`,
            { transactionId },
          );
        } else {
          this.loggingService.error(
            `[${handlerName}] Aggregate ${transactionId} not found for failure reporting.`,
            { error: error.stack },
          );
        }
      } catch (aggError) {
        this.loggingService.error(
          `[${handlerName}] Error saving aggregate during error handling: ${aggError.message}`,
          { transactionId, error: aggError.stack },
        );
      }

      // Consider NACKing the message
      throw error; // Rethrow the original error
    } finally {
      this.loggingService.info(
        `[${handlerName}] Finished processing message for ${transactionId}.`,
      );
    }
  }
}
