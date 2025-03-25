import { TransactionStatus } from '../../models/transaction.entity';

export class TransactionProcessedEvent {
  constructor(
    public readonly id: string,
    public readonly status: TransactionStatus,
    public readonly error?: string,
  ) {}
}