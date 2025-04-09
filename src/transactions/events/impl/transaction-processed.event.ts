export class TransactionProcessedEvent {
  constructor(
    public readonly transactionId: string,
    public readonly sourceAccountId: string,
    public readonly destinationAccountId: string,
    public readonly amount: number,
    public readonly success: boolean,
    public readonly description: string,
    public readonly status: string,
    public readonly error?: string,
  ) {}
}
