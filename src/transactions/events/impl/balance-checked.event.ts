export class BalanceCheckedEvent {
  constructor(
    public readonly transactionId: string,
    public readonly accountId: string,
    public readonly isBalanceSufficient: boolean,
    public readonly amount: number,
  ) {}
}
