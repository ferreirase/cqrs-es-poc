import { HttpException, Logger } from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  EventBus,
  ICommandHandler,
} from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateAccountBalanceCommand } from '../../../accounts/commands/impl/update-account-balance.command';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
import { TransactionProcessedEvent } from '../../events/impl/transaction-processed.event';
import {
  TransactionEntity,
  TransactionStatus,
} from '../../models/transaction.entity';
import { ProcessTransactionCommand } from '../impl/process-transaction.command';

@CommandHandler(ProcessTransactionCommand)
export class ProcessTransactionHandler
  implements ICommandHandler<ProcessTransactionCommand>
{
  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private commandBus: CommandBus,
    private rabbitmqService: RabbitMQService,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private prometheusService: PrometheusService,
  ) {}

  async execute(command: ProcessTransactionCommand): Promise<void> {
    const commandName = 'ProcessTransactionCommand';
    const startTime = Date.now();

    // Log início do processamento com os argumentos
    this.loggingService.logHandlerStart(commandName, {
      transactionId: command.transactionId,
    });

    try {
      const { transactionId } = command;

      const transaction = await this.transactionRepository.findOneBy({
        id: transactionId,
      });

      if (!transaction) {
        const error = new HttpException(
          `Transaction with id ${transactionId} not found`,
          404,
        );

        // Registrar métricas de falha - transação não encontrada
        this.prometheusService
          .getCounter('commands_total')
          .inc({ command: commandName, status: 'error' }, 1);

        this.prometheusService.getCounter('command_results').inc(
          {
            command: commandName,
            result: 'transaction_not_found',
            status: 'error',
          },
          1,
        );

        // Log erro
        this.loggingService.logCommandError(commandName, error, {
          transactionId,
        });

        throw error;
      }

      if (transaction.status !== TransactionStatus.PENDING) {
        const executionTime = (Date.now() - startTime) / 1000;

        // Registrar métricas - transação já processada
        this.prometheusService
          .getCounter('commands_total')
          .inc({ command: commandName, status: 'skipped' }, 1);

        this.prometheusService
          .getHistogram('command_duration_seconds')
          .observe({ command: commandName }, executionTime);

        // Log de transação já processada
        this.loggingService.info('Transaction already processed', {
          command: commandName,
          transactionId: transaction.id,
          status: transaction.status,
          duration: executionTime,
        });

        return;
      }

      // Iniciar o histograma para medir o tempo de processamento
      const processingTimer = this.prometheusService
        .getHistogram('command_duration_seconds')
        .startTimer({ command: commandName });

      let operationResult;

      switch (transaction.type) {
        case 'deposit':
          operationResult = await this.commandBus.execute(
            new UpdateAccountBalanceCommand(
              transaction.sourceAccountId,
              transaction.amount,
            ),
          );

          // Registrar operação de depósito
          this.prometheusService
            .getCounter('transaction_operations_total')
            .inc({ type: 'deposit', status: 'success' }, 1);
          break;

        case 'withdrawal':
          operationResult = await this.commandBus.execute(
            new UpdateAccountBalanceCommand(
              transaction.sourceAccountId,
              -transaction.amount,
            ),
          );

          // Registrar operação de saque
          this.prometheusService
            .getCounter('transaction_operations_total')
            .inc({ type: 'withdrawal', status: 'success' }, 1);
          break;

        case 'transfer':
          if (!transaction.destinationAccountId) {
            const error = new HttpException(
              'Destination account is required for transfers',
              400,
            );

            // Registrar erro em transferência
            this.prometheusService
              .getCounter('transaction_operations_total')
              .inc({ type: 'transfer', status: 'error' }, 1);

            this.loggingService.logCommandError(commandName, error, {
              transactionId: transaction.id,
              type: transaction.type,
            });

            throw error;
          }

          await this.commandBus.execute(
            new UpdateAccountBalanceCommand(
              transaction.sourceAccountId,
              -transaction.amount,
            ),
          );

          await this.commandBus.execute(
            new UpdateAccountBalanceCommand(
              transaction.destinationAccountId,
              transaction.amount,
            ),
          );

          // Registrar operação de transferência
          this.prometheusService
            .getCounter('transaction_operations_total')
            .inc({ type: 'transfer', status: 'success' }, 1);
          break;
      }

      transaction.status = TransactionStatus.COMPLETED;
      transaction.processedAt = new Date();

      await this.transactionRepository.save(transaction);

      // Publicar evento de transação processada
      this.eventBus.publish(
        new TransactionProcessedEvent(transaction.id, transaction.status),
      );

      // Publicar no RabbitMQ com metadados de processamento
      const executionTimeSeconds = processingTimer();
      await this.rabbitmqService.publish('events', 'transaction.processed', {
        id: transactionId,
        status: TransactionStatus.COMPLETED,
        processedAt: transaction.processedAt,
        processingMetadata: {
          startTime,
          duration: executionTimeSeconds,
          operationType: transaction.type,
        },
      });

      // Registrar métricas de sucesso
      this.prometheusService
        .getCounter('commands_total')
        .inc({ command: commandName, status: 'success' }, 1);

      this.prometheusService.getCounter('command_results').inc(
        {
          command: commandName,
          result: 'transaction_processed',
          status: 'success',
        },
        1,
      );

      // Log de sucesso com todos os detalhes
      this.loggingService.logCommandSuccess(
        commandName,
        {
          transactionId: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
          sourceAccountId: transaction.sourceAccountId,
          destinationAccountId: transaction.destinationAccountId,
        },
        executionTimeSeconds,
        {
          status: transaction.status,
          processedAt: transaction.processedAt,
        },
      );

      Logger.log(`Transaction with id ${transactionId} processed successfully`);
    } catch (error) {
      const failedTransaction = await this.transactionRepository.findOneBy({
        id: command.transactionId,
      });

      if (failedTransaction) {
        // Atualizar status da transação para falha
        failedTransaction.status = TransactionStatus.FAILED;
        failedTransaction.processedAt = new Date();
        await this.transactionRepository.save(failedTransaction);

        // Publicar no RabbitMQ o evento de falha
        await this.rabbitmqService.publish('events', 'transaction.failed', {
          id: command.transactionId,
          status: TransactionStatus.FAILED,
          processedAt: failedTransaction.processedAt,
          error: error.message,
          processingMetadata: {
            startTime,
            duration: (Date.now() - startTime) / 1000,
          },
        });
      }

      // Registrar métricas de erro
      this.prometheusService
        .getCounter('commands_total')
        .inc({ command: commandName, status: 'error' }, 1);

      this.prometheusService.getCounter('command_results').inc(
        {
          command: commandName,
          result: 'transaction_failed',
          status: 'error',
        },
        1,
      );

      // Log erro detalhado
      this.loggingService.logCommandError(commandName, error, {
        transactionId: command.transactionId,
        duration: (Date.now() - startTime) / 1000,
      });

      throw new HttpException(
        `Failed to process transaction with id ${command.transactionId}: ${error.message}`,
        500,
      );
    }
  }
}
