import {
  CommandBus,
  CommandHandler,
  EventBus,
  ICommandHandler,
} from '@nestjs/cqrs';
import { v4 as uuidv4 } from 'uuid';
import { EventStoreService } from '../../../common/events/event-store.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { TransactionAggregate } from '../../aggregates/transaction.aggregate';
import { CheckAccountBalanceCommand } from '../../commands/impl/check-account-balance.command';
import { WithdrawalCommand } from '../../commands/impl/withdrawal.command';
import { TransactionCreatedEvent } from '../../events/impl/transaction-created.event';
import { TransactionType } from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';
import { TransactionContextService } from '../../services/transaction-context.service';

@CommandHandler(WithdrawalCommand)
export class WithdrawalHandler implements ICommandHandler<WithdrawalCommand> {
  constructor(
    private commandBus: CommandBus,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private eventStoreService: EventStoreService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private transactionContextService: TransactionContextService,
  ) {}

  async execute(command: WithdrawalCommand): Promise<void> {
    try {
      const { id, sourceAccountId, destinationAccountId, amount, description } =
        command;

      const transactionId = id || uuidv4();

      this.loggingService.info(
        `[WithdrawalHandler] Starting withdrawal saga for transaction: ${transactionId}`,
      );

      // Criar um novo agregado de transação
      const transactionAggregate = new TransactionAggregate();

      // Aplicar o evento de criação de transação ao agregado
      transactionAggregate.createTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      // MUDANÇA CRUCIAL 1: Criar instância do evento e persistir diretamente no EventStore
      const transactionCreatedEvent = new TransactionCreatedEvent(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      await this.eventStoreService.saveEvent(
        'transaction.created',
        transactionCreatedEvent,
        transactionId,
      );

      // MUDANÇA CRUCIAL 2: Verifique se o evento foi realmente salvo
      const events = await this.eventStoreService.getEventsByAggregateId(
        transactionId,
      );

      this.loggingService.info(
        `[WithdrawalHandler] Verificação de eventos salvos para ${transactionId}: ${events.length} eventos encontrados`,
      );

      if (events.length === 0) {
        throw new Error(
          `Falha ao persistir evento transaction.created para transação ${transactionId}`,
        );
      }

      // Salvar o agregado (o que publica os eventos)
      await this.transactionAggregateRepository.save(transactionAggregate);

      // MUDANÇA CRUCIAL 3: Aguarde assincronamente antes de continuar
      // (garantia adicional contra race conditions)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Iniciar a saga verificando o saldo da conta
      // Este é o primeiro passo da saga, que desencadeará todos os outros
      // MUDANÇA CRUCIAL 4: Use await para garantir que o comando seja processado
      // completamente antes de continuar
      await this.commandBus.execute(
        new CheckAccountBalanceCommand(transactionId, sourceAccountId, amount),
      );

      this.loggingService.info(
        `[WithdrawalHandler] Withdrawal saga started for transaction ${transactionId}`,
      );

      // Armazenar o contexto inicial da transação no TransactionContextService
      await this.transactionContextService.setInitialContext(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      return;
    } catch (error) {
      this.loggingService.error(
        `[WithdrawalHandler] Error starting withdrawal saga: ${error.message}`,
      );

      throw error;
    }
  }
}
