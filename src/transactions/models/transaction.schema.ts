import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  TRANSFER = 'transfer',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  PROCESSED = 'processed',
  INITIATED = 'initiated',
  RESERVED = 'reserved',
  CONFIRMED = 'confirmed',
  CANCELED = 'canceled',
}

@Schema({
  collection: 'transactions',
})
export class TransactionDocument extends Document {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  sourceAccountId: string;

  @Prop()
  destinationAccountId: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, enum: TransactionType })
  type: TransactionType;

  @Prop({
    required: true,
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Prop()
  description: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop()
  processedAt: Date;
}

export const TransactionSchema =
  SchemaFactory.createForClass(TransactionDocument);
