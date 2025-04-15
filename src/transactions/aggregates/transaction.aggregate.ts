import { AggregateRoot } from '@nestjs/cqrs';
import { BalanceCheckedEvent } from '../events/impl/balance-checked.event';
import { BalanceReleasedEvent } from '../events/impl/balance-released.event';
import { BalanceReservedEvent } from '../events/impl/balance-reserved.event';
import { StatementUpdatedEvent } from '../events/impl/statement-updated.event';
import { TransactionConfirmedEvent } from '../events/impl/transaction-confirmed.event';
import { TransactionCreatedEvent } from '../events/impl/transaction-created.event';
import { TransactionProcessedEvent } from '../events/impl/transaction-processed.event';
import { TransactionStatusUpdatedEvent } from '../events/impl/transaction-status-updated.event';
import { TransactionType } from '../models/transaction.entity';
import { TransactionStatus } from '../models/transaction.schema';

export class TransactionAggregate extends AggregateRoot {
  private _id: string;
  private _sourceAccountId: string;
  private _destinationAccountId: string;
  private _amount: number;
  private _type: TransactionType;
  private _status: TransactionStatus;
  private _description: string;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _processedAt: Date;
  private _error: string;

  get id(): string {
    return this._id;
  }

  get sourceAccountId(): string {
    return this._sourceAccountId;
  }

  get destinationAccountId(): string {
    return this._destinationAccountId;
  }

  get amount(): number {
    return this._amount;
  }

  get type(): TransactionType {
    return this._type;
  }

  get status(): TransactionStatus {
    return this._status;
  }

