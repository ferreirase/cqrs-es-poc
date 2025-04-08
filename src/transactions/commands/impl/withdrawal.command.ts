export class WithdrawalCommand {
  constructor(
    public readonly id: string,
    public readonly sourceAccountId: string,
    public readonly destinationAccountId: string,
    public readonly amount: number,
    public readonly description: string,
  ) {}
}
