import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  collection: 'accounts',
})
export class AccountDocument extends Document {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  owner: string;

  @Prop({ required: true, default: 0 })
  balance: number;

  @Prop({ required: true })
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const AccountSchema = SchemaFactory.createForClass(AccountDocument);
