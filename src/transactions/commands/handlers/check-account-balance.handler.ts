import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { CheckAccountBalanceCommand } from '../../commands/impl/check-account-balance.command';
import { BalanceCheckedEvent } from '../../events/impl/balance-checked.event';

@CommandHandler(CheckAccountBalanceCommand)
export class CheckAccountBalanceHandler
  implements ICommandHandler<CheckAccountBalanceCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private rabbitMQService: RabbitMQService,
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

      // Publicar evento com o resultado da verificação do saldo
      this.eventBus.publish(
        new BalanceCheckedEvent(
          transactionId,
          accountId,
          isBalanceSufficient,
          amount,
        ),
      );

      // Publicar no RabbitMQ
      this.rabbitMQService.publish('events', 'balance.checked', {
        transactionId,
        accountId,
        amount,
        currentBalance: account.balance,
        isBalanceSufficient,
        checkedAt: new Date(),
      });
    } catch (error) {
      this.loggingService.error(
        `[CheckAccountBalanceHandler] Error checking balance: ${error.message}`,
      );
      // Em caso de erro, também publicamos um evento com false para isBalanceSufficient
      this.eventBus.publish(
        new BalanceCheckedEvent(transactionId, accountId, false, amount),
      );

      // Publicar no RabbitMQ
      this.rabbitMQService.publish('events', 'balance.checked', {
        transactionId,
        accountId,
        amount,
        isBalanceSufficient: false,
        error: error.message,
        checkedAt: new Date(),
      });

      throw error;
    }
  }
}
