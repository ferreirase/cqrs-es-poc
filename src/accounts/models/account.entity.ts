import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('accounts')
export class AccountEntity {
  @PrimaryColumn()
  id: string;

  @Column()
  owner: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance: number;

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  updatedAt: Date;
} 