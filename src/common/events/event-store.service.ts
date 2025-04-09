import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AccountBalanceUpdatedEvent } from '../../accounts/events/impl/account-balance-updated.event';
import { BalanceCheckedEvent } from '../../transactions/events/impl/balance-checked.event';
import { BalanceReleasedEvent } from '../../transactions/events/impl/balance-released.event';
import { BalanceReservedEvent } from '../../transactions/events/impl/balance-reserved.event';
import { StatementUpdatedEvent } from '../../transactions/events/impl/statement-updated.event';
import { TransactionConfirmedEvent } from '../../transactions/events/impl/transaction-confirmed.event';
import { TransactionCreatedEvent } from '../../transactions/events/impl/transaction-created.event';
import { TransactionProcessedEvent } from '../../transactions/events/impl/transaction-processed.event';
import { UserNotifiedEvent } from '../../transactions/events/impl/user-notified.event';
import { EventEntity } from './event.entity';
import { IEvent } from './event.interface';

// --- Definições do Strategy Pattern --- //
type HandledLocalEvents =
  | TransactionCreatedEvent
  | BalanceCheckedEvent
  | BalanceReservedEvent
  | TransactionProcessedEvent
  | TransactionConfirmedEvent
  | BalanceReleasedEvent
  | AccountBalanceUpdatedEvent
  | StatementUpdatedEvent
  | UserNotifiedEvent;

// Tipo para os detalhes extraídos do evento
type EventDetails = {
  aggregateId: string;
  routingKeyStyleType: string;
};

// Interface para a estratégia de tratamento de evento
interface EventHandlingStrategy<
  T extends HandledLocalEvents = HandledLocalEvents,
> {
  getEventDetails(event: T): EventDetails | null;
}

// --- Implementações das Estratégias --- //

class TransactionCreatedStrategy
  implements EventHandlingStrategy<TransactionCreatedEvent>
{
  getEventDetails(event: TransactionCreatedEvent): EventDetails {
    return {
      aggregateId: event.id,
      routingKeyStyleType: 'transaction.created',
    };
  }
}

class BalanceCheckedStrategy
  implements EventHandlingStrategy<BalanceCheckedEvent>
{
  getEventDetails(event: BalanceCheckedEvent): EventDetails {
    return {
      aggregateId: event.transactionId,
      routingKeyStyleType: 'balance.checked',
    };
  }
}

class BalanceReservedStrategy
  implements EventHandlingStrategy<BalanceReservedEvent>
{
  getEventDetails(event: BalanceReservedEvent): EventDetails {
    return {
      aggregateId: event.transactionId,
      routingKeyStyleType: 'balance.reserved',
    };
  }
}

class TransactionProcessedStrategy
  implements EventHandlingStrategy<TransactionProcessedEvent>
{
  getEventDetails(event: TransactionProcessedEvent): EventDetails {
    return {
      aggregateId: event.transactionId,
      routingKeyStyleType: 'transaction.processed',
    };
  }
}

class TransactionConfirmedStrategy
  implements EventHandlingStrategy<TransactionConfirmedEvent>
{
  getEventDetails(event: TransactionConfirmedEvent): EventDetails {
    return {
      aggregateId: event.transactionId,
      routingKeyStyleType: 'transaction.confirmed',
    };
  }
}

class BalanceReleasedStrategy
  implements EventHandlingStrategy<BalanceReleasedEvent>
{
  getEventDetails(event: BalanceReleasedEvent): EventDetails {
    return {
      aggregateId: event.transactionId,
      routingKeyStyleType: 'balance.released',
    };
  }
}

class AccountBalanceUpdatedStrategy
  implements EventHandlingStrategy<AccountBalanceUpdatedEvent>
{
  getEventDetails(event: AccountBalanceUpdatedEvent): EventDetails {
    return {
      aggregateId: event.accountId,
      routingKeyStyleType: 'account.balance.updated',
    };
  }
}

class StatementUpdatedStrategy
  implements EventHandlingStrategy<StatementUpdatedEvent>
{
  getEventDetails(event: StatementUpdatedEvent): EventDetails {
    return {
      aggregateId: event.transactionId,
      routingKeyStyleType: 'statement.updated',
    };
  }
}

class UserNotifiedStrategy implements EventHandlingStrategy<UserNotifiedEvent> {
  getEventDetails(event: UserNotifiedEvent): EventDetails {
    return {
      aggregateId: event.transactionId,
      routingKeyStyleType: 'user.notified',
    };
  }
}

