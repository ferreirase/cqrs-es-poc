import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventDeduplicationService } from './event-deduplication.service';
import { EventStoreService } from './event-store.service';
import { EventEntity } from './event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EventEntity]), CqrsModule],
  providers: [EventStoreService, EventDeduplicationService],
  exports: [EventStoreService, EventDeduplicationService],
})
export class EventsModule {}
