import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { EventStoreService } from '../../common/events/event-store.service';
import { TransactionAggregate } from '../aggregates/transaction.aggregate';

@Injectable()
export class TransactionAggregateRepository {
  constructor(
    private readonly eventStore: EventStoreService,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Carrega um agregado de transação a partir do eventStore
   * Reconstrói o estado do agregado aplicando todos os eventos
   */
  async findById(id: string): Promise<TransactionAggregate> {
    // Adicionar logs detalhados
    console.log(
      `[TransactionAggregateRepository] Finding aggregate for ID: ${id}`,
    );

    // Buscar todos os eventos do agregado pelo ID
    const events = await this.eventStore.getEventsByAggregateId(id);

    console.log(
      `[TransactionAggregateRepository] Found ${events.length} events for aggregate ${id}`,
    );

    if (events.length === 0) {
      console.log(
        `[TransactionAggregateRepository] No events found for aggregate ${id}`,
      );
      return null;
    }

    // Criar uma nova instância do agregado
    const aggregate = new TransactionAggregate();

    // Ordenar eventos por timestamp
    const sortedEvents = events.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    console.log(
      `[TransactionAggregateRepository] Events for aggregate ${id}: ${JSON.stringify(
        sortedEvents.map(e => e.type),
      )}`,
    );

    // Aplicar todos os eventos para reconstruir o estado
    sortedEvents.forEach(event => {
      const eventType = event.type.split('.').pop(); // Extrair o tipo do evento do routingKey
      const eventName = this.getEventName(eventType);

      console.log(
        `[TransactionAggregateRepository] Processing event: ${event.type}, handler: ${eventName}`,
      );

      if (eventName) {
        // Converter dados do evento para o tipo correto
        const eventData = event.data;

        // Aplicar o evento ao agregado
        try {
          aggregate[eventName](eventData);
          console.log(
            `[TransactionAggregateRepository] Successfully applied event ${event.type}`,
          );
        } catch (error) {
          console.error(
            `[TransactionAggregateRepository] Error applying event ${event.type}: ${error.message}`,
          );
        }
      } else {
        console.warn(
          `[TransactionAggregateRepository] No handler found for event ${event.type}`,
        );
      }
    });

    return aggregate;
  }

  /**
   * Salva um agregado de transação no eventStore
   * Os eventos são persistidos automaticamente quando aplicados ao agregado
   */
  async save(aggregate: TransactionAggregate): Promise<void> {
    // Publique os eventos usando o aggregate.commit()
    aggregate.commit();

    // Adicione uma pequena espera para garantir que o EventBus processe o evento
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  /**
   * Mapeia o tipo de evento para o nome do método correspondente no agregado
   */
  private getEventName(eventType: string): string {
    console.log(
      `[TransactionAggregateRepository] Mapping event type: ${eventType}`,
    );

    const eventMap = {
      created: 'onTransactionCreatedEvent',
      processed: 'onTransactionProcessedEvent',
      reserved: 'onBalanceReservedEvent',
      released: 'onBalanceReleasedEvent',
      confirmed: 'onTransactionConfirmedEvent',
      checked: 'onBalanceCheckedEvent',
    };

    const handler = eventMap[eventType];
    console.log(
      `[TransactionAggregateRepository] Event type ${eventType} maps to handler: ${handler}`,
    );

    return handler;
  }
}
