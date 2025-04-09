import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { CheckAccountBalanceCommand } from '../../commands/impl/check-account-balance.command';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

@CommandHandler(CheckAccountBalanceCommand)
export class CheckAccountBalanceHandler
  implements ICommandHandler<CheckAccountBalanceCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
  ) {}

  async execute(command: CheckAccountBalanceCommand): Promise<void> {
    const { transactionId, accountId, amount } = command;

    this.loggingService.info(
      `[CheckAccountBalanceHandler] Checking balance for account ${accountId}, amount: ${amount}`,
    );

    try {
      const account = await this.accountRepository.findOne({
        where: { id: accountId },
      });

      if (!account) {
        throw new NotFoundException(`Account with ID "${accountId}" not found`);
      }

      const isBalanceSufficient = account.balance >= amount;

      this.loggingService.info(
        `[CheckAccountBalanceHandler] Account ${accountId} has ${account.balance} balance, required: ${amount}, sufficient: ${isBalanceSufficient}`,
      );

      // Carregar o agregado de transação
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        throw new NotFoundException(
          `Transaction aggregate with ID "${transactionId}" not found`,
        );
      }

      // Atualizar o status da transação no agregado (via evento)
      transactionAggregate.checkBalance(
        transactionId,
        accountId,
        isBalanceSufficient,
        amount,
      );

      // Aplicar e publicar os eventos
      await this.transactionAggregateRepository.save(transactionAggregate);
    } catch (error) {
      this.loggingService.error(
        `[CheckAccountBalanceHandler] Error checking balance: ${error.message}`,
      );

      // Tentar carregar o agregado de transação
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Atualizar o status da transação no agregado (via evento de falha)
          transactionAggregate.checkBalance(
            transactionId,
            accountId,
            false,
            amount,
          );

          // Aplicar e publicar os eventos
          await this.transactionAggregateRepository.save(transactionAggregate);
        }
      } catch (aggError) {
        this.loggingService.error(
          `[CheckAccountBalanceHandler] Error updating transaction aggregate: ${aggError.message}`,
        );
      }

      throw error;
    }
  }
}
