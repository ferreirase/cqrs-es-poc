import { Injectable } from '@nestjs/common';
import { CommandBus, EventBus, ofType, Saga } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { catchError, mergeMap, Observable, of, tap } from 'rxjs';
import { Repository } from 'typeorm';
import { RabbitMQService } from '../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../common/monitoring/logging.service';
import { UpdateTransactionStatusCommand } from '../commands/impl/update-transaction-status.command';
import { BalanceCheckedEvent } from '../events/impl/balance-checked.event';
import { BalanceReleasedEvent } from '../events/impl/balance-released.event';
import { BalanceReservedEvent } from '../events/impl/balance-reserved.event';
import { StatementUpdatedEvent } from '../events/impl/statement-updated.event';
import { TransactionCompletedEvent } from '../events/impl/transaction-completed.event';
import { TransactionConfirmedEvent } from '../events/impl/transaction-confirmed.event';
import { TransactionProcessedEvent } from '../events/impl/transaction-processed.event';
import { UserNotifiedEvent } from '../events/impl/user-notified.event';
import {
  NotificationStatus,
  NotificationType,
} from '../models/notification.enum';
import { TransactionEntity } from '../models/transaction.entity';
import {
  TransactionDocument,
  TransactionStatus,
} from '../models/transaction.schema';