  get description(): string {
    return this._description;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // Método para criar uma nova transação
  createTransaction(
    id: string,
    sourceAccountId: string,
    destinationAccountId: string,
    amount: number,
    type: TransactionType,
    description: string,
  ) {
    // Aplicando regras de negócio
    if (amount <= 0) {
      throw new Error('Transaction amount must be greater than zero');
    }

    // Criando o evento
    const event = new TransactionCreatedEvent(
      id,
      sourceAccountId,
      destinationAccountId,
      amount,
      type,
      description,
    );

    // Aplicando o evento ao agregado
    this.apply(event);
  }

  // Método para reservar saldo
  reserveBalance(
    transactionId: string,
    accountId: string,
    amount: number,
    success: boolean,
  ) {
    // Validações
    if (this._id !== transactionId) {
      throw new Error(
        `Transaction ID mismatch: ${this._id} != ${transactionId}`,
      );
    }

    if (this._sourceAccountId !== accountId) {
      throw new Error(
        `Source account ID mismatch: ${this._sourceAccountId} != ${accountId}`,
      );
    }

    if (this._status !== TransactionStatus.PENDING) {
      throw new Error(
        `Cannot reserve balance for transaction in status ${this._status}`,
      );
    }

    // Criando o evento
    const event = new BalanceReservedEvent(
      transactionId,
      accountId,
      amount,
      success,
    );

    // Aplicando o evento ao agregado
    this.apply(event);
  }

  // Método para processar a transação
  processTransaction(
    transactionId: string,
    sourceAccountId: string,
    destinationAccountId: string,
    amount: number,
    success: boolean,
    description: string,
    status: TransactionStatus,
    type: TransactionType = TransactionType.WITHDRAWAL,
  ) {
    // Validações
    if (this._id !== transactionId) {
      throw new Error(
        `Transaction ID mismatch: ${this._id} != ${transactionId}`,
      );
    }

    if (this._sourceAccountId !== sourceAccountId) {
      throw new Error(
        `Source account ID mismatch: ${this._sourceAccountId} != ${sourceAccountId}`,
      );
    }

    if (
      this._status !== TransactionStatus.RESERVED &&
      this._status !== TransactionStatus.PENDING
    ) {
      throw new Error(`Cannot process transaction in status ${this._status}`);
    }

    // Criando o evento
    const event = new TransactionProcessedEvent(
      transactionId,
      sourceAccountId,
      destinationAccountId,
      amount,
      success,
      description,
      status,
      type,
    );

    // Aplicando o evento ao agregado
    this.apply(event);
  }

  // Método para confirmar a transação
  confirmTransaction(
    transactionId: string,
    sourceAccountId: string,
    destinationAccountId: string | null,
    amount: number,
    description: string | null,
    success: boolean,
    error?: string,
  ) {
    // Validações
    if (this._id !== transactionId) {
      throw new Error(
        `Transaction ID mismatch: ${this._id} != ${transactionId}`,
      );
    }

    if (this._sourceAccountId !== sourceAccountId) {
      throw new Error(
        `Source account ID mismatch: ${this._sourceAccountId} != ${sourceAccountId}`,
      );
    }

    // Confirmation should happen after processing
    if (this._status !== TransactionStatus.PROCESSED) {
      throw new Error(`Cannot confirm transaction in status ${this._status}`);
    }

    // Criando o evento com todos os dados
    const event = new TransactionConfirmedEvent(
      transactionId,
      sourceAccountId,
      destinationAccountId,
      amount,
      description,
      success,
      error,
    );

    // Aplicando o evento ao agregado
    this.apply(event);
  }

  // Método para atualizar o status da transação
  updateStatus(transactionId: string, status: TransactionStatus) {
    // Validações
    if (this._id !== transactionId) {
      throw new Error(
        `Transaction ID mismatch: ${this._id} != ${transactionId}`,
      );
    }

    // Criando o evento
    const event = new TransactionStatusUpdatedEvent(transactionId, status);

    // Aplicando o evento ao agregado
    this.apply(event);
  }

  // Método para verificar saldo
  checkBalance(
    transactionId: string,
    accountId: string,
    isBalanceSufficient: boolean,
    amount: number,
  ) {
    // Validações
    if (this._id !== transactionId) {
      throw new Error(
        `Transaction ID mismatch: ${this._id} != ${transactionId}`,
      );
    }

    if (this._sourceAccountId !== accountId) {
      throw new Error(
        `Source account ID mismatch: ${this._sourceAccountId} != ${accountId}`,
      );
    }

    // Criando o evento
    const event = new BalanceCheckedEvent(
      transactionId,
      accountId,
      isBalanceSufficient,
      amount,
    );

    // Aplicando o evento ao agregado
    this.apply(event);
  }

  // Método para atualizar o extrato
  updateStatement(
    transactionId: string,
    accountId: string,
    amount: number,
    type: 'DEBIT' | 'CREDIT',
    success: boolean,
  ) {
    // Validações
    if (this._id !== transactionId) {
      throw new Error(
        `Transaction ID mismatch: ${this._id} != ${transactionId}`,
      );
    }

    // Criando o evento
    const event = new StatementUpdatedEvent(
      transactionId,
      accountId,
      amount,
      type,
      success,
    );

    // Aplicando o evento ao agregado
    this.apply(event);
  }

  // Método para liberar saldo reservado
  releaseBalance(
    transactionId: string,
    accountId: string,
    amount: number,
    success: boolean,
    reason?: string,
    error?: string,
  ) {
    // Validações
    if (this._id !== transactionId) {
      throw new Error(
        `Transaction ID mismatch: ${this._id} != ${transactionId}`,
      );
    }

    if (this._sourceAccountId !== accountId) {
      throw new Error(
        `Source account ID mismatch: ${this._sourceAccountId} != ${accountId}`,
      );
    }

    // Should not release if already confirmed
    if (this._status === TransactionStatus.CONFIRMED) {
      throw new Error(`Cannot release balance for confirmed transaction`);
    }
    // Also check if already completed or cancelled?
    if (
      this._status === TransactionStatus.COMPLETED ||
      this._status === TransactionStatus.CANCELED ||
      this._status === TransactionStatus.FAILED
    ) {
      console.warn(
        `[TransactionAggregate] Attempting to release balance for already finalized transaction ${transactionId} in status ${this._status}. Ignoring.`,
      );
      return; // Avoid emitting event again if already finalized
    }

    // Criando o evento
    const event = new BalanceReleasedEvent(
      transactionId,
      accountId,
      amount,
      success,
      reason,
      error,
    );

    // Aplicando o evento ao agregado
    this.apply(event);
  }

  // Manipuladores de eventos para reconstruir o estado

  // Quando uma transação é criada
  onTransactionCreatedEvent(event: TransactionCreatedEvent) {
    this._id = event.id;
    this._sourceAccountId = event.sourceAccountId;
    this._destinationAccountId = event.destinationAccountId;
    this._amount = event.amount;
    this._type = event.type;
    this._description = event.description;
    this._status = TransactionStatus.PENDING;
    this._createdAt = new Date();
    this._updatedAt = new Date();
  }

  // Handler para o evento BalanceCheckedEvent
  onBalanceCheckedEvent(event: BalanceCheckedEvent) {
    this._id = event.transactionId;
    this._sourceAccountId = event.accountId;
    this._amount = event.amount;
    this._status = event.isBalanceSufficient
      ? TransactionStatus.PENDING
      : TransactionStatus.FAILED;
    this._error = event.isBalanceSufficient ? null : 'Insufficient balance';
    this._updatedAt = new Date();
  }

  // Handler para o evento BalanceReservedEvent
  onBalanceReservedEvent(event: BalanceReservedEvent) {
    this._id = event.transactionId;
    this._sourceAccountId = event.accountId;
    this._amount = event.amount;
    this._status = event.success
      ? TransactionStatus.RESERVED
      : TransactionStatus.FAILED;
    this._error = event.success ? null : 'Failed to reserve balance';
    this._updatedAt = new Date();
  }

  // Quando uma transação é processada
  onTransactionProcessedEvent(event: TransactionProcessedEvent) {
    if (this._id !== event.transactionId) return;

    if (event.success) {
      this._status = TransactionStatus.PROCESSED;
      this._processedAt = new Date();
    } else {
      this._status = TransactionStatus.FAILED;
      // Idealmente, o evento teria a razão da falha
      this._error = 'Transaction processing failed';
    }
    this._updatedAt = new Date();
  }

  // Quando uma transação é confirmada
  onTransactionConfirmedEvent(event: TransactionConfirmedEvent) {
    if (this._id !== event.transactionId) return;

    if (event.success) {
      this._status = TransactionStatus.COMPLETED;
      this._error = null; // Limpar erro em caso de sucesso
    } else {
      this._status = TransactionStatus.FAILED;
      this._error = event.error || 'Transaction confirmation failed';
    }
    this._updatedAt = new Date();
  }

  // Quando o saldo reservado é liberado (compensação)
  onBalanceReleasedEvent(event: BalanceReleasedEvent) {
    if (this._id !== event.transactionId) return;
    // A liberação pode acontecer em caso de falha para reverter a reserva
    // Atualizamos o status para FAILED ou CANCELLED dependendo da lógica
    // Se já falhou, manter FAILED.
    if (this._status !== TransactionStatus.FAILED) {
      this._status = TransactionStatus.CANCELLED; // Ou FAILED, dependendo do fluxo
    }
    this._error =
      event.reason || 'Balance released due to failure/cancellation';
    this._updatedAt = new Date();
  }

  onTransactionStatusUpdatedEvent(event: TransactionStatusUpdatedEvent) {
    this._status = event.status;
    this._updatedAt = new Date();
  }

  onStatementUpdatedEvent(event: StatementUpdatedEvent) {
    this._updatedAt = new Date();
  }
}
