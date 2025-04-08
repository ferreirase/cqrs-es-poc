export class UserUpdatedEvent {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly document: string,
    public readonly email: string,
  ) {}
}
