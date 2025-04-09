import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
import { TransactionType } from '../../models/transaction.entity';
import { CreateTransactionCommand } from '../impl/create-transaction.command';
import { WithdrawalCommand } from '../impl/withdrawal.command';

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

    // Log detalhado do início do comando com todos os argumentos
    this.loggingService.logHandlerStart(commandName, {
      sourceAccountId: command.sourceAccountId,
      destinationAccountId: command.destinationAccountId,
      amount: command.amount,
      type: command.type,
      description: command.description,
    });

    try {
      const {
        sourceAccountId,
        destinationAccountId,
        amount,
        type,
        description,
      } = command;

      // Verifica o tipo de transação e delega para o handler adequado
      if (type === TransactionType.WITHDRAWAL) {
        this.loggingService.info(
          '[CreateTransactionHandler] Delegating to WithdrawalHandler for withdrawal transaction',
          { sourceAccountId, destinationAccountId, amount },
        );

        // Cria um novo command para withdrawal e delega para o handler específico
        const withdrawalCommand = new WithdrawalCommand(
          null, // id será gerado no handler
          sourceAccountId,
          destinationAccountId,
          amount,
          description || 'Withdrawal operation',
        );

        // Publish withdrawal command details to RabbitMQ
        const withdrawalPayload = {
          commandName: 'WithdrawalCommand', // Identify the command type
          payload: {
            transactionId: null, // ID is usually generated later or context-dependent
            sourceAccountId: withdrawalCommand.sourceAccountId,
            destinationAccountId: withdrawalCommand.destinationAccountId,
            amount: withdrawalCommand.amount,
            description: withdrawalCommand.description,
          },
          // Optional: Add metadata like correlationId if needed
        };

        await this.rabbitMQService.publishToExchange(
          'commands.withdrawal', // Routing key for withdrawal commands
          withdrawalPayload,
        );

        this.loggingService.info(
          '[CreateTransactionHandler] Published WithdrawalCommand details to queue.',
          {
            routingKey: 'commands.withdrawal',
            payload: withdrawalPayload.payload,
          },
        );

        // Registrar métricas de sucesso
        const executionTime = (Date.now() - startTime) / 1000;

        this.prometheusService
          .getCounter('commands_total')
          .inc({ command: commandName, status: 'success' }, 1);

        this.prometheusService
          .getHistogram('command_duration_seconds')
          .observe({ command: commandName }, executionTime);

        // Log detalhado do final do comando com o resultado
        this.loggingService.logCommandSuccess(
          commandName,
          {
            sourceAccountId,
            destinationAccountId,
            type,
            amount,
          },
          executionTime,
          { operation: 'withdrawal_delegated' },
        );

        return {
          status: 'PROCESSING',
          message: 'Withdrawal operation started',
        };
      } else {
        throw new Error(`Transaction type ${type} not implemented`);
      }
    } catch (error) {
      // Registrar métricas de erro
      this.prometheusService
        .getCounter('commands_total')
        .inc({ command: commandName, status: 'error' }, 1);

      this.prometheusService.getCounter('command_results').inc(
        {
          command: commandName,
          result: 'transaction_error',
          status: 'error',
        },
        1,
      );

      // Log erro detalhado
      this.loggingService.logCommandError(commandName, error, {
        sourceAccountId: command.sourceAccountId,
        destinationAccountId: command.destinationAccountId,
        amount: command.amount,
        type: command.type,
      });

      throw error;
    }
  }
}