@Injectable()
@EventsHandler(
  TransactionCreatedEvent,
  BalanceCheckedEvent,
  BalanceReservedEvent,
  TransactionProcessedEvent,
  TransactionConfirmedEvent,
  BalanceReleasedEvent,
  AccountBalanceUpdatedEvent,
  StatementUpdatedEvent,
  UserNotifiedEvent,
)
export class EventStoreService
  implements OnModuleInit, IEventHandler<HandledLocalEvents>
{
  private readonly logger = new Logger(EventStoreService.name);
  private readonly strategyMap: Map<Function, EventHandlingStrategy>;

  constructor(
    @InjectRepository(EventEntity)
    private eventRepository: Repository<EventEntity>,
  ) {
    // Inicializa o mapa de estratégias
    this.strategyMap = new Map<Function, EventHandlingStrategy>([
      [TransactionCreatedEvent, new TransactionCreatedStrategy()],
      [BalanceCheckedEvent, new BalanceCheckedStrategy()],
      [BalanceReservedEvent, new BalanceReservedStrategy()],
      [TransactionProcessedEvent, new TransactionProcessedStrategy()],
      [TransactionConfirmedEvent, new TransactionConfirmedStrategy()],
      [BalanceReleasedEvent, new BalanceReleasedStrategy()],
      [AccountBalanceUpdatedEvent, new AccountBalanceUpdatedStrategy()],
      [StatementUpdatedEvent, new StatementUpdatedStrategy()],
      [UserNotifiedEvent, new UserNotifiedStrategy()],
    ]);
  }

  async onModuleInit() {
    this.logger.log(
      'EventStoreService initialized and listening to local EventBus events',
    );
  }

  async handle(event: HandledLocalEvents) {
    const eventType = event.constructor.name;
    const eventConstructor = event.constructor;
    this.logger.debug(
      `[EventStoreService] Handling local event via EventBus: ${eventType}`,
      eventConstructor.name,
    );

    let eventDetails: EventDetails | null = null;
    let aggregateId: string | null = null;
    let routingKeyStyleType: string = '';

    // Encontrar a estratégia apropriada no mapa
    const strategy = this.strategyMap.get(eventConstructor);

    if (strategy) {
      // Executar a estratégia para obter os detalhes
      eventDetails = strategy.getEventDetails(event);
    } else {
      // Lógica de fallback para eventos não mapeados (se necessário)
      this.logger.warn(
        `[EventStoreService] No strategy found for event type: ${eventType}. Using fallback logic.`,
      );
      aggregateId =
        (event as any).id ||
        (event as any).transactionId ||
        (event as any).accountId ||
        uuidv4();
      routingKeyStyleType = `unknown.${eventType.toLowerCase()}`;
    }

    // Se a estratégia retornou detalhes, use-os
    if (eventDetails) {
      aggregateId = eventDetails.aggregateId;
      routingKeyStyleType = eventDetails.routingKeyStyleType;
    }

    // Verificar se aggregateId foi determinado
    if (!aggregateId) {
      this.logger.error(
        `[EventStoreService] CRITICAL: Failed to determine aggregateId for event: ${eventType}. Event data: ${JSON.stringify(
          event,
        )}`,
      );
      return;
    }

    // Clonar os dados do evento para salvar (evita mutações inesperadas)
    const eventData = { ...event };

    try {
      // Chamar saveEvent
      await this.saveEvent(routingKeyStyleType, eventData, aggregateId);
      this.logger.debug(
        `[EventStoreService] Successfully saved local event ${routingKeyStyleType} for aggregate ${aggregateId} via EventBus handler`,
      );
    } catch (error) {
      this.logger.error(
        `[EventStoreService] Error saving local event ${routingKeyStyleType} for aggregate ${aggregateId} via EventBus handler: ${error.message}`,
        error.stack,
      );
    }
  }

  async saveEvent(
    eventType: string,
    data: any,
    aggregateId: string,
  ): Promise<IEvent> {
    const event: IEvent = {
      id: uuidv4(),
      type: eventType,
      timestamp: new Date(),
      data: data,
    };

    try {
      this.logger.debug(
        `[EventStoreService] Attempting to save event: ${eventType} for aggregate: ${aggregateId}`,
        event.id,
      );

      const eventEntity = this.eventRepository.create({
        id: event.id,
        type: eventType,
        timestamp: event.timestamp,
        data: JSON.stringify(data),
        aggregateId,
      });

      await this.eventRepository.save(eventEntity);

      this.logger.debug(
        `[EventStoreService] Successfully saved event: ${eventType} with ID: ${event.id} for aggregate ${aggregateId}`,
      );

      return event;
    } catch (error) {
      this.logger.error(
        `[EventStoreService] Error saving event ${eventType} for aggregate ${aggregateId} (ID: ${event.id}): ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getEventsByAggregateId(aggregateId: string): Promise<IEvent[]> {
    console.log(
      `[EventStoreService] Getting events for aggregate: ${aggregateId}`,
    );

    try {
      const events = await this.eventRepository.find({
        where: { aggregateId },
        order: { timestamp: 'ASC' },
      });

      console.log(
        `[EventStoreService] Found ${events.length} events for aggregate: ${aggregateId}`,
      );

      if (events.length === 0) {
        console.warn(
          `[EventStoreService] No events found for aggregate: ${aggregateId}`,
        );
      } else {
        console.log(
          `[EventStoreService] Event types found: ${events
            .map(e => e.type)
            .join(', ')}`,
        );
      }

      return events.map(event => {
        try {
          const parsedData = JSON.parse(event.data);
          return {
            id: event.id,
            type: event.type,
            timestamp: event.timestamp,
            data: parsedData,
          };
        } catch (error) {
          console.error(
            `[EventStoreService] Error parsing event data: ${error.message}`,
          );
          return {
            id: event.id,
            type: event.type,
            timestamp: event.timestamp,
            data: {},
          };
        }
      });
    } catch (error) {
      console.error(
        `[EventStoreService] Error retrieving events: ${error.message}`,
      );
      return [];
    }
  }
}
