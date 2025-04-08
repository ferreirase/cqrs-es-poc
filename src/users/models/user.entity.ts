import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { AccountEntity } from '../../accounts/models/account.entity';

@Entity('users')
export class UserEntity {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column()
  document: string;

  @Column()
  email: string;

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  updatedAt: Date;

  @OneToOne(() => AccountEntity)
  @JoinColumn()
  account: AccountEntity;

  @Column({ nullable: true })
  accountId: string;
}
