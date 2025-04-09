import { TransactionType } from '../../models/transaction.entity';

export class CreateTransactionCommand {
  constructor(
    public readonly id: string,
    public readonly sourceAccountId: string,
    public readonly destinationAccountId: string | null,
    public readonly amount: number,
    public readonly type: TransactionType,
    public readonly description?: string,
  ) {}
}
