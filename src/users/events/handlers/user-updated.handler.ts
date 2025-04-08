import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument } from '../../models/user.schema';
import { UserUpdatedEvent } from '../impl/user-updated.event';

@EventsHandler(UserUpdatedEvent)
export class UserUpdatedHandler implements IEventHandler<UserUpdatedEvent> {
  constructor(
    @InjectModel(UserDocument.name)
    private userModel: Model<UserDocument>,
  ) {}

  async handle(event: UserUpdatedEvent) {
    const { id, name, document, email } = event;

    await this.userModel.findOneAndUpdate(
      { id },
      {
        $set: {
          name,
          document,
          email,
          updatedAt: new Date(),
        },
      },
    );

    console.log(`User read model updated: ${id}`);
  }
}
