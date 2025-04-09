import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionAggregate } from '../../aggregates/transaction.aggregate';
import { TransactionType } from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';
import { TransactionContextService } from '../../services/transaction-context.service';

// Interface para a estrutura da mensagem que esperamos da fila (baseado no Controller)
interface WithdrawalQueueMessage {
  commandName: 'WithdrawalCommand';
  payload: {
    id: string;
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    description: string;
  };
}

@Injectable()
export class WithdrawalHandler {
  constructor(
    private readonly rabbitmqService: RabbitMQService,
    private readonly loggingService: LoggingService,
    private readonly transactionContextService: TransactionContextService,
    private readonly transactionAggregateRepository: TransactionAggregateRepository,
  ) {}

  @RabbitSubscribe({
    exchange: 'paymaker-exchange',
    routingKey: 'commands.withdrawal',
    queue: 'withdrawal_commands_queue',
    queueOptions: {
      durable: true,
    },
  })
  async consumeWithdrawalCommand(msg: string): Promise<void> {
    const handlerName = 'WithdrawalHandler';
    const startTime = Date.now();

    const { payload } = JSON.parse(msg) as WithdrawalQueueMessage;

    console.log('payload aqui: ', payload);

    const { id, sourceAccountId, destinationAccountId, amount, description } =
      payload;

    const transactionId = id;

    try {
      this.loggingService.logHandlerStart(handlerName, {
        transactionId,
        payload,
      });

      this.loggingService.info(
        `[${handlerName}] Criando agregado para transação`,
        { transactionId },
      );

      const transactionAggregate = new TransactionAggregate();

      transactionAggregate.createTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      await this.transactionAggregateRepository.save(transactionAggregate);

      this.loggingService.info(
        `[${handlerName}] Agregado ${transactionId} criado e evento inicial salvo/publicado.`,
      );

      await this.transactionContextService.setInitialContext(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );
      this.loggingService.info(
        `[${handlerName}] Contexto inicial definido para ${transactionId}`,
      );

      const checkBalancePayload = {
        commandName: 'CheckAccountBalanceCommand',
        payload: {
          transactionId: transactionId,
          accountId: sourceAccountId,
          amount: amount,
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
        { status: 'AGGREGATE_CREATED_PUBLISHED_NEXT' },
      );
    } catch (error) {
      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandError(handlerName, error, {
        messagePayload: payload,
        transactionId,
        executionTime,
      });
    }
  }
}
