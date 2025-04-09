export class CreateAccountCommand {
  constructor(
    public readonly ownerId: string,
    public readonly initialBalance: number = 0,
  ) {}
}
