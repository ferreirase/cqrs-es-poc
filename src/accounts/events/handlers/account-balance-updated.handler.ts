import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountDocument } from '../../models/account.schema';
import { AccountBalanceUpdatedEvent } from '../impl/account-balance-updated.event';

@EventsHandler(AccountBalanceUpdatedEvent)
export class AccountBalanceUpdatedHandler
  implements IEventHandler<AccountBalanceUpdatedEvent>
{
  constructor(
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
  ) {}

  async handle(event: AccountBalanceUpdatedEvent) {
    const { accountId, newBalance } = event;

    await this.accountModel.findOneAndUpdate(
      { id: accountId },
      {
        $set: {
          balance: newBalance,
          updatedAt: new Date(),
        },
      },
    );

    console.log(`Account read model updated: ${accountId}`);
  }
}
