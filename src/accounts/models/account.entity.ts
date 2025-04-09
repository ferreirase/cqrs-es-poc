import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../../users/models/user.entity';

@Entity('accounts')
@Unique('unique_owner', ['owner_id'])
export class AccountEntity {
  @PrimaryColumn()
  id: string;

  @ManyToOne(() => UserEntity, user => user.accounts)
  @JoinColumn({ name: 'owner_id' })
  owner: UserEntity;

  @Column()
  owner_id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance: number;

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  updatedAt: Date;
}
