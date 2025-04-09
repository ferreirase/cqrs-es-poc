import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
import { TransactionType } from '../../models/transaction.entity';
import { CreateTransactionCommand } from '../impl/create-transaction.command';

@CommandHandler(CreateTransactionCommand)
export class CreateTransactionHandler
  implements ICommandHandler<CreateTransactionCommand>
{
  constructor(
    private rabbitMQService: RabbitMQService,
    private loggingService: LoggingService,
    private prometheusService: PrometheusService,
  ) {}

  async execute(command: CreateTransactionCommand): Promise<any> {
    const commandName = 'CreateTransactionCommand';
    const startTime = Date.now();

    this.loggingService.logHandlerStart(commandName, { ...command });

    try {
      const {
        sourceAccountId,
        destinationAccountId,
        amount,
        type,
        description,
      } = command;

      if (type === TransactionType.WITHDRAWAL) {
        this.loggingService.info(
          '[CreateTransactionHandler] Delegating to Withdrawal flow via RabbitMQ',
          { sourceAccountId, destinationAccountId, amount },
        );

        const transactionId = uuidv4();

        const withdrawalPayload = {
          commandName: 'WithdrawalCommand',
          payload: {
            id: transactionId,
            sourceAccountId: sourceAccountId,
            destinationAccountId: destinationAccountId,
            amount: amount,
            description: description || 'Withdrawal operation',
          },
        };

        await this.rabbitMQService.publishToExchange(
          'commands.withdrawal',
          withdrawalPayload,
          { exchangeName: 'paymaker-exchange' },
        );

        this.loggingService.info(
          '[CreateTransactionHandler] Published WithdrawalCommand details to queue.',
          {
            routingKey: 'commands.withdrawal',
            payload: withdrawalPayload.payload,
          },
        );

        const executionTime = (Date.now() - startTime) / 1000;
        this.prometheusService
          .getCounter('commands_total')
          .inc({ command: commandName, status: 'success' }, 1);
        this.prometheusService
          .getHistogram('command_duration_seconds')
          .observe({ command: commandName }, executionTime);
        this.loggingService.logCommandSuccess(
          commandName,
          { ...command },
          executionTime,
          { operation: 'withdrawal_delegated', transactionId: transactionId },
        );

        return {
          status: 'ACCEPTED',
          message: 'Withdrawal operation accepted for processing',
          transactionId: transactionId,
        };
      } else {
        const errMsg = `Transaction type ${type} not implemented in CreateTransactionHandler`;
        this.loggingService.error(`[${commandName}] ${errMsg}`, { command });
        throw new Error(errMsg);
      }
    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getCounter('commands_total')
        .inc({ command: commandName, status: 'error' }, 1);
      this.prometheusService
        .getHistogram('command_duration_seconds')
        .observe({ command: commandName }, executionTime);
      this.loggingService.logCommandError(commandName, error, { ...command });
      throw error;
    }
  }
}
