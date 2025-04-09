import {
  NotificationStatus,
  NotificationType,
} from '../../models/notification.enum';

export class UserNotifiedEvent {
  constructor(
    public readonly transactionId: string,
    public readonly userId: string, // User who was notified
    public readonly accountId: string, // Account related to notification
    public readonly notificationType: NotificationType,
    public readonly status: NotificationStatus, // Status of the original operation
    public readonly success: boolean, // Did notification sending succeed?
    public readonly error?: string, // Error if notification failed
    // Additional context for the Saga:
    public readonly sourceAccountId?: string,
    public readonly destinationAccountId?: string | null,
    public readonly destinationUserId?: string | null,
    public readonly amount?: number, // Original transaction amount
    public readonly originalMessage?: string, // Original message content
  ) {}
}
