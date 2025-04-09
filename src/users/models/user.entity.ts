import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
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

  @OneToMany(() => AccountEntity, account => account.owner)
  accounts: AccountEntity[];
}
