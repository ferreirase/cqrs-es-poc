import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

// Restaurar a interface original da mensagem completa
interface CheckBalanceQueueMessage {
  commandName: 'CheckAccountBalanceCommand';
  payload: {
    transactionId: string;
    accountId: string;
    amount: number;
  };
}

@Injectable()
/* implements ICommandHandler<CheckAccountBalanceCommand> */
export class CheckAccountBalanceHandler {
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
  ) {}

  @RabbitSubscribe({
    exchange: 'paymaker-exchange',
    routingKey: 'commands.check_balance',
    queue: 'check_balance_commands_queue',
    queueOptions: { durable: true },
  })
  // Voltar a esperar a mensagem completa
  async handleCheckBalanceCommand(
    queueMessage: CheckBalanceQueueMessage,
  ): Promise<void> {
    const handlerName = 'CheckAccountBalanceHandler';
    const startTime = Date.now();

    // Desestruturar o payload de dentro da mensagem recebida
    // Adicionar verificação robusta (similar ao WithdrawalHandler)
    if (
      !queueMessage ||
      typeof queueMessage !== 'object' ||
      !queueMessage.payload ||
      typeof queueMessage.payload !== 'object'
    ) {
      this.loggingService.error(
        `[${handlerName}] Received invalid message structure. Missing or invalid payload.`,
        { queueMessage },
      );
      throw new Error(
        'Invalid message structure received by CheckAccountBalanceHandler',
      );
    }
    const { payload } = queueMessage;

    // Desestruturar do payload
    const { transactionId, accountId, amount } = payload;

    // Verificar se os campos existem no payload
    if (!transactionId || !accountId || amount === undefined) {
      this.loggingService.error(
        `[${handlerName}] Invalid payload content received.`,
        { payload }, // Logar o payload interno
      );
      throw new Error('Invalid payload content for CheckAccountBalanceCommand');
    }

    this.loggingService.logHandlerStart(handlerName, {
      transactionId,
      accountId,
      amount,
    });

    try {
      const account = await this.accountRepository.findOne({
        where: { id: accountId },
      });

      if (!account) {
        this.loggingService.error(`[${handlerName}] Conta não encontrada`, {
          accountId,
          transactionId,
        });
        throw new NotFoundException(`Account with ID "${accountId}" not found`);
      }

      const isBalanceSufficient = account.balance >= amount;

      this.loggingService.info(
        `[${handlerName}] Account ${accountId} balance: ${account.balance}, required: ${amount}, sufficient: ${isBalanceSufficient}`,
        { transactionId },
      );

      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        this.loggingService.error(`[${handlerName}] Agregado não encontrado`, {
          accountId,
          transactionId,
        });
        throw new NotFoundException(
          `Transaction aggregate with ID "${transactionId}" not found`,
        );
      }

      transactionAggregate.checkBalance(
        transactionId,
        accountId,
        isBalanceSufficient,
        amount,
      );
      await this.transactionAggregateRepository.save(transactionAggregate);

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId, accountId, isBalanceSufficient },
        executionTime,
        { operation: 'balance_checked_and_event_published' },
      );
    } catch (error) {
      // ... (bloco catch existente, talvez adicionar transactionId ao log de erro inicial) ...
      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.error(
        `[${handlerName}] Error checking balance: ${error.message}`,
        { transactionId, accountId, amount, error: error.stack }, // Adicionado transactionId
      );

      // Attempt to load the transaction aggregate to record the failure
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // ... (lógica de falha) ...
        } else {
          // Log aprimorado
          this.loggingService.error(
            `[${handlerName}] Could not find aggregate ${transactionId} to record balance check failure (during error handling).`,
            { error: error.stack },
          );
        }
      } catch (aggError) {
        this.loggingService.error(
          `[${handlerName}] Error updating transaction aggregate after balance check failure: ${aggError.message}`,
          { transactionId, error: aggError.stack },
        );
      }

      throw error; // Relança o erro original para Nack
    }
  }
}
