import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  TRANSFER = 'transfer',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('transactions')
export class TransactionEntity {
  @PrimaryColumn()
  id: string;

  @Column()
  sourceAccountId: string;

  @Column({ nullable: true })
  destinationAccountId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ nullable: true })
  description: string;

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  processedAt: Date;
}