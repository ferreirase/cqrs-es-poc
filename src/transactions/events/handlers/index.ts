import { TransactionCompletedHandler } from './transaction-completed.handler';
import { TransactionCreatedHandler } from './transaction-created.handler';
import { TransactionProcessedHandler } from './transaction-processed.handler';
import { TransactionStatusUpdatedHandler } from './transaction-status-updated.handler';
import { UserNotifiedHandler } from './user-notified.handler';

export const EventHandlers = [
  TransactionCreatedHandler,
  TransactionProcessedHandler,
  TransactionStatusUpdatedHandler,
  TransactionCompletedHandler,
  UserNotifiedHandler,
];
