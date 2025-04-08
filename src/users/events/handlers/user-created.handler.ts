import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument } from '../../models/user.schema';
import { UserCreatedEvent } from '../impl/user-created.event';

@EventsHandler(UserCreatedEvent)
export class UserCreatedHandler implements IEventHandler<UserCreatedEvent> {
  constructor(
    @InjectModel(UserDocument.name)
    private userModel: Model<UserDocument>,
  ) {}

  async handle(event: UserCreatedEvent) {
    const { id, name, document, email, accountId } = event;

    await this.userModel.create({
      id,
      name,
      document,
      email,
      accountId,
      createdAt: new Date(),
    });

    console.log(`User read model created: ${id}`);
  }
}
