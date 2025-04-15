import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs';
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
import { EventDeduplicationService } from './event-deduplication.service';
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
    private eventDeduplicationService: EventDeduplicationService,
    private eventBus: EventBus,
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
      throw error; // Re-throw para garantir que o erro seja propagado
    }
  }

  async saveEvent(
    type: string,
    data: any,
    aggregateId: string,
  ): Promise<EventEntity | null> {
    let duplicateCheckKey = '';
    let eventSpecificId = '';

    // Determinar a chave de deduplicação e ID específico
    if (data.constructor?.name === 'UserNotifiedEvent') {
      const additionalKey = `${data.userId}:${data.accountId}`;
      eventSpecificId = `User:${data.userId}, Acc:${data.accountId}`;
      duplicateCheckKey = this.eventDeduplicationService.generateEventKey(
        type,
        aggregateId,
        additionalKey,
      );
    } else if (data.constructor?.name === 'StatementUpdatedEvent') {
      const additionalKey = data.accountId;
      eventSpecificId = `Acc:${data.accountId}`;
      duplicateCheckKey = this.eventDeduplicationService.generateEventKey(
        type,
        aggregateId,
        additionalKey,
      );
    } else if (data.constructor?.name === 'AccountBalanceUpdatedEvent') {
      const additionalKey = data.accountId;
      eventSpecificId = `Acc:${data.accountId}`;
      duplicateCheckKey = this.eventDeduplicationService.generateEventKey(
        type,
        aggregateId,
        additionalKey,
      );
    } else {
      eventSpecificId = `Tx:${aggregateId}`;
      duplicateCheckKey = this.eventDeduplicationService.generateEventKey(
        type,
        aggregateId,
      );
    }

    // Verificar duplicidade ou intenção de processamento
    if (
      this.eventDeduplicationService.isDuplicateOrProcessing(
        type,
        aggregateId,
        // Passar additionalKey específico para os tipos relevantes
        data.constructor?.name === 'UserNotifiedEvent'
          ? `${data.userId}:${data.accountId}`
          : data.constructor?.name === 'StatementUpdatedEvent'
          ? data.accountId
          : data.constructor?.name === 'AccountBalanceUpdatedEvent'
          ? data.accountId
          : undefined, // Nenhum additionalKey para outros tipos
      )
    ) {
      // Log já é feito dentro de isDuplicateOrProcessing
      return null;
    }

    // Se não for duplicado nem estiver sendo processado, tentar salvar
    const event = new EventEntity();
    event.id = uuidv4();
    event.type = type;
    event.data = data;
    event.aggregateId = aggregateId;
    event.timestamp = new Date();

    try {
      const savedEvent = await this.eventRepository.save(event);
      // Registrar como processado com sucesso
      this.eventDeduplicationService.registerEventAsProcessed(
        duplicateCheckKey,
        aggregateId,
        type,
      );
      this.logger.debug(
        `[EventStoreService] Event ${type} SAVED for ${eventSpecificId} (DB ID: ${savedEvent.id})`,
        { eventKey: duplicateCheckKey },
      );

      // Publicar o evento no EventBus após salvá-lo
      this.eventBus.publish(data);

      return savedEvent;
    } catch (error) {
      // Limpar a intenção de processamento em caso de erro
      this.eventDeduplicationService.clearProcessingIntent(duplicateCheckKey);

      // Se o erro for de chave duplicada no banco
      if (error.code === '23505') {
        this.logger.warn(
          `[EventStoreService] Database unique constraint violation on save for event ${type}, ${eventSpecificId}. Key: ${duplicateCheckKey}`,
          { errorCode: error.code },
        );
        return null; // Tratar como duplicado
      }
      this.logger.error(
        `[EventStoreService] Error SAVING event ${type} for ${eventSpecificId}: ${error.message}`,
        { key: duplicateCheckKey, stack: error.stack },
      );
      throw error;
    }
  }

  async getEventsByAggregateId(aggregateId: string): Promise<IEvent[]> {
    this.logger.debug(
      `[EventStoreService] Getting events for aggregate: ${aggregateId}`,
    );

    try {
      const events = await this.eventRepository.find({
        where: { aggregateId },
        order: { timestamp: 'ASC' },
      });

      this.logger.debug(
        `[EventStoreService] Found ${events.length} events for aggregate: ${aggregateId}`,
      );

      if (events.length === 0) {
        this.logger.warn(
          `[EventStoreService] No events found for aggregate: ${aggregateId}`,
        );
      } else {
        this.logger.debug(
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
          this.logger.error(
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
      this.logger.error(
        `[EventStoreService] Error retrieving events: ${error.message}`,
      );
      return [];
    }
  }
}
