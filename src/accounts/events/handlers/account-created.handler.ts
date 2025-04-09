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
    @InjectModel('AccountDocument')
    private accountModel: Model<AccountDocument>,
  ) {
    console.log('AccountCreatedHandler initialized');
  }

  async handle(event: AccountCreatedEvent) {
    console.log(
      `[AccountCreatedHandler] Handling event: ${JSON.stringify(event)}`,
    );

    const { id, owner, initialBalance } = event;

    try {
      const createdAccount = await this.accountModel.create({
        id,
        owner,
        balance: initialBalance,
        createdAt: new Date(),
      });

      console.log(`Account read model created: ${id}`, createdAccount);
    } catch (error) {
      console.error(`Error creating account read model: ${error.message}`);
      throw error;
    }
  }
}
