import { Injectable } from '@nestjs/common';
import { EventBus, EventPublisher } from '@nestjs/cqrs';
import { EventStoreService } from '../../common/events/event-store.service';
import { LoggingService } from '../../common/monitoring/logging.service';
import { TransactionAggregate } from '../aggregates/transaction.aggregate';

@Injectable()
export class TransactionAggregateRepository {
  constructor(
    private readonly eventStore: EventStoreService,
    private readonly eventBus: EventBus,
    private readonly publisher: EventPublisher,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Carrega um agregado de transação a partir do eventStore
   * Reconstrói o estado do agregado aplicando todos os eventos
   */
  async findById(id: string): Promise<TransactionAggregate> {
    this.loggingService.info(
      `[TransactionAggregateRepository] Finding aggregate for ID: ${id}`,
    );

    // Buscar todos os eventos do agregado pelo ID
    const events = await this.eventStore.getEventsByAggregateId(id);

    this.loggingService.info(
      `[TransactionAggregateRepository] Found ${events.length} events for aggregate ${id}`,
    );

    if (events.length === 0) {
      this.loggingService.warn(
        `[TransactionAggregateRepository] No events found for aggregate ${id}`,
      );
      return null;
    }

    // Criar uma nova instância do agregado
    const aggregate = new TransactionAggregate();

    // **Importante:** Conecta a instância ao EventBus para que os métodos 'on<EventName>' possam ser chamados durante a reconstrução
    // Embora o commit() não seja chamado aqui, isso garante consistência se apply() tiver efeitos colaterais dependentes do EventBus
    const connectedAggregate = this.publisher.mergeObjectContext(aggregate);

    // Ordenar eventos por timestamp
    const sortedEvents = events.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    this.loggingService.info(
      `[TransactionAggregateRepository] Applying ${sortedEvents.length} events to aggregate ${id}`,
      { eventTypes: sortedEvents.map(e => e.type) },
    );

    // Aplicar todos os eventos para reconstruir o estado
    // Usamos a instância conectada, embora a reconstrução geralmente não precise do bus
    sortedEvents.forEach(event => {
      const eventType = event.type.split('.').pop(); // Extrair o tipo do evento do routingKey
      const eventName = this.getEventName(eventType);

      this.loggingService.info(
        `[TransactionAggregateRepository] Processing event: ${event.type}, handler: ${eventName}`,
      );

      if (eventName && typeof connectedAggregate[eventName] === 'function') {
        // Converter dados do evento para o tipo correto
        const eventData = event.data;

        // Aplicar o evento ao agregado
        try {
          // Chama o método on<EventName> no agregado
          connectedAggregate[eventName](eventData);
          this.loggingService.info(
            `[TransactionAggregateRepository] Successfully applied event ${event.type} via handler ${eventName}`,
          );
        } catch (error) {
          this.loggingService.error(
            `[TransactionAggregateRepository] Error applying event ${event.type} via handler ${eventName}: ${error.message}`,
            { error, stackTrace: error.stack },
          );
        }
      } else {
        this.loggingService.warn(
          `[TransactionAggregateRepository] No handler method found on aggregate for event type ${event.type} (handler: ${eventName})`,
        );
      }
    });

    // Define o ID do agregado reconstruído
    // Isso é seguro pois a primeira evento (geralmente `created`) deve definir o ID
    if (sortedEvents.length > 0 && sortedEvents[0].data.id) {
      (connectedAggregate as any)._id = sortedEvents[0].data.id; // Acessando propriedade privada para definir o ID após reconstrução
    }

    this.loggingService.info(
      `[TransactionAggregateRepository] Aggregate ${id} reconstruction complete.`,
    );

    return connectedAggregate;
  }

  /**
   * Salva um agregado de transação no eventStore
   * Conecta o agregado ao EventBus para que commit() publique os eventos
   */
  async save(aggregate: TransactionAggregate): Promise<void> {
    this.loggingService.info(
      '[TransactionAggregateRepository] Saving aggregate and preparing to publish events',
      {
        aggregateId: aggregate.id,
        uncommittedEventsCount: aggregate.getUncommittedEvents().length,
      },
    );

    try {
      const aggregateId = aggregate.id;
      if (!aggregateId) {
        this.loggingService.error(
          '[TransactionAggregateRepository] Aggregate has no ID before save',
          { aggregate },
        );
        throw new Error('Aggregate must have an ID before saving.');
      }

      // **Passo Chave:** Conecta o agregado ao EventBus para que commit() possa publicar
      const aggregateToCommit = this.publisher.mergeObjectContext(aggregate);

      this.loggingService.info(
        `[TransactionAggregateRepository] Committing ${
          aggregateToCommit.getUncommittedEvents().length
        } events for aggregate ${aggregateId}`,
      );

      // Chama commit() na instância conectada - Isso publicará os eventos no EventBus
      aggregateToCommit.commit();

      // Aguardar um tempo para garantir que o EventBus processe os eventos e eles sejam salvos no EventStore
      // **Nota:** Este timeout ainda é uma solução temporária. Uma abordagem melhor seria usar sagas ou confirmações explícitas.
      await new Promise(resolve => setTimeout(resolve, 500)); // Reduzindo timeout, pois o problema principal era a publicação

      // Verificar se o agregado pode ser recarregado do EventStore
      this.loggingService.info(
        `[TransactionAggregateRepository] Verifying aggregate ${aggregateId} persistence by reloading...`,
      );
      const reloadedAggregate = await this.findById(aggregateId);

      if (!reloadedAggregate) {
        this.loggingService.error(
          '[TransactionAggregateRepository] Failed to reload aggregate from EventStore after commit and timeout',
          { aggregateId },
        );
        // Adicionando log para verificar eventos no EventStore diretamente
        try {
          const eventsDirect = await this.eventStore.getEventsByAggregateId(
            aggregateId,
          );
          this.loggingService.warn(
            `[TransactionAggregateRepository] Direct check found ${eventsDirect.length} events in EventStore for ${aggregateId}`,
          );
        } catch (e) {
          this.loggingService.error('Direct check failed', e);
        }

        throw new Error(
          `Aggregate ${aggregateId} could not be reloaded from EventStore after save/commit operation.`,
        );
      }

      this.loggingService.info(
        '[TransactionAggregateRepository] Aggregate successfully verified in EventStore after commit',
        { aggregateId },
      );
    } catch (error) {
      this.loggingService.error(
        '[TransactionAggregateRepository] Error during save/commit or verification',
        { aggregateId: aggregate.id, error: error.message, stack: error.stack },
      );
      throw error;
    }
  }

  /**
   * Mapeia o tipo de evento para o nome do método correspondente no agregado
   */
  private getEventName(eventType: string): string {
    this.loggingService.info(
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

    if (!handler) {
      this.loggingService.warn(
        `[TransactionAggregateRepository] No handler mapping found for event type ${eventType}`,
      );
    }

    return handler;
  }
}
