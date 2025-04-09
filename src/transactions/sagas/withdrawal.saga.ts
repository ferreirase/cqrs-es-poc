import { Injectable } from '@nestjs/common';
import { CommandBus, EventBus, ICommand, ofType, Saga } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { catchError, mergeMap, Observable, of, switchMap } from 'rxjs';
import { Repository } from 'typeorm';
import { LoggingService } from '../../common/monitoring/logging.service';
import { ConfirmTransactionCommand } from '../commands/impl/confirm-transaction.command';
import { NotifyUserCommand } from '../commands/impl/notify-user.command';
import { ProcessTransactionCommand } from '../commands/impl/process-transaction.command';
import { ReleaseBalanceCommand } from '../commands/impl/release-balance.command';
import { ReserveBalanceCommand } from '../commands/impl/reserve-balance.command';
import { UpdateAccountStatementCommand } from '../commands/impl/update-account-statement.command';
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
import { TransactionContextService } from '../services/transaction-context.service';

@Injectable()
export class WithdrawalSaga {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly transactionContext: TransactionContextService,
    private readonly commandBus: CommandBus,
    private readonly eventBus: EventBus,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectModel(TransactionDocument.name)
    private readonly transactionModel: Model<TransactionDocument>,
  ) {}

  // Método helper para atualizar o status da transação em ambos repositórios diretamente
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

      // 1. Primeiro, emitir o comando para atualizar o status
      const statusCommand = new UpdateTransactionStatusCommand(
        transactionId,
        status,
        processedAt,
        error,
      );

      // Execute o comando para garantir que eventos e projeções sejam tratados
      await this.commandBus.execute(statusCommand);

      // 2. Atualizar do lado Command (TypeORM)
      const updateCommandData = {
        status,
        ...(processedAt && { processedAt }),
        updatedAt: new Date(),
        ...(error && { error }),
      };

      const commandResult = await this.transactionRepository.update(
        { id: transactionId },
        updateCommandData,
      );

      if (!commandResult.affected) {
        throw new Error(
          `Failed to update command-side transaction ${transactionId}`,
        );
      }

      this.loggingService.info(
        `[WithdrawalSaga] Command-side transaction updated for ${transactionId}`,
        { affected: commandResult.affected, status },
      );

      // 3. Atualizar do lado Query (MongoDB)
      const updateQueryData: any = {
        status,
        updatedAt: new Date(),
        ...(processedAt && { processedAt }),
        ...(error && { error }),
      };

      const queryResult = await this.transactionModel.findOneAndUpdate(
        { id: transactionId },
        { $set: updateQueryData },
        { new: true },
      );

      if (!queryResult) {
        throw new Error(
          `Failed to update query-side transaction ${transactionId}`,
        );
      }

      this.loggingService.info(
        `[WithdrawalSaga] Query-side transaction updated for ${transactionId}`,
        { status, success: true },
      );

      this.loggingService.info(
        `[WithdrawalSaga] Status updated successfully for transaction ${transactionId}`,
        { status },
      );
    } catch (err) {
      this.loggingService.error(
        `[WithdrawalSaga] Error updating transaction status for ${transactionId}`,
        { error: err.message, stack: err.stack },
      );
      throw err; // Re-throw para garantir que a saga saiba que houve falha
    }
  }

  @Saga()
  balanceChecked = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(BalanceCheckedEvent),
      mergeMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Balance checked event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.isBalanceSufficient) {
          this.loggingService.error(
            `[WithdrawalSaga] Insufficient balance for transaction ${event.transactionId}`,
          );

          // Atualizar o status para FAILED
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Insufficient balance',
          );

          // Não há compensação necessária, apenas finaliza o fluxo
          return null;
        }

        // Se o saldo for suficiente, prossegue para reservar o saldo
        return new ReserveBalanceCommand(
          event.transactionId,
          event.accountId,
          event.amount,
        );
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in balanceChecked saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  balanceReserved = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(BalanceReservedEvent),
      switchMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Balance reserved event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to reserve balance for transaction ${event.transactionId}`,
          );

          // Atualizar o status para FAILED
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Failed to reserve balance',
          );

          // Não há compensação necessária nesta etapa, apenas finaliza o fluxo
          return null;
        }

        // Atualizar status para RESERVED
        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.RESERVED,
        );

        // Obter o contexto atual (se existir) e prosseguir com o processamento
        this.loggingService.info(
          `[WithdrawalSaga] Proceeding to process transaction ${event.transactionId} after successful balance reserve`,
        );

        // Obter o contexto atual (se existir)
        const currentContext =
          this.transactionContext.getTransactionContext(event.transactionId) ||
          {};

        // Se o contexto atual não tiver destinationAccountId, tentamos carregar do banco
        if (!currentContext.destinationAccountId) {
          this.loggingService.info(
            `[WithdrawalSaga] Context incomplete for transaction ${event.transactionId}, loading details from database`,
          );

          await this.transactionContext.loadTransactionDetails(
            event.transactionId,
          );

          // Obtém o contexto atualizado após carregar do banco
          const updatedContext = this.transactionContext.getTransactionContext(
            event.transactionId,
          );

          // Se ainda não temos o destinationAccountId, carregamos os detalhes do banco
          if (!updatedContext || !updatedContext.destinationAccountId) {
            this.loggingService.info(
              `[WithdrawalSaga] Loading transaction details from database for ${event.transactionId}`,
            );

            const transaction = await this.transactionModel.findOne({
              id: event.transactionId,
            });

            if (!transaction || !transaction.destinationAccountId) {
              this.loggingService.error(
                `[WithdrawalSaga] Failed to get destination account for transaction ${event.transactionId}`,
              );

              // Atualizar status para FAILED
              await this.updateTransactionStatus(
                event.transactionId,
                TransactionStatus.FAILED,
                'Failed to get destination account details',
              );

              return null;
            }

            // Atualizar o contexto com os dados do banco
            await this.transactionContext.setTransactionContext(
              event.transactionId,
              {
                ...updatedContext,
                destinationAccountId: transaction.destinationAccountId,
                description: transaction.description,
              },
            );

            // Continuar o fluxo com o ProcessTransactionCommand usando os dados do banco
            return new ProcessTransactionCommand(
              event.transactionId,
              event.accountId,
              transaction.destinationAccountId,
              event.amount,
              transaction.description || 'Withdrawal operation',
            );
          }

          // Se já temos os dados no contexto, continuar o fluxo normalmente
          return new ProcessTransactionCommand(
            event.transactionId,
            event.accountId,
            updatedContext.destinationAccountId,
            event.amount,
            updatedContext.description || 'Withdrawal operation',
          );
        }

        // Se já temos todas as informações necessárias, podemos continuar o fluxo diretamente
        return new ProcessTransactionCommand(
          event.transactionId,
          event.accountId,
          currentContext.destinationAccountId,
          event.amount,
          currentContext.description || 'Withdrawal operation',
        );
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in balanceReserved saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  transactionProcessed = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(TransactionProcessedEvent),
      mergeMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Transaction processed event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to process transaction ${event.transactionId}`,
          );

          // Atualizar status para FAILED
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Failed to process transaction',
          );

          // Compensação: liberar o saldo reservado
          return new ReleaseBalanceCommand(
            event.transactionId,
            event.sourceAccountId,
            event.amount,
          );
        }

        // Atualizar status para PROCESSED e prosseguir com a confirmação
        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.PROCESSED,
        );

        this.loggingService.info(
          `[WithdrawalSaga] Transaction ${event.transactionId} processed successfully, proceeding to confirmation`,
        );

        // Continuar o fluxo com confirmação da transação
        return new ConfirmTransactionCommand(
          event.transactionId,
          event.sourceAccountId,
          event.destinationAccountId,
          event.amount,
        );
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in transactionProcessed saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  transactionConfirmed = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(TransactionConfirmedEvent),
      mergeMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Transaction confirmed event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to confirm transaction ${event.transactionId}`,
          );

          // Atualizar status para FAILED
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Failed to confirm transaction',
          );

          // Compensação: liberar o saldo reservado
          return new ReleaseBalanceCommand(
            event.transactionId,
            event.sourceAccountId,
            event.amount,
          );
        }

        // Atualizar status para CONFIRMED e verificar contexto
        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.CONFIRMED,
        );

        this.loggingService.info(
          `[WithdrawalSaga] Transaction ${event.transactionId} confirmed, proceeding to statement updates`,
        );

        // Garantir que temos o contexto completo para os próximos passos
        const context =
          this.transactionContext.getTransactionContext(event.transactionId) ||
          {};

        // Atualizar o contexto com as informações mais recentes da transação
        await this.transactionContext.setTransactionContext(
          event.transactionId,
          {
            ...context,
            sourceAccountId: event.sourceAccountId,
            destinationAccountId: event.destinationAccountId,
            amount: event.amount,
            status: TransactionStatus.CONFIRMED,
            confirmedAt: new Date(),
          },
        );

        // Prosseguir para atualizar o extrato da conta de origem
        return new UpdateAccountStatementCommand(
          event.transactionId,
          event.sourceAccountId,
          event.amount,
          'DEBIT',
          'Withdrawal operation',
        );
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in transactionConfirmed saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  sourceStatementUpdated = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(StatementUpdatedEvent),
      mergeMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Source statement updated event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to update source statement for transaction ${event.transactionId}`,
          );

          // Atualizar status para FAILED
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Failed to update source account statement',
          );

          return null;
        }

        // Verifica se existe uma conta de destino
        const context = this.transactionContext.getTransactionContext(
          event.transactionId,
        );

        if (!context || !context.destinationAccountId) {
          this.loggingService.warn(
            `[WithdrawalSaga] Missing destination account for transaction ${event.transactionId}`,
          );

          // Obtém o usuário origem para notificá-lo
          const sourceUser =
            await this.transactionContext.loadUserFromAccountId(
              event.accountId,
            );

          if (!sourceUser || !sourceUser.id) {
            return null;
          } // No destination account, this is a direct withdrawal
          // Mark as COMPLETED and notify user
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.COMPLETED,
          );

          this.loggingService.info(
            `[WithdrawalSaga] Direct withdrawal ${event.transactionId} completed, notifying user`,
          );

          return new NotifyUserCommand(
            sourceUser.id,
            event.transactionId,
            event.accountId,
            event.amount,
            NotificationType.WITHDRAWAL,
            NotificationStatus.SUCCESS,
          );
        }

        // Se há uma conta de destino, prossegue para atualizar seu extrato
        return new UpdateAccountStatementCommand(
          event.transactionId,
          context.destinationAccountId,
          event.amount,
          'CREDIT',
          'Deposit from withdrawal operation',
        );
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in sourceStatementUpdated saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  destinationStatementUpdated = (
    events$: Observable<any>,
  ): Observable<ICommand> => {
    return events$.pipe(
      ofType(StatementUpdatedEvent),
      mergeMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Destination statement updated event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to update destination statement for transaction ${event.transactionId}`,
          );

          // Atualizar status para FAILED
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Failed to update destination account statement',
          );

          return null;
        }

        // Buscar o contexto da transação
        const context = this.transactionContext.getTransactionContext(
          event.transactionId,
        );

        if (!context || !context.sourceAccountId) {
          return null;
        }

        // Verifica se a conta atualizada é a conta de destino
        // (comparando com a fonte do contexto)
        if (context.sourceAccountId === event.accountId) {
          // Se for a conta de origem, ignora (já tratamos no saga anterior)
          return null;
        }

        // Como é a conta de destino, notificamos os usuários
        // Primeiro o usuário de origem
        const sourceUser = await this.transactionContext.loadUserFromAccountId(
          context.sourceAccountId,
        );

        if (!sourceUser || !sourceUser.id) {
          this.loggingService.warn(
            `[WithdrawalSaga] Missing source user ID for transaction ${event.transactionId}`,
          );
          return null;
        }

        // Notificar usuário origem
        return new NotifyUserCommand(
          sourceUser.id,
          event.transactionId,
          context.sourceAccountId,
          context.amount,
          NotificationType.WITHDRAWAL,
          NotificationStatus.SUCCESS,
        );
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in destinationStatementUpdated saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  sourceUserNotified = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(UserNotifiedEvent),
      mergeMap(async event => {
        if (event.type === NotificationType.WITHDRAWAL) {
          this.loggingService.info(
            `[WithdrawalSaga] Source user notified event received: ${JSON.stringify(
              event,
            )}`,
          );

          if (!event.success) {
            this.loggingService.error(
              `[WithdrawalSaga] Failed to notify source user for transaction ${event.transactionId}`,
            );
            // Não interrompemos a saga por falha na notificação
          }

          // Buscar o contexto da transação
          const context = this.transactionContext.getTransactionContext(
            event.transactionId,
          );

          if (!context || !context.destinationAccountId) {
            return null;
          }

          // Se este usuário notificado for da conta de origem
          if (event.accountId === context.sourceAccountId) {
            // Agora notificamos o usuário de destino
            const destUser =
              await this.transactionContext.loadUserFromAccountId(
                context.destinationAccountId,
              );

            if (!destUser || !destUser.id) {
              this.loggingService.warn(
                `[WithdrawalSaga] Missing destination user or account for transaction ${event.transactionId}`,
              );

              // Atualizar status para COMPLETED
              await this.updateTransactionStatus(
                event.transactionId,
                TransactionStatus.COMPLETED,
              );

              return null;
            }

            // Continue to notify destination user first
            // We'll mark as COMPLETED only after all notifications
            return new NotifyUserCommand(
              destUser.id,
              event.transactionId,
              context.destinationAccountId,
              context.amount,
              NotificationType.DEPOSIT,
              NotificationStatus.SUCCESS,
            );
          }
        }

        return null;
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in sourceUserNotified saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  destinationUserNotified = (
    events$: Observable<any>,
  ): Observable<ICommand> => {
    return events$.pipe(
      ofType(UserNotifiedEvent),
      mergeMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Destination user notified event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to notify destination user for transaction ${event.transactionId}`,
          );
          // Não interrompemos a saga por falha na notificação
        }

        // Obter o contexto da transação
        const context = this.transactionContext.getTransactionContext(
          event.transactionId,
        );

        if (!context) {
          this.loggingService.warn(
            `[WithdrawalSaga] No context found for transaction ${event.transactionId}`,
          );
          return null;
        }

        // Verificar se este evento é para o destino (e não para a origem)
        if (event.type !== NotificationType.DEPOSIT) {
          // Ignorar este evento, pois é da origem
          return null;
        }

        // Após notificar o destinatário, marcar a transação como COMPLETED
        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.COMPLETED,
        );

        this.loggingService.info(
          `[WithdrawalSaga] Transaction ${event.transactionId} marked as COMPLETED after successful notifications`,
        );

        // Publicar evento explícito de conclusão
        const completedEvent = new TransactionCompletedEvent(
          event.transactionId,
          context.sourceAccountId,
          context.destinationAccountId,
          context.amount,
          true,
        );

        this.eventBus.publish(completedEvent);

        // Limpar o contexto da transação que não é mais necessário
        this.transactionContext.clearTransactionContext(event.transactionId);

        // Esta é a última etapa da saga, não há mais comandos para emitir
        return null;
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in destinationUserNotified saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  balanceReleased = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(BalanceReleasedEvent),
      mergeMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Balance released event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to release balance for transaction ${event.transactionId}`,
          );
        }

        // Marca a transação como cancelada (compensation action)
        await this.updateTransactionStatus(
          event.transactionId,
          TransactionStatus.CANCELED,
          event.success ? undefined : 'Failed to release balance',
        );

        // Buscar contexto para notificar usuário
        const context = this.transactionContext.getTransactionContext(
          event.transactionId,
        );

        if (!context || !context.sourceAccountId) {
          return null;
        }

        // Notificar usuário sobre o cancelamento
        const sourceUser = await this.transactionContext.loadUserFromAccountId(
          context.sourceAccountId,
        );

        if (!sourceUser || !sourceUser.id) {
          return null;
        }

        return new NotifyUserCommand(
          sourceUser.id,
          event.transactionId,
          context.sourceAccountId,
          context.amount,
          NotificationType.WITHDRAWAL,
          NotificationStatus.FAILED,
        );
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in balanceReleased saga: ${error.message}`,
        );
        return of();
      }),
    );
  };

  @Saga()
  transactionCompleted = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(TransactionCompletedEvent),
      mergeMap(async event => {
        this.loggingService.info(
          `[WithdrawalSaga] Transaction completed event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to complete transaction ${event.transactionId}`,
          );

          // Atualizar status para FAILED
          await this.updateTransactionStatus(
            event.transactionId,
            TransactionStatus.FAILED,
            'Failed to complete transaction',
          );

          return null;
        }

        this.loggingService.info(
          `[WithdrawalSaga] Transaction ${event.transactionId} completed successfully`,
        );

        // Não há mais comandos para emitir, o fluxo termina aqui
        return null;
      }),
      // Filtra valores nulos (quando o fluxo termina sem comandos)
      mergeMap(command => (command ? of(command) : of())),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in transactionCompleted saga: ${error.message}`,
        );
        return of();
      }),
    );
  };
}
