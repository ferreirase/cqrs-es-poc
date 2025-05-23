export class BalanceReleasedEvent {
  constructor(
    public readonly transactionId: string,
    public readonly accountId: string,
    public readonly amount: number,
    public readonly success: boolean,
    public readonly reason?: string,
    public readonly error?: string,
  ) {}
}
