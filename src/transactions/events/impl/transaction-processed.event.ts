import {
  TransactionStatus,
  TransactionType,
} from '../../models/transaction.schema';

export class TransactionProcessedEvent {
  constructor(
    public readonly transactionId: string,
    public readonly sourceAccountId: string,
    public readonly destinationAccountId: string,
    public readonly amount: number,
    public readonly success: boolean,
    public readonly description: string,
    public readonly status: TransactionStatus,
    public readonly type: TransactionType,
    public readonly error?: string,
  ) {}
}
