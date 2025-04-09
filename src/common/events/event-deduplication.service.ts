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
  private processingIntent: Map<string, number> = new Map(); // Cache para intenção de processamento
  private readonly MAX_EVENTS = 10000; // Máximo de eventos para manter em memória
  private readonly TIME_WINDOW_MS = 60000; // Janela de tempo para considerar um evento como duplicado (1 minuto)
  private readonly INTENT_EXPIRY_MS = 5000; // Tempo curto para expirar a intenção

  constructor() {
    // Iniciar limpeza periódica de eventos antigos
    setInterval(() => this.cleanupOldEvents(), 60000);
    setInterval(() => this.cleanupOldIntents(), this.INTENT_EXPIRY_MS); // Limpar intenções expiradas
  }

  /**
   * Gera uma chave única para o evento (tornando público)
   */
  generateEventKey(
    eventType: string,
    entityId: string,
    additionalData?: string,
  ): string {
    const key = `${eventType}:${entityId}${
      additionalData ? `:${additionalData}` : ''
    }`;
    return key;
  }

  /**
   * Verifica se um evento é duplicado ou se já há uma intenção de processá-lo
   */
  isDuplicateOrProcessing(
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
    this.logger.debug(`[isDuplicateOrProcessing] Checking key: ${uniqueKey}`);

    // 1. Verificar intenção de processamento recente
    const intentTimestamp = this.processingIntent.get(uniqueKey);
    if (intentTimestamp && now - intentTimestamp < this.INTENT_EXPIRY_MS) {
      this.logger.warn(
        `[isDuplicateOrProcessing] PROCESSING INTENT already exists for key: ${uniqueKey}. Treating as duplicate.`,
      );
      return true; // Já está sendo processado (ou intenção recente)
    }

    // 2. Verificar evento processado recentemente
    const existingEvent = this.recentEvents.get(uniqueKey);
    if (existingEvent) {
      const timeDiff = now - existingEvent.timestamp;
      if (timeDiff < this.TIME_WINDOW_MS) {
        this.logger.warn(
          `[isDuplicateOrProcessing] DUPLICATE DETECTED (recently processed) for key: ${uniqueKey}`,
          { timeSinceLast: `${timeDiff}ms` },
        );
        return true;
      }
    }

    // 3. Registrar intenção de processamento AGORA para reduzir race condition
    this.logger.debug(
      `[isDuplicateOrProcessing] Registering PROCESSING INTENT for key: ${uniqueKey}`,
    );
    this.processingIntent.set(uniqueKey, now);

    this.logger.debug(
      `[isDuplicateOrProcessing] No duplicate or active intent found for key: ${uniqueKey}. Proceeding.`,
    );
    return false;
  }

  /**
   * Registra um evento como processado e remove a intenção
   */
  registerEventAsProcessed(
    uniqueKey: string,
    entityId: string,
    eventType: string,
  ): void {
    const now = Date.now();
    // Remover intenção
    this.processingIntent.delete(uniqueKey);

    // Adicionar ao cache de eventos processados
    this.recentEvents.set(uniqueKey, {
      id: entityId,
      type: eventType,
      timestamp: now,
    });
    this.logger.debug(
      `[registerEventAsProcessed] REGISTERED event as processed`,
      { key: uniqueKey },
    );

    if (this.recentEvents.size > this.MAX_EVENTS) {
      this.logger.warn(
        `Max deduplication cache size (${this.MAX_EVENTS}) reached. Forcing cleanup.`,
      );
      this.cleanupOldEvents();
    }
  }

  /**
   * Remove a intenção de processamento caso o evento falhe antes de ser registrado
   */
  clearProcessingIntent(uniqueKey: string): void {
    if (this.processingIntent.delete(uniqueKey)) {
      this.logger.debug(`[clearProcessingIntent] Cleared processing intent`, {
        key: uniqueKey,
      });
    }
  }

  /**
   * Limpa eventos antigos do cache
   */
  private cleanupOldEvents(): void {
    const now = Date.now();
    let deletedCount = 0;
    this.recentEvents.forEach((event, key) => {
      if (now - event.timestamp > this.TIME_WINDOW_MS) {
        this.recentEvents.delete(key);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      this.logger.debug(
        `Cleaned up ${deletedCount} old events from deduplication cache. Size now: ${this.recentEvents.size}`,
      );
    }
  }

  private cleanupOldIntents(): void {
    const now = Date.now();
    let deletedCount = 0;
    this.processingIntent.forEach((timestamp, key) => {
      if (now - timestamp > this.INTENT_EXPIRY_MS) {
        this.processingIntent.delete(key);
        deletedCount++;
      }
    });
    if (deletedCount > 0) {
      this.logger.debug(
        `Cleaned up ${deletedCount} expired processing intents.`,
      );
    }
  }

  // Deprecated: Use registerEventAsProcessed
  /*
  registerEvent(uniqueKey: string, entityId: string, eventType: string): void {
    const now = Date.now();
    this.recentEvents.set(uniqueKey, {
      id: entityId,
      type: eventType,
      timestamp: now,
    });
    this.logger.debug(`REGISTERED event in deduplication cache`, { key: uniqueKey });

    if (this.recentEvents.size > this.MAX_EVENTS) {
      this.logger.warn(`Max deduplication cache size (${this.MAX_EVENTS}) reached. Forcing cleanup.`)
      this.cleanupOldEvents();
    }
  }
  */
}
