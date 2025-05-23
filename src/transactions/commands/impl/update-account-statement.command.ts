export class UpdateAccountStatementCommand {
  constructor(
    public readonly transactionId: string,
    public readonly accountId: string,
    public readonly amount: number,
    public readonly type: 'DEBIT' | 'CREDIT',
    public readonly description: string,
  ) {}
}
