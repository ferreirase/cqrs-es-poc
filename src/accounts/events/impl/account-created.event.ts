export class AccountCreatedEvent {
  constructor(
    public readonly id: string,
    public readonly owner: string,
    public readonly initialBalance: number,
  ) {}
}
