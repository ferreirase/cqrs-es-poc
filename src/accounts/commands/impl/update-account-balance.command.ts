export class UpdateAccountBalanceCommand {
  constructor(
    public readonly accountId: string,
    public readonly amount: number,
  ) {}
} 