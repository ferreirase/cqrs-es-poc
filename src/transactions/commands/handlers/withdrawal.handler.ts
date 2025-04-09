import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { WorkerMessageProcessor } from '../../../common/workers/worker-message-processor';
import { TransactionType } from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';
import { TransactionContextService } from '../../services/transaction-context.service';
import { WithdrawalCommand } from '../impl/withdrawal.command';

@CommandHandler(WithdrawalCommand)
export class WithdrawalHandler implements ICommandHandler<WithdrawalCommand> {
  constructor(
    private readonly rabbitmqService: RabbitMQService,
    private readonly loggingService: LoggingService,
    private readonly workerProcessor: WorkerMessageProcessor,
    private readonly transactionAggregateRepository: TransactionAggregateRepository,
    private readonly transactionContextService: TransactionContextService,
  ) {}

  async execute(command: WithdrawalCommand): Promise<any> {
    const handlerName = 'WithdrawalHandler';
    const startTime = Date.now();
    const transactionId = command.id || uuidv4();

    try {
      this.loggingService.logHandlerStart(handlerName, {
        command,
        transactionId,
      });

      const processingTask = {
        operation: 'createTransaction',
        data: {
          transactionId: transactionId,
          sourceAccountId: command.sourceAccountId,
          destinationAccountId: command.destinationAccountId,
          amount: command.amount,
          type: TransactionType.WITHDRAWAL,
          description: command.description,
        },
      };

      this.loggingService.info(`[${handlerName}] Enviando tarefa para worker`, {
        transactionId,
        operation: processingTask.operation,
      });

      const processingResult = await this.workerProcessor.processMessage<any>(
        processingTask,
      );

      if (!processingResult || !processingResult.processed) {
        this.loggingService.error(
          `[${handlerName}] Worker falhou ao processar a transação`,
          { transactionId, processingResult },
        );
        throw new Error(
          `Worker failed to process transaction ${transactionId}`,
        );
      }

      this.loggingService.info(
        `[${handlerName}] Processamento de worker concluído`,
        { transactionId, resultStatus: processingResult.status },
      );

      await this.transactionContextService.setInitialContext(
        transactionId,
        command.sourceAccountId,
        command.destinationAccountId,
        command.amount,
        TransactionType.WITHDRAWAL,
        command.description,
      );

      this.loggingService.info(
        `[${handlerName}] Contexto inicial definido para ${transactionId}`,
      );

      const checkBalancePayload = {
        commandName: 'CheckAccountBalanceCommand',
        payload: {
          transactionId: transactionId,
          accountId: command.sourceAccountId,
          amount: command.amount,
        },
      };

      await this.rabbitmqService.publishToExchange(
        'commands.check_balance',
        checkBalancePayload,
        { exchangeName: 'paymaker-exchange' },
      );

      this.loggingService.info(
        `[${handlerName}] Command 'CheckAccountBalanceCommand' publicado`,
        { transactionId: transactionId },
      );

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId },
        executionTime,
        { status: 'INITIATED' },
      );

      return { transactionId: transactionId, status: 'INITIATED' };
    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandError(handlerName, error, {
        command,
        transactionId,
        executionTime,
      });
      throw error;
    }
  }
}
