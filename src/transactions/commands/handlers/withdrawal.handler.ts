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
        { transactionId, sourceAccountId, destinationAccountId, amount },
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

      // Salvar o agregado - IMPORTANTE: isso publica os eventos, incluindo TransactionCreatedEvent
      await this.transactionAggregateRepository.save(transactionAggregate);

      // Aguarde assincronamente para garantir que o evento foi processado
      await new Promise(resolve => setTimeout(resolve, 100));

      // Armazenar o contexto inicial da transação no TransactionContextService
      await this.transactionContextService.setInitialContext(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        TransactionType.WITHDRAWAL,
        description,
      );

      // Iniciar a saga verificando o saldo da conta
      await this.commandBus.execute(
        new CheckAccountBalanceCommand(transactionId, sourceAccountId, amount),
      );

      this.loggingService.info(
        `[WithdrawalHandler] Withdrawal saga started for transaction ${transactionId}`,
      );

      return;
    } catch (error) {
      this.loggingService.error(
        `[WithdrawalHandler] Error starting withdrawal saga: ${error.message}`,
        { error: error.message, stack: error.stack },
      );

      throw error;
    }
  }
}
