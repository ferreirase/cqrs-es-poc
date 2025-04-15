import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionStatus } from '../../models/transaction.schema';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

// Define the expected message structure from RabbitMQ
// Based on TransactionProcessedEvent payload used in saga
interface ConfirmTransactionMessage {
  commandName: 'ConfirmTransactionCommand';
  payload: {
    transactionId: string;
    sourceAccountId: string;
    destinationAccountId: string | null;
    amount: number;
    // Description might not be strictly needed for confirmation logic itself,
    // but could be fetched if required for the event.
    // For now, assume aggregate.confirmTransaction handles null description.
  };
}

@Injectable()
export class ConfirmTransactionHandler {
  constructor(
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private eventBus: EventBus,
  ) {}

  async handleConfirmTransactionCommand(
    msg: string, // Manter como string por enquanto devido ao JSON.parse
  ): Promise<void> {
    const handlerName = 'ConfirmTransactionHandler';
    const startTime = Date.now();

    let message: ConfirmTransactionMessage;
    try {
      message = JSON.parse(msg) as ConfirmTransactionMessage;
    } catch (parseError) {
      this.loggingService.error(
        `[${handlerName}] Falha ao parsear mensagem JSON. Descartando.`,
        { error: parseError.message, originalMessage: msg },
      );
      // Mensagem inválida, não podemos processar. Retornar para Ack.
      return;
    }

    const { transactionId, sourceAccountId, destinationAccountId, amount } =
      message.payload;

    // Verificar transactionId logo no início
    if (
      !transactionId ||
      typeof transactionId !== 'string' ||
      transactionId === 'undefined'
    ) {
      this.loggingService.error(
        `[${handlerName}] transactionId inválido ou ausente na mensagem. Descartando.`,
        { payload: message.payload },
      );
      return; // Ack mensagem inválida
    }

    this.loggingService.logHandlerStart(handlerName, {
      transactionId,
      ...message.payload,
    });

    try {
      // Carregar o agregado
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        this.loggingService.error(
          `[${handlerName}] Agregado ${transactionId} não encontrado. Pode ser um erro ou processamento atrasado. Descartando comando.`,
          { transactionId, ...message.payload },
        );
        // Considerar como sucesso para remover da fila, pois não podemos agir
        return;
      }

      // *** VERIFICAÇÃO DE IDEMPOTÊNCIA E ESTADO ***
      const currentStatus = transactionAggregate.status;
      if (
        currentStatus === TransactionStatus.CONFIRMED ||
        currentStatus === TransactionStatus.COMPLETED ||
        currentStatus === TransactionStatus.FAILED
      ) {
        this.loggingService.warn(
          `[${handlerName}] Transação ${transactionId} já está em estado final (${currentStatus}). Ignorando comando de confirmação duplicado ou atrasado.`,
          { transactionId, currentStatus },
        );
        // Considerar sucesso para Ack da mensagem
        return;
      }

      // Se chegou aqui, o estado é PENDING, RESERVED ou PROCESSED, podemos tentar confirmar
      // A validação interna do agregado (ex: só confirmar se PROCESSED) ainda se aplica
      this.loggingService.info(
        `[${handlerName}] Tentando confirmar transação ${transactionId} (estado atual: ${currentStatus})`,
        { transactionId },
      );

      // Aplicar o evento de confirmação
      transactionAggregate.confirmTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        null, // Description
        true, // Success
        undefined, // No error
      );

      // Salvar o agregado (persiste e publica evento)
      await this.transactionAggregateRepository.save(transactionAggregate);

      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.logCommandSuccess(
        handlerName,
        { transactionId, sourceAccountId, destinationAccountId, amount },
        executionTime,
        { operation: 'transaction_confirmed_event_published' },
      );
    } catch (error) {
      // Erro ao aplicar o evento (ex: validação de estado dentro do agregado falhou)
      // ou erro ao salvar.
      const executionTime = (Date.now() - startTime) / 1000;
      this.loggingService.error(
        `[${handlerName}] Erro ao confirmar transação ${transactionId}: ${error.message}`,
        { transactionId, ...message.payload, error: error.stack },
      );

      // Neste caso, lançar o erro para Nack, pois pode ser um problema transitório
      // ou indicar um erro real que precisa ser investigado.
      // Se a validação de estado do agregado falhou (ex: tentar confirmar de RESERVED),
      // isso resultará em Nack e potencial loop se a condição não mudar.
      // Idealmente, a saga deveria garantir que este comando só chegue no estado correto.
      throw error;
    }
  }
}
