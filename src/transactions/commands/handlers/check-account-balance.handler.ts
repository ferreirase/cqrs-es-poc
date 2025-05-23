import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

// Define the expected message structure
interface CheckBalanceMessage {
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
  async handleCheckBalanceCommand(msg: string): Promise<void> {
    const handlerName = 'CheckAccountBalanceHandler';
    const startTime = Date.now();

    const { payload } = JSON.parse(msg) as CheckBalanceMessage;

    console.log('payload aqui: ', payload);

    // Extrair dados diretamente do payload recebido
    const { transactionId, accountId, amount } = payload;

    // Adicionar log para verificar o ID recebido
    this.loggingService.info(`[${handlerName}] Recebido comando`, {
      transactionId,
      accountId,
      amount,
    });

    // Verificar se o transactionId é undefined
    if (
      typeof transactionId === 'undefined' ||
      transactionId === null ||
      transactionId === 'undefined'
    ) {
      this.loggingService.error(
        `[${handlerName}] Erro Crítico: transactionId recebido como undefined/null. Abortando.`,
        { payload },
      );
      // Poderia lançar um erro aqui para Nack, mas vamos apenas logar por enquanto
      // throw new Error('Received undefined transactionId');
      return; // Interrompe o processamento
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
