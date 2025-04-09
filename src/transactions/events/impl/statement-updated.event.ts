export class StatementUpdatedEvent {
  constructor(
    public readonly transactionId: string,
    public readonly accountId: string,
    public readonly amount: number,
    public readonly type: 'DEBIT' | 'CREDIT',
    public readonly success: boolean,
    public readonly error?: string,
    public readonly sourceAccountId?: string,
    public readonly destinationAccountId?: string | null,
    public readonly sourceUserId?: string,
    public readonly destinationUserId?: string | null,
    public readonly transactionAmount?: number,
    public readonly description?: string | null,
    public readonly isSource?: boolean,
  ) {}
}
