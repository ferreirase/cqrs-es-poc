import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('events')
export class EventEntity {
  @PrimaryColumn()
  id: string;

  @Column()
  type: string;

  @Column()
  timestamp: Date;

  @Column({ type: 'text' })
  data: string;

  @Column()
  aggregateId: string;
}
