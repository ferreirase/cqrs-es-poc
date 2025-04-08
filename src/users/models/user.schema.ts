import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import { Document } from 'mongoose';
import { AccountDocument } from '../../accounts/models/account.schema';

@Schema({
  collection: 'users',
})
export class UserDocument extends Document {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  document: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop()
  updatedAt: Date;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'AccountDocument' })
  account: AccountDocument;

  @Prop()
  accountId: string;
}

export const UserSchema = SchemaFactory.createForClass(UserDocument);