@Injectable()
export class WithdrawalSaga {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly commandBus: CommandBus,
    private readonly eventBus: EventBus,
    private readonly rabbitMQService: RabbitMQService,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectModel(TransactionDocument.name)
    private readonly transactionModel: Model<TransactionDocument>,
  ) {}

  private async updateTransactionStatus(
    transactionId: string,
    status: TransactionStatus,
    error?: string,
  ): Promise<void> {
    try {
      this.loggingService.info(
        `[WithdrawalSaga] Updating transaction status for ${transactionId}`,
        { status, error },
      );

      const processedAt =
        status === TransactionStatus.PROCESSED ||
        status === TransactionStatus.CONFIRMED ||
        status === TransactionStatus.COMPLETED ||
        status === TransactionStatus.FAILED
          ? new Date()
          : undefined;

      const statusCommand = new UpdateTransactionStatusCommand(
        transactionId,
        status,
        processedAt,
        error,
      );
      await this.commandBus.execute(statusCommand);

      const updateData = {
        status,
        ...(processedAt && { processedAt }),
        updatedAt: new Date(),
        ...(error && { error }),
      };

      const commandResult = await this.transactionRepository.update(
        { id: transactionId },
        updateData,
      );
      if (!commandResult.affected) {
        this.loggingService.warn(
          `[WithdrawalSaga] Command-side transaction ${transactionId} status update returned 0 affected rows (might be expected).`,
        );
      }

      const queryResult = await this.transactionModel.findOneAndUpdate(
        { id: transactionId },
        { $set: updateData },
        { new: true },
      );
      if (!queryResult) {
        this.loggingService.warn(
          `[WithdrawalSaga] Query-side transaction ${transactionId} status update returned null (might be expected).`,
        );
      }

      this.loggingService.info(
        `[WithdrawalSaga] Status update initiated/verified for transaction ${transactionId}`,
        { status },
      );
    } catch (err) {
      this.loggingService.error(
        `[WithdrawalSaga] Error during transaction status update for ${transactionId}`,
        { error: err.message, stack: err.stack },
      );
    }
  }

  @Saga()
  balanceChecked = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(BalanceCheckedEvent),
      mergeMap(async (event: BalanceCheckedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] Handling BalanceCheckedEvent for ${event.transactionId}`,
          { sufficient: event.isBalanceSufficient },
        );

        if (!event.isBalanceSufficient) {
          const reason = 'Insufficient balance';
          this.loggingService.error(
            `[WithdrawalSaga] ${reason} for transaction ${event.transactionId}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            reason,
          );
          return;
        }

        const reserveBalancePayload = {
          commandName: 'ReserveBalanceCommand',
          payload: {
            transactionId: event.transactionId,
            accountId: event.accountId,
            amount: event.amount,
          },
        };
        await this.rabbitMQService.publishToExchange(
          'commands.reserve_balance',
          reserveBalancePayload,
        );
        this.loggingService.info(
          `[WithdrawalSaga] Published ReserveBalanceCommand for ${event.transactionId}`,
        );
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in balanceChecked saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };

  @Saga()
  balanceReserved = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(BalanceReservedEvent),
      mergeMap(async (event: BalanceReservedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] Handling BalanceReservedEvent for ${event.transactionId}`,
          { success: event.success },
        );

        if (!event.success) {
          const reason = 'Failed to reserve balance';
          this.loggingService.error(
            `[WithdrawalSaga] ${reason} for transaction ${event.transactionId}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            reason,
          );
          return;
        }

        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.RESERVED,
        );

        const processPayload = {
          commandName: 'ProcessTransactionCommand',
          payload: {
            transactionId: event.transactionId,
          },
        };

        await this.rabbitMQService.publishToExchange(
          'commands.process_transaction',
          processPayload,
        );
        this.loggingService.info(
          `[WithdrawalSaga] Published ProcessTransactionCommand for ${event.transactionId}`,
        );
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in balanceReserved saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };

  @Saga()
  transactionProcessed = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(TransactionProcessedEvent),
      mergeMap(async (event: TransactionProcessedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] Handling TransactionProcessedEvent for ${event.transactionId}`,
          { success: event.success },
        );

        if (!event.success) {
          const reason = event.error || 'Transaction processing failed';
          this.loggingService.error(
            `[WithdrawalSaga] ${reason} for ${event.transactionId}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            reason,
          );

          if (!event.sourceAccountId || !event.amount) {
            this.loggingService.error(
              `[WithdrawalSaga] Cannot compensate failed processing for ${event.transactionId}: Missing sourceAccountId or amount in event. Manual intervention likely required.`,
            );
            return;
          }

          const releasePayload = {
            commandName: 'ReleaseBalanceCommand',
            payload: {
              transactionId: event.transactionId,
              accountId: event.sourceAccountId,
              amount: event.amount,
              reason: `Compensation due to processing failure: ${reason}`,
            },
          };
          await this.rabbitMQService.publishToExchange(
            'commands.release_balance',
            releasePayload,
          );
          this.loggingService.info(
            `[WithdrawalSaga] Published compensation (ReleaseBalanceCommand) for failed processing of ${event.transactionId}`,
          );
          return;
        }

        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.PROCESSED,
        );

        const confirmPayload = {
          commandName: 'ConfirmTransactionCommand',
          payload: {
            transactionId: event.transactionId,
            sourceAccountId: event.sourceAccountId,
            destinationAccountId: event.destinationAccountId,
            amount: event.amount,
          },
        };
        await this.rabbitMQService.publishToExchange(
          'commands.confirm_transaction',
          confirmPayload,
        );
        this.loggingService.info(
          `[WithdrawalSaga] Published ConfirmTransactionCommand for ${event.transactionId}`,
        );
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in transactionProcessed saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };

  @Saga()
  transactionConfirmed = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(TransactionConfirmedEvent),
      mergeMap(async (event: TransactionConfirmedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] Handling TransactionConfirmedEvent for ${event.transactionId}`,
          { success: event.success },
        );

        if (!event.success) {
          const reason = event.error || 'Transaction confirmation failed';
          this.loggingService.error(
            `[WithdrawalSaga] ${reason} for ${event.transactionId}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            reason,
          );

          if (!event.sourceAccountId || !event.amount) {
            this.loggingService.error(
              `[WithdrawalSaga] Cannot compensate failed confirmation for ${event.transactionId}: Missing sourceAccountId or amount in event. Manual intervention likely required.`,
            );
            return;
          }

          const releasePayload = {
            commandName: 'ReleaseBalanceCommand',
            payload: {
              transactionId: event.transactionId,
              accountId: event.sourceAccountId,
              amount: event.amount,
              reason: `Compensation due to confirmation failure: ${reason}`,
            },
          };
          await this.rabbitMQService.publishToExchange(
            'commands.release_balance',
            releasePayload,
          );
          this.loggingService.info(
            `[WithdrawalSaga] Published compensation (ReleaseBalanceCommand) for failed confirmation of ${event.transactionId}`,
          );
          return;
        }

        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.CONFIRMED,
        );

        if (!event.sourceAccountId || !event.amount) {
          this.loggingService.error(
            `[WithdrawalSaga] Cannot proceed to update statement for ${event.transactionId}: Missing sourceAccountId or amount in TransactionConfirmedEvent. Marking as FAILED.`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Missing event details for statement update',
          );
          return;
        }

        const updateSourceStmtPayload = {
          commandName: 'UpdateAccountStatementCommand',
          payload: {
            transactionId: event.transactionId,
            accountId: event.sourceAccountId,
            amount: -event.amount,
            description: event.description || 'Withdrawal Debit',
            transactionTimestamp: new Date(),
            isSource: true,
            destinationAccountId: event.destinationAccountId,
          },
        };
        await this.rabbitMQService.publishToExchange(
          'commands.update_statement',
          updateSourceStmtPayload,
        );
        this.loggingService.info(
          `[WithdrawalSaga] Published UpdateAccountStatementCommand (Source) for ${event.transactionId}`,
        );
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in transactionConfirmed saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };

  @Saga()
  sourceStatementUpdated = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(StatementUpdatedEvent),
      mergeMap(async (event: StatementUpdatedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] TEMP LOG: sourceStatementUpdated received event payload: ${JSON.stringify(
            event,
          )}`,
        );

        this.loggingService.info(
          `[WithdrawalSaga] Handling StatementUpdatedEvent (Source) for ${event.transactionId}`,
          { success: event.success, accountId: event.accountId },
        );

        if (!event.success) {
          const reason = event.error || 'Source statement update failed';
          this.loggingService.error(
            `[WithdrawalSaga] ${reason} for ${event.transactionId}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            reason,
          );

          if (!event.accountId || !event.amount) {
            this.loggingService.error(
              `[WithdrawalSaga] Cannot compensate failed source statement update for ${event.transactionId}: Missing accountId or amount in event. Manual intervention likely required.`,
            );
            return;
          }

          const releasePayload = {
            commandName: 'ReleaseBalanceCommand',
            payload: {
              transactionId: event.transactionId,
              accountId: event.accountId,
              amount: Math.abs(event.amount),
              reason: `Compensation due to source statement failure: ${reason}`,
            },
          };
          await this.rabbitMQService.publishToExchange(
            'commands.release_balance',
            releasePayload,
          );
          this.loggingService.info(
            `[WithdrawalSaga] Published compensation (ReleaseBalance) for failed source statement update of ${event.transactionId}`,
          );
          return;
        }

        if (event.destinationAccountId) {
          if (!event.amount) {
            this.loggingService.error(
              `[WithdrawalSaga] Missing amount in StatementUpdatedEvent needed for destination update for ${event.transactionId}. Cannot proceed.`,
            );
            await this.updateTransactionStatus(
              event.transactionId,
              TransactionStatus.FAILED,
              'Missing amount for destination statement',
            );
            return;
          }
          const updateDestStmtPayload = {
            commandName: 'UpdateAccountStatementCommand',
            payload: {
              transactionId: event.transactionId,
              accountId: event.destinationAccountId,
              amount: Math.abs(event.amount),
              description: event.description || 'Withdrawal Credit',
              transactionTimestamp: new Date(),
              isSource: false,
              sourceAccountId: event.accountId,
            },
          };
          await this.rabbitMQService.publishToExchange(
            'commands.update_statement',
            updateDestStmtPayload,
          );
          this.loggingService.info(
            `[WithdrawalSaga] Published UpdateAccountStatementCommand (Destination) for ${event.transactionId}`,
          );
        } else {
          this.loggingService.info(
            `[WithdrawalSaga] No destination account for ${event.transactionId}, proceeding to notify source user.`,
          );

          if (!event.sourceUserId || !event.amount) {
            this.loggingService.error(
              `[WithdrawalSaga] Missing sourceUserId or amount in StatementUpdatedEvent for final notification of ${event.transactionId}. Completing without notification.`,
            );
            await this.updateTransactionStatus(
              event.transactionId,
              TransactionStatus.COMPLETED,
              'Completed with missing details for notification',
            );
            this.eventBus.publish(
              new TransactionCompletedEvent(
                event.transactionId,
                event.accountId,
                null,
                Math.abs(event.amount),
                true,
              ),
            );
            return;
          }

          const notifySourcePayload = {
            commandName: 'NotifyUserCommand',
            payload: {
              transactionId: event.transactionId,
              userId: event.sourceUserId,
              accountId: event.accountId,
              notificationType: NotificationType.WITHDRAWAL,
              status: NotificationStatus.SUCCESS,
              message: `Withdrawal of ${Math.abs(event.amount)} successful.`,
              details: {
                transactionId: event.transactionId,
                amount: Math.abs(event.amount),
              },
            },
          };
          await this.rabbitMQService.publishToExchange(
            'commands.notify_user',
            notifySourcePayload,
          );
          this.loggingService.info(
            `[WithdrawalSaga] Published NotifyUserCommand (Source) for ${event.transactionId} (no destination)`,
          );
        }
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in sourceStatementUpdated saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };

  @Saga()
  destinationStatementUpdated = (
    events$: Observable<any>,
  ): Observable<void> => {
    return events$.pipe(
      ofType(StatementUpdatedEvent),
      mergeMap(async (event: StatementUpdatedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] TEMP LOG: destinationStatementUpdated received event payload: ${JSON.stringify(
            event,
          )}`,
        );

        this.loggingService.info(
          `[WithdrawalSaga] Handling StatementUpdatedEvent (Destination) for ${event.transactionId}`,
          { success: event.success, accountId: event.accountId },
        );

        if (!event.success) {
          const reason = event.error || 'Destination statement update failed';
          this.loggingService.error(
            `[WithdrawalSaga] ${reason} for ${event.transactionId}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            reason,
          );

          if (!event.sourceAccountId || !event.amount) {
            this.loggingService.error(
              `[WithdrawalSaga] Cannot compensate failed destination statement update for ${event.transactionId}: Missing sourceAccountId or amount in event. Manual intervention likely required.`,
            );
            return;
          }

          const releasePayload = {
            commandName: 'ReleaseBalanceCommand',
            payload: {
              transactionId: event.transactionId,
              accountId: event.sourceAccountId,
              amount: Math.abs(event.amount),
              reason: `Compensation due to destination statement failure: ${reason}`,
            },
          };
          await this.rabbitMQService.publishToExchange(
            'commands.release_balance',
            releasePayload,
          );
          this.loggingService.info(
            `[WithdrawalSaga] Published compensation (ReleaseBalance) for failed destination statement update of ${event.transactionId}`,
          );
          return;
        }

        if (!event.sourceUserId || !event.sourceAccountId || !event.amount) {
          this.loggingService.error(
            `[WithdrawalSaga] Missing context details in StatementUpdatedEvent for notifying source user for ${event.transactionId}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.COMPLETED,
            'Completed with missing details for source notification',
          );
          this.eventBus.publish(
            new TransactionCompletedEvent(
              event.transactionId,
              event.sourceAccountId,
              event.accountId,
              Math.abs(event.amount),
              true,
            ),
          );
          return;
        }

        const notifySourcePayload = {
          commandName: 'NotifyUserCommand',
          payload: {
            transactionId: event.transactionId,
            userId: event.sourceUserId,
            accountId: event.sourceAccountId,
            notificationType: NotificationType.WITHDRAWAL,
            status: NotificationStatus.SUCCESS,
            message: `Withdrawal of ${Math.abs(event.amount)} from account ${
              event.sourceAccountId
            } completed.`,
            details: {
              transactionId: event.transactionId,
              amount: Math.abs(event.amount),
            },
          },
        };
        await this.rabbitMQService.publishToExchange(
          'commands.notify_user',
          notifySourcePayload,
        );
        this.loggingService.info(
          `[WithdrawalSaga] Published NotifyUserCommand (Source) for ${event.transactionId}`,
        );
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in destinationStatementUpdated saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };

  @Saga()
  sourceUserNotified = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(UserNotifiedEvent),
      mergeMap(async (event: UserNotifiedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] TEMP LOG: sourceUserNotified received event payload: ${JSON.stringify(
            event,
          )}`,
        );

        this.loggingService.info(
          `[WithdrawalSaga] Handling UserNotifiedEvent (Source) for ${event.transactionId}`,
          { success: event.success, userId: event.userId },
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to notify source user for transaction ${event.transactionId}`,
          );
        }

        if (event.destinationUserId) {
          if (!event.destinationAccountId || !event.amount) {
            this.loggingService.error(
              `[WithdrawalSaga] Missing destination account ID or amount in UserNotifiedEvent for final notification of ${event.transactionId}. Completing without dest notification.`,
            );
            await this.updateTransactionStatus(
              event.transactionId,
              TransactionStatus.COMPLETED,
              'Completed with missing details for dest notification',
            );
            this.eventBus.publish(
              new TransactionCompletedEvent(
                event.transactionId,
                event.sourceAccountId,
                null,
                Math.abs(event.amount),
                true,
              ),
            );
            return;
          }

          const notifyDestPayload = {
            commandName: 'NotifyUserCommand',
            payload: {
              transactionId: event.transactionId,
              userId: event.destinationUserId,
              accountId: event.destinationAccountId,
              notificationType: NotificationType.DEPOSIT,
              status: NotificationStatus.SUCCESS,
              message: `Account ${event.destinationAccountId} credited (related to withdrawal ${event.transactionId}).`,
              details: {
                transactionId: event.transactionId,
                amount: Math.abs(event.amount),
              },
            },
          };
          await this.rabbitMQService.publishToExchange(
            'commands.notify_user',
            notifyDestPayload,
          );
          this.loggingService.info(
            `[WithdrawalSaga] Published NotifyUserCommand (Destination) for ${event.transactionId}`,
          );
        } else {
          this.loggingService.info(
            `[WithdrawalSaga] No destination user for ${event.transactionId}, marking transaction as complete after source notification.`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.COMPLETED,
          );
          if (!event.sourceAccountId || !event.amount) {
            this.loggingService.warn(
              `[WithdrawalSaga] Missing details in UserNotifiedEvent for publishing final TransactionCompletedEvent for ${event.transactionId}`,
            );
            this.eventBus.publish(
              new TransactionCompletedEvent(
                event.transactionId,
                null,
                null,
                null,
                true,
              ),
            );
          } else {
            this.eventBus.publish(
              new TransactionCompletedEvent(
                event.transactionId,
                event.sourceAccountId,
                null,
                Math.abs(event.amount),
                true,
              ),
            );
          }
        }
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in sourceUserNotified saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };

  @Saga()
  destinationUserNotified = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(UserNotifiedEvent),
      mergeMap(async (event: UserNotifiedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] TEMP LOG: destinationUserNotified received event payload: ${JSON.stringify(
            event,
          )}`,
        );

        this.loggingService.info(
          `[WithdrawalSaga] Handling UserNotifiedEvent (Destination) for ${event.transactionId}`,
          { success: event.success, userId: event.userId },
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to notify destination user for transaction ${event.transactionId}`,
          );
        }

        this.loggingService.info(
          `[WithdrawalSaga] Transaction ${event.transactionId} reached final notification stage. Marking as complete.`,
        );
        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.COMPLETED,
        );
        if (
          !event.sourceAccountId ||
          !event.destinationAccountId ||
          !event.amount
        ) {
          this.loggingService.warn(
            `[WithdrawalSaga] Missing details in UserNotifiedEvent for publishing final TransactionCompletedEvent for ${event.transactionId}`,
          );
          this.eventBus.publish(
            new TransactionCompletedEvent(
              event.transactionId,
              null,
              null,
              null,
              true,
            ),
          );
        } else {
          this.eventBus.publish(
            new TransactionCompletedEvent(
              event.transactionId,
              event.sourceAccountId,
              event.destinationAccountId,
              Math.abs(event.amount),
              true,
            ),
          );
        }
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in destinationUserNotified saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };

  @Saga()
  balanceReleased = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(BalanceReleasedEvent),
      tap(async (event: BalanceReleasedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] Handling BalanceReleasedEvent (Compensation Result) for ${event.transactionId}`,
          { success: event.success },
        );

        // Use a default reason, as event does not carry it anymore.
        const failureReason = 'Compensation: Balance released';

        if (!event.success) {
          const reason = `CRITICAL: Failed to release balance during compensation`;
          this.loggingService.error(
            `[WithdrawalSaga] ${reason} for transaction ${event.transactionId}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            reason,
          );
        } else {
          this.loggingService.info(
            `[WithdrawalSaga] Compensation successful: Balance released for ${event.transactionId}. Final status: FAILED. Reason: ${failureReason}`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            failureReason,
          );
        }
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in balanceReleased saga step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
      mergeMap(() => of()),
    );
  };

  @Saga()
  transactionCompleted = (events$: Observable<any>): Observable<void> => {
    return events$.pipe(
      ofType(TransactionCompletedEvent),
      tap((event: TransactionCompletedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] Transaction ${event.transactionId} officially completed. Performing cleanup.`,
        );
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in transactionCompleted saga (cleanup) step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
      mergeMap(() => of()),
    );
  };
}
