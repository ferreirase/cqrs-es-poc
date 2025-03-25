import { TransactionType } from '../../models/transaction.entity';
import { CreateTransactionEventDto } from '../dtos/create-transaction.dto';

export class TransactionCreatedEvent implements CreateTransactionEventDto {
  constructor(
    public readonly id: string,
    public readonly sourceAccountId: string,
    public readonly destinationAccountId: string | null,
    public readonly amount: number,
    public readonly type: TransactionType,
    public readonly description: string | null,
  ) {}
}
