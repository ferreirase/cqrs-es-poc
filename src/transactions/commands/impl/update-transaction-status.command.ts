import { TransactionStatus } from '../../models/transaction.schema';

export class UpdateTransactionStatusCommand {
  constructor(
    public readonly transactionId: string,
    public readonly status: TransactionStatus,
    public readonly processedAt?: Date,
    public readonly error?: string,
  ) {}
}
