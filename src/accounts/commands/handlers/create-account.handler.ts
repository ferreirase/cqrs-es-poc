import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { AccountCreatedEvent } from '../../events/impl/account-created.event';
import { AccountEntity } from '../../models/account.entity';
import { CreateAccountCommand } from '../impl/create-account.command';

@CommandHandler(CreateAccountCommand)
export class CreateAccountHandler
  implements ICommandHandler<CreateAccountCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private eventBus: EventBus,
    private rabbitMQService: RabbitMQService,
  ) {}

  async execute(command: CreateAccountCommand): Promise<AccountEntity> {
    const { id, owner, initialBalance } = command;
    const accountId = id || uuidv4();

    const account = this.accountRepository.create({
      id: accountId,
      owner,
      balance: initialBalance,
      createdAt: new Date(),
    });

    await this.accountRepository.save(account);

    this.eventBus.publish(
      new AccountCreatedEvent(account.id, owner, initialBalance),
    );

    // Publish the event to RabbitMQ
    this.rabbitMQService.publish('events', 'account.created', account);

    return account;
  }
}
