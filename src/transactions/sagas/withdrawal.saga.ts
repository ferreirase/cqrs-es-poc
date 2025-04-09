import { Injectable } from '@nestjs/common';
import { CommandBus, EventBus, ofType, Saga } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { catchError, filter, mergeMap, Observable, of, tap } from 'rxjs';
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

      const currentTransaction = await this.transactionRepository.findOne({
        where: { id: transactionId },
      });

      if (currentTransaction && currentTransaction.status === status) {
        this.loggingService.info(
          `[WithdrawalSaga] Transaction ${transactionId} already has status ${status}, skipping update`,
        );
        return;
      }

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

      this.loggingService.info(
        `[WithdrawalSaga] Status update initiated for transaction ${transactionId}`,
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
      filter((event: StatementUpdatedEvent) => event.isSource === true),
      mergeMap(async (event: StatementUpdatedEvent) => {
        const handlerName = 'WithdrawalSaga::sourceStatementUpdated';
        this.loggingService.info(
          `[${handlerName}] Handling StatementUpdatedEvent (Source) for ${event.transactionId}`,
          { success: event.success, accountId: event.accountId },
        );

        // Verificar status ANTES de agir
        try {
          const transaction = await this.transactionRepository.findOne({
            where: { id: event.transactionId },
            select: ['id', 'status'],
          });

          if (!transaction) {
            this.loggingService.warn(
              `[${handlerName}] Transaction ${event.transactionId} not found. Skipping notification.`,
            );
            return;
          }

          if (
            transaction.status === TransactionStatus.COMPLETED ||
            transaction.status === TransactionStatus.FAILED
          ) {
            this.loggingService.info(
              `[${handlerName}] Transaction ${event.transactionId} already in final state (${transaction.status}). Skipping source notification.`,
            );
            return;
          }
        } catch (error) {
          this.loggingService.error(
            `[${handlerName}] Error checking transaction status: ${error.message}`,
            { transactionId: event.transactionId, error: error.stack },
          );
          return; // Não continuar se houver erro na verificação
        }

        if (!event.success) {
          const reason = event.error || 'Source statement update failed';
          this.loggingService.error(
            `[${handlerName}] ${reason} for ${event.transactionId}`,
          );
          // Atualizar status para FAILED se a atualização do extrato falhou
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            reason,
          );
          return;
        }

        // Se não há destinatário, publicar notificação para origem e completar
        if (!event.destinationAccountId) {
          this.loggingService.info(
            `[${handlerName}] No destination account for ${event.transactionId}. Notifying source and completing.`,
          );

          if (!event.sourceUserId) {
            this.loggingService.error(
              `[${handlerName}] Missing sourceUserId in StatementUpdatedEvent for final notification of ${event.transactionId}. Cannot notify.`,
            );
            await this.updateTransactionStatus(
              event.transactionId,
              TransactionStatus.COMPLETED, // Marcar como completo mesmo sem notificação
              'Completed without source user ID for notification',
            );
            return;
          }
          if (!event.amount) {
            this.loggingService.error(
              `[${handlerName}] Missing amount in StatementUpdatedEvent needed for source notification for ${event.transactionId}. Cannot notify.`,
            );
            await this.updateTransactionStatus(
              event.transactionId,
              TransactionStatus.COMPLETED, // Marcar como completo mesmo sem notificação
              'Completed without amount for source notification',
            );
            return;
          }

          const notifySourcePayload = {
            commandName: 'NotifyUserCommand',
            payload: {
              transactionId: event.transactionId,
              userId: event.sourceUserId,
              accountId: event.accountId, // source account ID
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
            `[${handlerName}] Published NotifyUserCommand (Source) for ${event.transactionId} (no destination)`,
          );
          // O UserNotifiedHandler irá eventualmente marcar como COMPLETED
          return;
        }

        // Se há destinatário, verificar se os detalhes estão presentes para a próxima etapa
        if (!event.destinationUserId || !event.amount) {
          this.loggingService.error(
            `[${handlerName}] Missing details (dest user/amount) in StatementUpdatedEvent for ${event.transactionId}. Cannot proceed to notify destination.`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED, // Falha, pois não podemos notificar o destino
            'Missing details for destination notification step',
          );
          return;
        }

        // Não faz nada aqui, espera o destinationStatementUpdated
        this.loggingService.info(
          `[${handlerName}] Source statement updated for ${event.transactionId}. Waiting for destination update.`,
        );
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga::sourceStatementUpdated] Error in sourceStatementUpdated saga step: ${error.message}`,
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
      filter((event: StatementUpdatedEvent) => event.isSource === false),
      mergeMap(async (event: StatementUpdatedEvent) => {
        const handlerName = 'WithdrawalSaga::destinationStatementUpdated';
        this.loggingService.info(
          `[${handlerName}] Handling StatementUpdatedEvent (Destination) for ${event.transactionId}`,
          { success: event.success, accountId: event.accountId },
        );

        // Verificar status ANTES de agir
        try {
          const transaction = await this.transactionRepository.findOne({
            where: { id: event.transactionId },
            select: ['id', 'status'],
          });

          if (!transaction) {
            this.loggingService.warn(
              `[${handlerName}] Transaction ${event.transactionId} not found. Skipping notification.`,
            );
            return;
          }

          if (
            transaction.status === TransactionStatus.COMPLETED ||
            transaction.status === TransactionStatus.FAILED
          ) {
            this.loggingService.info(
              `[${handlerName}] Transaction ${event.transactionId} already in final state (${transaction.status}). Skipping destination notification step.`,
            );
            return;
          }
        } catch (error) {
          this.loggingService.error(
            `[${handlerName}] Error checking transaction status: ${error.message}`,
            { transactionId: event.transactionId, error: error.stack },
          );
          return; // Não continuar se houver erro na verificação
        }

        if (!event.success) {
          const reason = event.error || 'Destination statement update failed';
          this.loggingService.error(
            `[${handlerName}] ${reason} for ${event.transactionId}`,
          );
          // Tentar compensar liberando o saldo da origem
          if (!event.sourceAccountId || !event.amount) {
            this.loggingService.error(
              `[${handlerName}] Cannot compensate failed dest statement update for ${event.transactionId}: Missing sourceAccountId or amount in event.`,
            );
            await this.updateTransactionStatus(
              event.transactionId,
              TransactionStatus.FAILED,
              `Failed destination statement update, compensation details missing: ${reason}`,
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
            `[${handlerName}] Published compensation (ReleaseBalance) for failed destination statement update of ${event.transactionId}`,
          );
          return;
        }

        // Se a atualização do extrato de destino foi bem-sucedida, notificar a origem
        if (!event.sourceUserId || !event.sourceAccountId || !event.amount) {
          this.loggingService.error(
            `[${handlerName}] Missing context details in StatementUpdatedEvent for notifying source user for ${event.transactionId}`,
          );
          // Considerar a transação FAILED pois não podemos notificar a origem
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Missing details for source notification step',
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
          `[${handlerName}] Published NotifyUserCommand (Source) for ${event.transactionId}`,
        );
        // A saga continua no handler sourceUserNotified
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga::destinationStatementUpdated] Error in destinationStatementUpdated saga step: ${error.message}`,
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
      filter((event: UserNotifiedEvent) => {
        const isSource = event.sourceAccountId === event.accountId;
        this.loggingService.info(
          `[WithdrawalSaga] Filter sourceUserNotified for ${event.transactionId}: isSource=${isSource}`,
          {
            sourceAccountId: event.sourceAccountId,
            accountId: event.accountId,
          },
        );
        return isSource;
      }),
      mergeMap(async (event: UserNotifiedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] TEMP LOG: sourceUserNotified received event payload: ${JSON.stringify(
            event,
          )}`,
        );

        try {
          const transaction = await this.transactionRepository.findOne({
            where: { id: event.transactionId },
          });

          if (
            transaction &&
            transaction.status === TransactionStatus.COMPLETED
          ) {
            this.loggingService.info(
              `[WithdrawalSaga] Transaction ${event.transactionId} is already COMPLETED, skipping sourceUserNotified processing`,
            );
            return;
          }
        } catch (error) {
          this.loggingService.warn(
            `[WithdrawalSaga] Error checking transaction status: ${error.message}`,
            { error: error.stack },
          );
        }

        this.loggingService.info(
          `[WithdrawalSaga] Handling UserNotifiedEvent (Source) for ${event.transactionId}`,
          { success: event.success, userId: event.userId },
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to notify source user for transaction ${event.transactionId}`,
          );
        }

        if (!event.destinationUserId) {
          this.loggingService.info(
            `[WithdrawalSaga] No destination user for ${event.transactionId}, marking transaction as complete after source notification.`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.COMPLETED,
          );
          this.loggingService.info(
            `[WithdrawalSaga] Transaction ${event.transactionId} marked as COMPLETED (no destination).`,
          );
          return;
        }

        if (!event.destinationAccountId || !event.amount) {
          this.loggingService.error(
            `[WithdrawalSaga] Missing destination account ID or amount in UserNotifiedEvent for final notification of ${event.transactionId}. Completing without dest notification.`,
          );
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.COMPLETED,
            'Completed with missing details for dest notification',
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

        this.loggingService.info(
          `[WithdrawalSaga] About to publish notification for destination user ${event.destinationUserId}`,
          { destination: event.destinationAccountId },
        );

        await this.rabbitMQService.publishToExchange(
          'commands.notify_user',
          notifyDestPayload,
        );
        this.loggingService.info(
          `[WithdrawalSaga] Published NotifyUserCommand (Destination) for ${event.transactionId}`,
        );
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
      filter((event: UserNotifiedEvent) => {
        const isDestination = event.destinationAccountId === event.accountId;
        this.loggingService.info(
          `[WithdrawalSaga] Filter destinationUserNotified for ${event.transactionId}: isDestination=${isDestination}`,
          {
            destinationAccountId: event.destinationAccountId,
            accountId: event.accountId,
          },
        );
        return isDestination;
      }),
      mergeMap(async (event: UserNotifiedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] TEMP LOG: destinationUserNotified received event payload: ${JSON.stringify(
            event,
          )}`,
        );

        try {
          const transaction = await this.transactionRepository.findOne({
            where: { id: event.transactionId },
          });

          if (
            transaction &&
            transaction.status === TransactionStatus.COMPLETED
          ) {
            this.loggingService.info(
              `[WithdrawalSaga] Transaction ${event.transactionId} is already COMPLETED, skipping destinationUserNotified processing`,
            );
            return;
          }
        } catch (error) {
          this.loggingService.warn(
            `[WithdrawalSaga] Error checking transaction status: ${error.message}`,
            { error: error.stack },
          );
        }

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

        this.loggingService.info(
          `[WithdrawalSaga] Transaction ${event.transactionId} marked as COMPLETED after destination notification.`,
        );
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
      filter((event: TransactionCompletedEvent) => {
        this.loggingService.info(
          `[WithdrawalSaga] Received TransactionCompletedEvent for ${event.transactionId}. Will check if already processed.`,
        );

        return true;
      }),
      mergeMap(async (event: TransactionCompletedEvent) => {
        try {
          const transaction = await this.transactionRepository.findOne({
            where: { id: event.transactionId },
          });

          if (
            transaction &&
            transaction.status === TransactionStatus.COMPLETED &&
            transaction.updatedAt &&
            new Date().getTime() - transaction.updatedAt.getTime() > 5000
          ) {
            this.loggingService.info(
              `[WithdrawalSaga] Transaction ${event.transactionId} already fully completed more than 5 seconds ago. Ignoring duplicate event.`,
            );
            return;
          }

          this.loggingService.info(
            `[WithdrawalSaga] Transaction ${event.transactionId} officially completed. Performing cleanup.`,
          );

          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.COMPLETED,
          );
        } catch (error) {
          this.loggingService.error(
            `[WithdrawalSaga] Error processing TransactionCompletedEvent: ${error.message}`,
            { transactionId: event.transactionId, error: error.stack },
          );
        }
      }),
      catchError((error, caught) => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in transactionCompleted saga (cleanup) step: ${error.message}`,
          { stack: error.stack },
        );
        return of();
      }),
    );
  };
}
