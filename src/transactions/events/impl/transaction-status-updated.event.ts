import { TransactionStatus } from '../../models/transaction.schema';

export class TransactionStatusUpdatedEvent {
  constructor(
    public readonly id: string,
    public readonly status: TransactionStatus,
    public readonly processedAt?: Date,
    public readonly error?: string,
  ) {}
}
