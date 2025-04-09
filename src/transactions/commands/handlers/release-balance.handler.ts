import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { ReleaseBalanceCommand } from '../../commands/impl/release-balance.command';
import {
  TransactionEntity,
  TransactionStatus,
} from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

@CommandHandler(ReleaseBalanceCommand)
export class ReleaseBalanceHandler
  implements ICommandHandler<ReleaseBalanceCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
  ) {}

  async execute(command: ReleaseBalanceCommand): Promise<void> {
    const { transactionId, accountId, amount } = command;

    this.loggingService.info(
      `[ReleaseBalanceHandler] Releasing reserved balance for account ${accountId}, amount: ${amount}`,
    );

    const queryRunner =
      this.accountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Buscar a transação para verificar seu estado atual
      const transaction = await queryRunner.manager
        .getRepository(TransactionEntity)
        .findOne({
          where: { id: transactionId },
        });

      if (!transaction) {
        throw new NotFoundException(
          `Transaction with ID "${transactionId}" not found`,
        );
      }

      // Se a transação já estiver CONFIRMED, não é possível fazer o rollback
      if (transaction.status === TransactionStatus.CONFIRMED) {
        throw new Error(
          `Cannot release balance for confirmed transaction ${transactionId}`,
        );
      }

      // Buscar a conta para realizar a liberação do saldo reservado
      const account = await queryRunner.manager
        .getRepository(AccountEntity)
        .findOne({
          where: { id: accountId },
          lock: { mode: 'pessimistic_write' },
        });

      if (!account) {
        throw new NotFoundException(`Account with ID "${accountId}" not found`);
      }

      // Se o status da transação for PROCESSED, significa que já houve débito,
      // então precisamos restaurar o saldo
      if (transaction.status === TransactionStatus.PROCESSED) {
        account.balance += amount;
        account.updatedAt = new Date();
        await queryRunner.manager.save(account);
      }

      // Atualizar o status da transação para cancelled
      transaction.status = TransactionStatus.CANCELED;
      transaction.updatedAt = new Date();
      await queryRunner.manager.save(transaction);

      // Carregar o agregado de transação
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      if (!transactionAggregate) {
        throw new NotFoundException(
          `Transaction aggregate with ID "${transactionId}" not found`,
        );
      }

      // Atualizar o status da transação no agregado (via evento)
      transactionAggregate.releaseBalance(
        transactionId,
        accountId,
        amount,
        true,
      );

      // Aplicar e publicar os eventos
      await this.transactionAggregateRepository.save(transactionAggregate);

      // Commit da transação
      await queryRunner.commitTransaction();

      this.loggingService.info(
        `[ReleaseBalanceHandler] Successfully released balance for account ${accountId}`,
      );
    } catch (error) {
      // Em caso de erro, fazer rollback da transação
      await queryRunner.rollbackTransaction();

      this.loggingService.error(
        `[ReleaseBalanceHandler] Error releasing balance: ${error.message}`,
      );

      // Tentar carregar o agregado de transação
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Atualizar o status da transação no agregado (via evento de falha)
          transactionAggregate.releaseBalance(
            transactionId,
            accountId,
            amount,
            false,
          );

          // Aplicar e publicar os eventos
          await this.transactionAggregateRepository.save(transactionAggregate);
        }
      } catch (aggError) {
        this.loggingService.error(
          `[ReleaseBalanceHandler] Error updating transaction aggregate: ${aggError.message}`,
        );
      }

      throw error;
    } finally {
      // Liberar o queryRunner independente do resultado
      await queryRunner.release();
    }
  }
}
