import { Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

// Define the expected message structure from RabbitMQ
interface ReserveBalanceMessage {
  commandName: 'ReserveBalanceCommand';
  payload: {
    transactionId: string;
    accountId: string; // Source Account ID
    amount: number;
  };
}

@Injectable()
export class ReserveBalanceHandler {
  constructor(
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private eventBus: EventBus,
  ) {}

  async handleReserveBalanceCommand(msg: ReserveBalanceMessage): Promise<void> {
    const handlerName = 'ReserveBalanceHandler';
    const startTime = Date.now();

    // Adicionar verificação robusta da estrutura da mensagem recebida
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
        'Invalid message structure received by ReserveBalanceHandler',
      );
    }

    // Desestruturar diretamente do payload de 'msg'
    const { transactionId, accountId, amount } = msg.payload;

    // Verificar campos do payload
    if (!transactionId || !accountId || amount === undefined) {
      this.loggingService.error(
        `[${handlerName}] Invalid payload content received.`,
        { payload: msg.payload },
      );
      throw new Error('Invalid payload content for ReserveBalanceCommand');
    }

    this.loggingService.logHandlerStart(handlerName, {
      transactionId,
      accountId,
      amount,
    });

    try {
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        this.loggingService.error(
          `[${handlerName}] CRITICAL: Transaction aggregate not found for ID: ${transactionId}. Cannot reserve balance.`,
          { transactionId, accountId, amount },
        );
        throw new NotFoundException(
          `Transaction aggregate with ID "${transactionId}" not found. Cannot reserve balance.`,
        );
      }

      transactionAggregate.reserveBalance(
        transactionId,
        accountId,
        amount,
        true,
      );

      await this.transactionAggregateRepository.save(transactionAggregate);

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId, accountId, amount },
        executionTime,
        { operation: 'balance_reservation_event_published' },
      );
    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.error(
        `[${handlerName}] Error reserving balance (applying event): ${error.message}`,
        {
          transactionId,
          accountId,
          amount,
          error: error.stack,
          payload: msg.payload,
        },
      );

      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          transactionAggregate.reserveBalance(
            transactionId,
            accountId,
            amount,
            false,
          );
          await this.transactionAggregateRepository.save(transactionAggregate);
          this.loggingService.warn(
            `[${handlerName}] Recorded balance reservation failure in aggregate due to error.`,
            { transactionId },
          );
        } else {
          this.loggingService.error(
            `[${handlerName}] CRITICAL: Aggregate ${transactionId} not found even for error reporting. Cannot publish failure event.`,
            { error: error.stack },
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
      this.loggingService.info(
        `[${handlerName}] Finished processing message for ${transactionId}.`,
      );
    }
  }
}
