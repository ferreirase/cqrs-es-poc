export class AccountBalanceUpdatedEvent {
  constructor(
    public readonly accountId: string,
    public readonly previousBalance: number,
    public readonly newBalance: number,
    public readonly amount: number,
  ) {}
}
