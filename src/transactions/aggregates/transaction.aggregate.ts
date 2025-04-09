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
  }

  // Quando um saldo é verificado
  onBalanceCheckedEvent(event: BalanceCheckedEvent) {
    // Este evento não altera o estado do agregado, mas é importante registrá-lo
    // para manter a sequência de eventos consistente
    this._updatedAt = new Date();

    // Se o saldo for insuficiente, marcar a transação como falha
    if (!event.isBalanceSufficient) {
      this._status = TransactionStatus.FAILED;
      this._error = 'Insufficient balance';
    }
  }

  // Quando um saldo é reservado
  onBalanceReservedEvent(event: BalanceReservedEvent) {
    if (event.success) {
      this._status = TransactionStatus.RESERVED;
    } else {
      this._status = TransactionStatus.FAILED;
      this._error = 'Failed to reserve balance';
    }
    this._updatedAt = new Date();
  }

  // Quando uma transação é processada
  onTransactionProcessedEvent(event: TransactionProcessedEvent) {
    this._destinationAccountId = event.destinationAccountId;
    this._status = event.status as TransactionStatus;
    this._description = event.description;
    this._processedAt = new Date();
    this._updatedAt = new Date();

    if (!event.success) {
      this._error = event.error || 'Transaction processing failed';
    }
  }

  // Quando uma transação é confirmada
  onTransactionConfirmedEvent(event: TransactionConfirmedEvent) {
    this._status = event.success
      ? TransactionStatus.CONFIRMED
      : TransactionStatus.FAILED;
    this._error = event.error; // Store error message if confirmation failed
    this._updatedAt = new Date();
    // Note: We don't update source/destination/amount/description here as they were set at creation
    // The event carries them for downstream consumers (like the saga).
  }

  // Quando o saldo reservado é liberado (compensação)
  onBalanceReleasedEvent(event: BalanceReleasedEvent) {
    // Release typically means the transaction failed after reservation.
    // We mark as FAILED unless the release itself failed critically.
    this._status = event.success
      ? TransactionStatus.FAILED // Compensation succeeded, TX failed
      : TransactionStatus.FAILED; // Compensation failed, TX also failed (maybe needs specific state?)
    this._error =
      event.error || event.reason || 'Balance released due to failure'; // Record reason/error
    this._updatedAt = new Date();
  }

  onTransactionStatusUpdatedEvent(event: TransactionStatusUpdatedEvent) {
    this._status = event.status;
    this._updatedAt = new Date();
    if (event.processedAt) {
      this._processedAt = event.processedAt;
    }
    if (event.error) {
      this._error = event.error;
    }
  }
}
