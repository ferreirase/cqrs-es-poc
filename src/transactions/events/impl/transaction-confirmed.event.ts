export class TransactionConfirmedEvent {
  constructor(
    public readonly transactionId: string,
    public readonly sourceAccountId: string,
    public readonly destinationAccountId: string | null,
    public readonly amount: number,
    public readonly description: string | null,
    public readonly success: boolean,
    public readonly error?: string,
  ) {}
}
