import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventStoreService } from '../../../common/events/event-store.service';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionCreatedEvent } from '../../events/impl/transaction-created.event';
import {
  TransactionEntity,
  TransactionType,
} from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';
import { TransactionContextService } from '../../services/transaction-context.service';

// Restaurar a interface original da mensagem completa
interface WithdrawalQueueMessage {
  commandName: 'WithdrawalCommand';
  payload: {
    id: string;
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    description: string;
  };
}

@Injectable()
export class WithdrawalHandler {
  constructor(
    private readonly rabbitmqService: RabbitMQService,
    private readonly loggingService: LoggingService,
    private readonly transactionContextService: TransactionContextService,
    private readonly transactionAggregateRepository: TransactionAggregateRepository,
    private readonly eventStore: EventStoreService,
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
  ) {}

  // Voltar a esperar a mensagem completa
  async consumeWithdrawalCommand(
    queueMessage: WithdrawalQueueMessage,
  ): Promise<void> {
    const handlerName = 'WithdrawalHandler';
    const startTime = Date.now();

    // Desestruturar o payload de dentro da mensagem recebida
    // Adicionar verificação robusta
    if (
      !queueMessage ||
      typeof queueMessage !== 'object' ||
      !queueMessage.payload ||
      typeof queueMessage.payload !== 'object'
    ) {
      this.loggingService.error(
        `[${handlerName}] Received invalid message structure. Missing or invalid payload.`,
        { queueMessage },
      );
      throw new Error(
        'Invalid message structure received by WithdrawalHandler',
      );
    }
    const { payload } = queueMessage;

    // Desestruturar do payload
    const { id, sourceAccountId, destinationAccountId, amount, description } =
      payload;

    // Verificar se o ID existe no payload
    if (!id) {
      this.loggingService.error(
        `[${handlerName}] Missing ID in message payload.`,
        { payload },
      );
      throw new Error('Missing transaction ID in withdrawal command payload');
    }
    const transactionId = id;

    this.loggingService.logHandlerStart(handlerName, {
      transactionId,
      payload: payload,
    });
    this.loggingService.info(
      `[${handlerName}] Received task for transaction ${transactionId}.`,
    );

    try {
      // 1. Criar e salvar o evento de criação PRIMEIRO
      this.loggingService.info(
        `[${handlerName}] Creating and saving TransactionCreatedEvent for ${transactionId}...`,
      );
      const creationEvent = new TransactionCreatedEvent(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );
      await this.eventStore.saveEvent(
        creationEvent.constructor.name,
        creationEvent,
        transactionId,
      );
      this.loggingService.info(
        `[${handlerName}] TransactionCreatedEvent saved for ${transactionId}.`,
      );

      // Aguardar a confirmação de que a transação foi criada
      let transactionCreated = false;
      let retries = 10; // 10 tentativas
      while (retries > 0) {
        const transaction = await this.transactionRepository.findOne({
          where: { id: transactionId },
        });

        if (transaction) {
          transactionCreated = true;
          this.loggingService.info(
            `[${handlerName}] Transaction ${transactionId} confirmed as created.`,
          );
          break;
        }

        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Aumentar para 1s
          this.loggingService.info(
            `[${handlerName}] Waiting for transaction ${transactionId} creation... (${retries} retries left)`,
          );
        }
      }

      if (!transactionCreated) {
        throw new Error(
          `Transaction ${transactionId} was not created after multiple retries`,
        );
      }

      // 2. Definir contexto inicial (ainda necessário para a Saga)
      this.loggingService.info(
        `[${handlerName}] Setting initial context for ${transactionId}...`,
      );
      await this.transactionContextService.setInitialContext(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );
      this.loggingService.info(
        `[${handlerName}] Initial context set for ${transactionId}.`,
      );

      // Aguardar um pequeno delay adicional para garantir consistência
      await new Promise(resolve => setTimeout(resolve, 500));

      // 3. Publicar próximo comando da saga
      const checkBalancePayload = {
        commandName: 'CheckAccountBalanceCommand',
        payload: {
          transactionId: transactionId,
          accountId: sourceAccountId,
          amount: amount,
        },
      };

      this.loggingService.info(
        `[${handlerName}] Publishing CheckAccountBalanceCommand for ${transactionId}...`,
      );
      await this.rabbitmqService.publishToExchange(
        'commands.check_balance',
        checkBalancePayload,
        { exchangeName: 'paymaker-exchange' },
      );
      this.loggingService.info(
        `[${handlerName}] CheckAccountBalanceCommand published for ${transactionId}.`,
      );

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId },
        executionTime,
        { status: 'CREATION_EVENT_SAVED_PUBLISHED_NEXT' },
      );
    } catch (error) {
      this.loggingService.logCommandError(handlerName, error, {
        messagePayload: payload, // Logar o payload original
        transactionId,
      });
      this.loggingService.error(
        `[${handlerName}] FULL ERROR STACK for ${transactionId}:`,
        error.stack,
      );
      throw error;
    }
  }
}
