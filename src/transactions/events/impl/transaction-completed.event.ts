export class TransactionCompletedEvent {
  constructor(
    public readonly transactionId: string,
    public readonly sourceAccountId: string,
    public readonly destinationAccountId: string,
    public readonly amount: number,
    public readonly success: boolean,
  ) {}
}
