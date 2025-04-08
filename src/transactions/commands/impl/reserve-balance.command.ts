export class ReserveBalanceCommand {
  constructor(
    public readonly transactionId: string,
    public readonly accountId: string,
    public readonly amount: number,
  ) {}
}
