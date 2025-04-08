import {
  NotificationStatus,
  NotificationType,
} from '../../models/notification.enum';

export class NotifyUserCommand {
  constructor(
    public readonly userId: string,
    public readonly transactionId: string,
    public readonly accountId: string,
    public readonly amount: number,
    public readonly type: NotificationType,
    public readonly status: NotificationStatus,
  ) {}
}
