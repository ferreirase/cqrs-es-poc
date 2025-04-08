import { CheckAccountBalanceHandler } from './check-account-balance.handler';
import { ConfirmTransactionHandler } from './confirm-transaction.handler';
import { NotifyUserHandler } from './notify-user.handler';
import { ProcessTransactionHandler } from './process-transaction.handler';
import { ReleaseBalanceHandler } from './release-balance.handler';
import { ReserveBalanceHandler } from './reserve-balance.handler';
import { UpdateAccountStatementHandler } from './update-account-statement.handler';
import { WithdrawalHandler } from './withdrawal.handler';

export const SagaCommandHandlers = [
  WithdrawalHandler,
  CheckAccountBalanceHandler,
  ReserveBalanceHandler,
  ProcessTransactionHandler,
  ConfirmTransactionHandler,
  UpdateAccountStatementHandler,
  NotifyUserHandler,
  ReleaseBalanceHandler,
];
