export class CreateAccountCommand {
  constructor(
    public readonly id: string,
    public readonly owner: string,
    public readonly initialBalance: number = 0,
  ) {}
}
