import { Injectable, Logger } from '@nestjs/common';

interface ProcessedEvent {
  id: string;
  type: string;
  timestamp: number;
}

@Injectable()
export class EventDeduplicationService {
  private readonly logger = new Logger(EventDeduplicationService.name);
  private recentEvents: Map<string, ProcessedEvent> = new Map();
  private readonly MAX_EVENTS = 10000; // Máximo de eventos para manter em memória
  private readonly TIME_WINDOW_MS = 60000; // Janela de tempo para considerar um evento como duplicado (1 minuto)

  constructor() {
    // Iniciar limpeza periódica de eventos antigos
    setInterval(() => this.cleanupOldEvents(), 60000);
  }

  /**
   * Verifica se um evento foi processado recentemente
   * @param eventType Tipo do evento
   * @param entityId ID da entidade relacionada ao evento
   * @param additionalData Dados adicionais para identificação única do evento
   * @returns true se o evento for duplicado, false caso contrário
   */
  isDuplicate(
    eventType: string,
    entityId: string,
    additionalData?: string,
  ): boolean {
    const uniqueKey = this.generateEventKey(
      eventType,
      entityId,
      additionalData,
    );
    const now = Date.now();

    const existingEvent = this.recentEvents.get(uniqueKey);
    if (existingEvent && now - existingEvent.timestamp < this.TIME_WINDOW_MS) {
      this.logger.warn(
        `Detected duplicate event: ${eventType} for entity ${entityId}`,
        {
          uniqueKey,
          timeSinceLastProcess: now - existingEvent.timestamp,
          additionalData,
        },
      );
      return true;
    }

    // Registrar o evento como processado
    this.recentEvents.set(uniqueKey, {
      id: entityId,
      type: eventType,
      timestamp: now,
    });

    // Limitar o tamanho do cache se necessário
    if (this.recentEvents.size > this.MAX_EVENTS) {
      this.cleanupOldEvents();
    }

    return false;
  }

  /**
   * Limpa eventos antigos do cache
   */
  private cleanupOldEvents(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.recentEvents.forEach((event, key) => {
      if (now - event.timestamp > this.TIME_WINDOW_MS) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.recentEvents.delete(key));

    if (keysToDelete.length > 0) {
      this.logger.debug(
        `Cleaned up ${keysToDelete.length} old events from deduplication cache`,
      );
    }
  }

  /**
   * Gera uma chave única para o evento
   */
  private generateEventKey(
    eventType: string,
    entityId: string,
    additionalData?: string,
  ): string {
    return `${eventType}:${entityId}${
      additionalData ? `:${additionalData}` : ''
    }`;
  }
}
