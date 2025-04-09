import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { AccountBalanceUpdatedEvent } from '../../events/impl/account-balance-updated.event';
import { AccountEntity } from '../../models/account.entity';
import { UpdateAccountBalanceCommand } from '../impl/update-account-balance.command';

@CommandHandler(UpdateAccountBalanceCommand)
export class UpdateAccountBalanceHandler
  implements ICommandHandler<UpdateAccountBalanceCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private readonly rabbitMQService: RabbitMQService,
    private eventBus: EventBus,
  ) {}

  async execute(command: UpdateAccountBalanceCommand): Promise<AccountEntity> {
    const { accountId, amount } = command;

    const account = await this.accountRepository.findOne({
      where: { id: accountId },
    });
    if (!account) {
      throw new NotFoundException(`Account with ID "${accountId}" not found`);
    }

    const previousBalance = parseFloat(account.balance.toString());
    const amountNum = parseFloat(amount.toString());

    // Garantir que estamos trabalhando com números
    account.balance = previousBalance + amountNum;
    account.updatedAt = new Date();

    await this.accountRepository.save(account);

    console.log(
      `Account command model updated: ${accountId} to balance ${account.balance}`,
    );

    this.eventBus.publish(
      new AccountBalanceUpdatedEvent(
        account.id,
        previousBalance,
        account.balance,
        amountNum,
      ),
    );

    // Publish the event to RabbitMQ
    this.rabbitMQService.publish('events', 'account.balance.updated', {
      accountId: account.id,
      previousBalance: previousBalance,
      newBalance: account.balance,
    });

    return account;
  }
}
