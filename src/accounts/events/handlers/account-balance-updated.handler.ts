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
    @InjectModel('AccountDocument')
    private accountModel: Model<AccountDocument>,
  ) {
    console.log('AccountBalanceUpdatedHandler initialized');
  }

  async handle(event: AccountBalanceUpdatedEvent) {
    console.log(
      `[AccountBalanceUpdatedHandler] Handling event: ${JSON.stringify(event)}`,
    );

    const { accountId, newBalance } = event;

    try {
      const result = await this.accountModel.findOneAndUpdate(
        { id: accountId },
        {
          $set: {
            balance: newBalance,
            updatedAt: new Date(),
          },
        },
        { new: true },
      );

      if (!result) {
        console.error(`Account not found for update: ${accountId}`);
      } else {
        console.log(
          `Account read model updated: ${accountId} to balance ${newBalance}`,
          result,
        );
      }
    } catch (error) {
      console.error(`Error updating account read model: ${error.message}`);
      throw error;
    }
  }
}
