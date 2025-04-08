import { Injectable } from '@nestjs/common';
import { ICommand, ofType, Saga } from '@nestjs/cqrs';
import { catchError, map, mergeMap, Observable, of } from 'rxjs';
import { LoggingService } from '../../common/monitoring/logging.service';
import { ConfirmTransactionCommand } from '../commands/impl/confirm-transaction.command';
import { NotifyUserCommand } from '../commands/impl/notify-user.command';
import { ProcessTransactionCommand } from '../commands/impl/process-transaction.command';
import { ReleaseBalanceCommand } from '../commands/impl/release-balance.command';
import { ReserveBalanceCommand } from '../commands/impl/reserve-balance.command';
import { UpdateAccountStatementCommand } from '../commands/impl/update-account-statement.command';
import { BalanceCheckedEvent } from '../events/impl/balance-checked.event';
import { BalanceReleasedEvent } from '../events/impl/balance-released.event';
import { BalanceReservedEvent } from '../events/impl/balance-reserved.event';
import { StatementUpdatedEvent } from '../events/impl/statement-updated.event';
import { TransactionConfirmedEvent } from '../events/impl/transaction-confirmed.event';
import { TransactionProcessedEvent } from '../events/impl/transaction-processed.event';
import { UserNotifiedEvent } from '../events/impl/user-notified.event';
import {
  NotificationStatus,
  NotificationType,
} from '../models/notification.enum';

@Injectable()
export class WithdrawalSaga {
  constructor(private readonly loggingService: LoggingService) {}

