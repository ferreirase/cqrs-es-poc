import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountDocument } from '../../models/account.schema';
import { AccountCreatedEvent } from '../impl/account-created.event';

@EventsHandler(AccountCreatedEvent)
export class AccountCreatedHandler
  implements IEventHandler<AccountCreatedEvent>
{
  constructor(
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
  ) {}

  async handle(event: AccountCreatedEvent) {
    const { id, owner, initialBalance } = event;

    await this.accountModel.create({
      id,
      owner,
      balance: initialBalance,
      createdAt: new Date(),
    });

    console.log(`Account read model created: ${id}`);
  }
}
