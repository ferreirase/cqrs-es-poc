export class CheckAccountBalanceCommand {
  constructor(
    public readonly transactionId: string,
    public readonly accountId: string,
    public readonly amount: number,
  ) {}
}
