import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountBalanceUpdatedEvent } from '../../../accounts/events/impl/account-balance-updated.event';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { ProcessTransactionCommand } from '../../commands/impl/process-transaction.command';
import { TransactionType } from '../../models/transaction.entity';
import { TransactionStatus } from '../../models/transaction.schema';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

@CommandHandler(ProcessTransactionCommand)
export class ProcessTransactionHandler
  implements ICommandHandler<ProcessTransactionCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
  ) {}

  async execute(command: ProcessTransactionCommand): Promise<void> {
    const {
      transactionId,
      sourceAccountId,
      destinationAccountId,
      amount,
      description,
    } = command;

    this.loggingService.info(
      `[ProcessTransactionHandler] Processing transaction: ${transactionId}, from: ${sourceAccountId}, to: ${destinationAccountId}, amount: ${amount}`,
    );

    const queryRunner =
      this.accountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();

    await queryRunner.startTransaction();

    try {
      // Bloquear e verificar contas de origem e destino
      const sourceAccount = await queryRunner.manager
        .getRepository(AccountEntity)
        .findOne({
          where: { id: sourceAccountId },
          lock: { mode: 'pessimistic_write' },
        });

      if (!sourceAccount) {
        throw new NotFoundException(
          `Source account with ID "${sourceAccountId}" not found`,
        );
      }

      const destinationAccount = await queryRunner.manager
        .getRepository(AccountEntity)
        .findOne({
          where: { id: destinationAccountId },
          lock: { mode: 'pessimistic_write' },
        });

      if (!destinationAccount) {
        throw new NotFoundException(
          `Destination account with ID "${destinationAccountId}" not found`,
        );
      }

      // Verificar saldo da conta de origem novamente
      if (sourceAccount.balance < amount) {
        throw new Error(
          `Insufficient balance in source account ${sourceAccountId}`,
        );
      }

      // Armazenar saldos anteriores para os eventos
      const sourcePreviousBalance = sourceAccount.balance;
      const destPreviousBalance = destinationAccount.balance;

      // Atualizar saldo das contas
      sourceAccount.balance = Number(sourceAccount.balance) - Number(amount);
      sourceAccount.updatedAt = new Date();

      destinationAccount.balance =
        Number(destinationAccount.balance) + Number(amount);
      destinationAccount.updatedAt = new Date();

      // Salvar as alterações nas contas
      await queryRunner.manager.save(sourceAccount);
      await queryRunner.manager.save(destinationAccount);

      // Carregar o agregado de transação
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        throw new NotFoundException(
          `Transaction with ID "${transactionId}" not found`,
        );
      }

      // Processar a transação no agregado (via evento)
      transactionAggregate.processTransaction(
        transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        true,
        description,
        TransactionStatus.PROCESSED,
        TransactionType.WITHDRAWAL,
      );

      // Aplicar e publicar os eventos
      await this.transactionAggregateRepository.save(transactionAggregate);

      // Commit da transação
      await queryRunner.commitTransaction();

      // Publicar evento para atualizar o modelo de leitura da conta de origem
      this.eventBus.publish(
        new AccountBalanceUpdatedEvent(
          sourceAccountId,
          sourcePreviousBalance,
          sourceAccount.balance,
          -amount,
        ),
      );

      // Publicar evento para atualizar o modelo de leitura da conta de destino
      this.eventBus.publish(
        new AccountBalanceUpdatedEvent(
          destinationAccountId,
          destPreviousBalance,
          destinationAccount.balance,
          amount,
        ),
      );

      this.loggingService.info(
        `[ProcessTransactionHandler] Successfully processed transaction ${transactionId}`,
      );
    } catch (error) {
      // Em caso de erro, fazer rollback da transação
      await queryRunner.rollbackTransaction();

      this.loggingService.error(
        `[ProcessTransactionHandler] Error processing transaction: ${error.message}`,
      );

      // Tentar carregar o agregado de transação
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Atualizar o status da transação no agregado (via evento de falha)
          transactionAggregate.processTransaction(
            transactionId,
            sourceAccountId,
            destinationAccountId,
            amount,
            false,
            description,
            TransactionStatus.FAILED,
            TransactionType.WITHDRAWAL,
          );

          // Aplicar e publicar os eventos
          await this.transactionAggregateRepository.save(transactionAggregate);
        }
      } catch (aggError) {
        this.loggingService.error(
          `[ProcessTransactionHandler] Error updating transaction aggregate: ${aggError.message}`,
        );
      }

      throw error;
    } finally {
      // Liberar o queryRunner independente do resultado
      await queryRunner.release();
    }
  }
}
