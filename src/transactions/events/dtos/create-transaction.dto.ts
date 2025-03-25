export interface CreateTransactionEventDto {
  readonly id: string;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string | null;
  readonly amount: number;
  readonly type: string;
  readonly description: string | null;
}
