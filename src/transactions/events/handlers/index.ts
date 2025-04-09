import { TransactionCreatedHandler } from './transaction-created.handler';
import { TransactionProcessedHandler } from './transaction-processed.handler';

export const EventHandlers = [
  TransactionCreatedHandler,
  TransactionProcessedHandler,
];
