import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { EventDeduplicationService } from '../../../common/events/event-deduplication.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionEntity } from '../../models/transaction.entity';
import { TransactionDocument } from '../../models/transaction.schema';
import { UserNotifiedEvent } from '../impl/user-notified.event';

@EventsHandler(UserNotifiedEvent)
export class UserNotifiedHandler implements IEventHandler<UserNotifiedEvent> {
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private readonly loggingService: LoggingService,
    private readonly eventDeduplicationService: EventDeduplicationService,
  ) {}

  async handle(event: UserNotifiedEvent) {
    const handlerName = 'UserNotifiedHandler';
    // Verificar se este evento é duplicado
    if (
      this.eventDeduplicationService.isDuplicateOrProcessing(
        'UserNotifiedEvent',
        event.transactionId,
        `${event.userId}:${event.accountId}`,
      )
    ) {
      this.loggingService.warn(
        `[${handlerName}] Duplicate notification event detected. Skipping.`,
        {
          transactionId: event.transactionId,
          userId: event.userId,
          accountId: event.accountId,
        },
      );
      return;
    }

    this.loggingService.info(`[${handlerName}] Handling notification event.`, {
      transactionId: event.transactionId,
      userId: event.userId,
      accountId: event.accountId,
      success: event.success,
    });

    try {
      // Apenas log. Nenhuma outra ação deve ser tomada aqui para evitar loops.
      // Se precisar atualizar um modelo de leitura específico de notificações, pode ser feito aqui,
      // mas com cuidado para não disparar mais eventos/comandos.
      this.loggingService.info(
        `[${handlerName}] Logged notification event for transaction ${event.transactionId}, user ${event.userId}.`,
      );

      // Poderia atualizar um status de notificação em um modelo de leitura aqui, se necessário.
      // Exemplo: await this.notificationReadModel.updateOne(...);
    } catch (error) {
      this.loggingService.error(
        `[${handlerName}] Error processing notification event: ${error.message}`,
        { transactionId: event.transactionId, error: error.stack },
      );
      // Não relançar
    }
  }
}
