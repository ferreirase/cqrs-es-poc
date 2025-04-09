import { AggregateRoot } from '@nestjs/cqrs';
import { BalanceCheckedEvent } from '../events/impl/balance-checked.event';
import { BalanceReleasedEvent } from '../events/impl/balance-released.event';
import { BalanceReservedEvent } from '../events/impl/balance-reserved.event';
import { TransactionConfirmedEvent } from '../events/impl/transaction-confirmed.event';
import { TransactionCreatedEvent } from '../events/impl/transaction-created.event';
import { TransactionProcessedEvent } from '../events/impl/transaction-processed.event';
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
    destinationAccountId: string,
    amount: number,
    success: boolean,
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

    if (this._status !== TransactionStatus.PROCESSED) {
      throw new Error(`Cannot confirm transaction in status ${this._status}`);
    }

    // Criando o evento
    const event = new TransactionConfirmedEvent(
      transactionId,
      sourceAccountId,
      destinationAccountId,
      amount,
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

    if (this._status === TransactionStatus.CONFIRMED) {
      throw new Error(`Cannot release balance for confirmed transaction`);
    }

    // Criando o evento
    const event = new BalanceReleasedEvent(
      transactionId,
      accountId,
      amount,
      success,
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
    if (event.success) {
      this._status = TransactionStatus.CONFIRMED;
    } else {
      this._status = TransactionStatus.FAILED;
      this._error = 'Failed to confirm transaction';
    }
    this._updatedAt = new Date();
  }

  // Quando um saldo é liberado
  onBalanceReleasedEvent(event: BalanceReleasedEvent) {
    if (event.success) {
      this._status = TransactionStatus.CANCELED;
    } else {
      this._error = 'Failed to release balance';
    }
    this._updatedAt = new Date();
  }
}