  @Saga()
  balanceChecked = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(BalanceCheckedEvent),
      mergeMap(event => {
        this.loggingService.info(
          `[WithdrawalSaga] Balance checked event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.isBalanceSufficient) {
          this.loggingService.error(
            `[WithdrawalSaga] Insufficient balance for transaction ${event.transactionId}`,
          );
          // Não há compensação necessária, apenas finaliza o fluxo
          return of();
        }

        // Se o saldo for suficiente, prossegue para reservar o saldo
        return of(
          new ReserveBalanceCommand(
            event.transactionId,
            event.accountId,
            event.amount,
          ),
        );
      }),
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
      mergeMap(event => {
        this.loggingService.info(
          `[WithdrawalSaga] Balance reserved event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to reserve balance for transaction ${event.transactionId}`,
          );
          // Não há compensação necessária nesta etapa, apenas finaliza o fluxo
          return of();
        }

        // Buscar informações da transação para prosseguir
        // Na implementação real, isso pode vir de um serviço ou repositório
        // Aqui vamos simular com valores fixos
        const sourceAccountId = event.accountId;
        const destinationAccountId = 'destination-account-id'; // Deve ser recuperado do contexto
        const amount = event.amount;
        const description = 'Withdrawal operation'; // Deve ser recuperado do contexto

        // Prossegue para processar a transação
        return of(
          new ProcessTransactionCommand(
            event.transactionId,
            sourceAccountId,
            destinationAccountId,
            amount,
            description,
          ),
        );
      }),
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
      mergeMap(event => {
        this.loggingService.info(
          `[WithdrawalSaga] Transaction processed event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to process transaction ${event.transactionId}`,
          );
          // Compensação: liberar o saldo reservado
          return of(
            new ReleaseBalanceCommand(
              event.transactionId,
              event.sourceAccountId,
              event.amount,
            ),
          );
        }

        // Prossegue para confirmar a transação
        return of(
          new ConfirmTransactionCommand(
            event.transactionId,
            event.sourceAccountId,
            event.destinationAccountId,
            event.amount,
          ),
        );
      }),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in transactionProcessed saga: ${error.message}`,
        );
        // Em caso de erro, tentamos liberar o saldo reservado
        // Precisaríamos acessar o contexto para recuperar as informações da transação
        return of();
      }),
    );
  };

  @Saga()
  transactionConfirmed = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(TransactionConfirmedEvent),
      mergeMap(event => {
        this.loggingService.info(
          `[WithdrawalSaga] Transaction confirmed event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to confirm transaction ${event.transactionId}`,
          );
          // Compensação: liberar o saldo reservado
          return of(
            new ReleaseBalanceCommand(
              event.transactionId,
              event.sourceAccountId,
              event.amount,
            ),
          );
        }

        // Prossegue para atualizar o extrato das contas
        return of(
          // Atualiza o extrato da conta de origem (débito)
          new UpdateAccountStatementCommand(
            event.transactionId,
            event.sourceAccountId,
            event.amount,
            'DEBIT',
            'Withdrawal operation',
          ),
        );
      }),
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
      map(event => event as StatementUpdatedEvent),
      mergeMap(event => {
        if (event.type === 'DEBIT') {
          this.loggingService.info(
            `[WithdrawalSaga] Source statement updated event received: ${JSON.stringify(
              event,
            )}`,
          );

          if (!event.success) {
            this.loggingService.error(
              `[WithdrawalSaga] Failed to update source statement for transaction ${event.transactionId}`,
            );
            // A transação já foi confirmada, mas o registro do extrato falhou
            // Podemos tentar novamente ou seguir em frente, pois o balanço já foi atualizado
          }

          // Recuperar informações da transação do contexto ou serviço
          const destinationAccountId = 'destination-account-id'; // Deve vir do contexto

          // Atualiza o extrato da conta de destino (crédito)
          return of(
            new UpdateAccountStatementCommand(
              event.transactionId,
              destinationAccountId,
              event.amount,
              'CREDIT',
              'Deposit from withdrawal operation',
            ),
          );
        }
        return of();
      }),
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
      map(event => event as StatementUpdatedEvent),
      mergeMap(event => {
        if (event.type === 'CREDIT') {
          this.loggingService.info(
            `[WithdrawalSaga] Destination statement updated event received: ${JSON.stringify(
              event,
            )}`,
          );

          if (!event.success) {
            this.loggingService.error(
              `[WithdrawalSaga] Failed to update destination statement for transaction ${event.transactionId}`,
            );
            // O extrato de destino falhou, mas o balanço já foi atualizado
            // Podemos tentar novamente ou seguir em frente
          }

          // Recuperar informações dos usuários associados às contas
          // Normalmente isso viria de um serviço/repositório
          const sourceUserId = 'source-user-id'; // Deve vir do contexto

          // Notificar o usuário de origem sobre o débito
          return of(
            new NotifyUserCommand(
              sourceUserId,
              event.transactionId,
              event.accountId,
              event.amount,
              NotificationType.WITHDRAWAL,
              NotificationStatus.SUCCESS,
            ),
          );
        }
        return of();
      }),
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
      map(event => event as UserNotifiedEvent),
      mergeMap(event => {
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
            // Falha não crítica, podemos tentar novamente ou seguir em frente
          }

          // Recuperar informações dos usuários associados às contas
          // Normalmente isso viria de um serviço/repositório
          const destinationUserId = 'destination-user-id'; // Deve vir do contexto
          const destinationAccountId = 'destination-account-id'; // Deve vir do contexto

          // Notificar o usuário de destino sobre o crédito
          return of(
            new NotifyUserCommand(
              destinationUserId,
              event.transactionId,
              destinationAccountId,
              event.amount,
              NotificationType.DEPOSIT,
              NotificationStatus.SUCCESS,
            ),
          );
        }
        return of();
      }),
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
      map(event => event as UserNotifiedEvent),
      mergeMap(event => {
        if (event.type === NotificationType.DEPOSIT) {
          this.loggingService.info(
            `[WithdrawalSaga] Destination user notified event received: ${JSON.stringify(
              event,
            )}`,
          );

          if (!event.success) {
            this.loggingService.error(
              `[WithdrawalSaga] Failed to notify destination user for transaction ${event.transactionId}`,
            );
            // Falha não crítica, podemos tentar novamente ou seguir em frente
          }

          // Fim do fluxo da Saga, nenhum comando adicional a ser emitido
          this.loggingService.info(
            `[WithdrawalSaga] Workflow completed successfully for transaction ${event.transactionId}`,
          );
        }
        return of();
      }),
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
      mergeMap(event => {
        this.loggingService.info(
          `[WithdrawalSaga] Balance released event received: ${JSON.stringify(
            event,
          )}`,
        );

        if (!event.success) {
          this.loggingService.error(
            `[WithdrawalSaga] Failed to release balance for transaction ${event.transactionId}`,
          );
          // Falha crítica na compensação, deve ser tratada manualmente
          // Registrar para auditoria e alertar operadores
        } else {
          this.loggingService.info(
            `[WithdrawalSaga] Successfully released balance for transaction ${event.transactionId}`,
          );
          // A compensação foi bem-sucedida, o fluxo foi revertido
        }

        // Recuperar informações de usuário para notificar sobre a falha
        const userId = 'source-user-id'; // Deve vir do contexto

        // Notificar usuário sobre a falha na transação
        return of(
          new NotifyUserCommand(
            userId,
            event.transactionId,
            event.accountId,
            event.amount,
            NotificationType.WITHDRAWAL,
            NotificationStatus.FAILED,
          ),
        );
      }),
      catchError(error => {
        this.loggingService.error(
          `[WithdrawalSaga] Error in balanceReleased saga: ${error.message}`,
        );
        return of();
      }),
    );
  };
}
