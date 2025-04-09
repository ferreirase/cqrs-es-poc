import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { ConfirmTransactionCommand } from '../../commands/impl/confirm-transaction.command';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

@CommandHandler(ConfirmTransactionCommand)
export class ConfirmTransactionHandler
  implements ICommandHandler<ConfirmTransactionCommand>
{
  constructor(
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private eventBus: EventBus,
  ) {}

  async execute(command: ConfirmTransactionCommand): Promise<void> {
    const { transactionId, sourceAccountId, destinationAccountId, amount } =
      command;

    this.loggingService.info(
      `[ConfirmTransactionHandler] Confirming transaction: ${transactionId}`,
    );

    try {
      // Carregar o agregado de transação
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        throw new NotFoundException(
          `Transaction with ID "${transactionId}" not found`,
        );
      }

      // Confirmar a transação no agregado (via evento)
      transactionAggregate.confirmTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        true,
      );

      // Aplicar e publicar os eventos
      await this.transactionAggregateRepository.save(transactionAggregate);

      this.loggingService.info(
        `[ConfirmTransactionHandler] Successfully confirmed transaction ${transactionId}`,
      );
    } catch (error) {
      this.loggingService.error(
        `[ConfirmTransactionHandler] Error confirming transaction: ${error.message}`,
      );

      // Tentar carregar o agregado de transação
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Atualizar o status da transação no agregado (via evento de falha)
          transactionAggregate.confirmTransaction(
            transactionId,
            sourceAccountId,
            destinationAccountId,
            amount,
            false,
          );

          // Aplicar e publicar os eventos
          await this.transactionAggregateRepository.save(transactionAggregate);
        }
      } catch (aggError) {
        this.loggingService.error(
          `[ConfirmTransactionHandler] Error updating transaction aggregate: ${aggError.message}`,
        );
      }

      throw error;
    }
  }
}
