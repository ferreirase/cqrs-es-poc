import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { ProcessTransactionCommand } from '../../commands/impl/process-transaction.command';
import { TransactionProcessedEvent } from '../../events/impl/transaction-processed.event';
import {
  TransactionEntity,
  TransactionStatus,
  TransactionType,
} from '../../models/transaction.entity';

@CommandHandler(ProcessTransactionCommand)
export class ProcessTransactionHandler
  implements ICommandHandler<ProcessTransactionCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
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

      // Atualizar saldo das contas
      sourceAccount.balance -= amount;
      sourceAccount.updatedAt = new Date();

      destinationAccount.balance += amount;
      destinationAccount.updatedAt = new Date();

      // Salvar as alterações nas contas
      await queryRunner.manager.save(sourceAccount);
      await queryRunner.manager.save(destinationAccount);

      // Atualizar status da transação
      const transaction = await queryRunner.manager
        .getRepository(TransactionEntity)
        .findOne({
          where: { id: transactionId },
        });

      if (transaction) {
        transaction.status = TransactionStatus.PROCESSED;
        transaction.destinationAccountId = destinationAccountId;
        transaction.description = description;
        transaction.updatedAt = new Date();
        await queryRunner.manager.save(transaction);
      } else {
        // Caso a transação não exista ainda (não deveria acontecer neste ponto)
        const newTransaction = this.transactionRepository.create({
          id: transactionId,
          sourceAccountId,
          destinationAccountId,
          amount,
          status: TransactionStatus.PROCESSED,
          type: TransactionType.WITHDRAWAL,
          description,
          createdAt: new Date(),
        });
        await queryRunner.manager.save(newTransaction);
      }

      // Commit da transação
      await queryRunner.commitTransaction();

      // Publicar evento indicando que a transação foi processada com sucesso
      this.eventBus.publish(
        new TransactionProcessedEvent(
          transactionId,
          sourceAccountId,
          destinationAccountId,
          amount,
          true,
          description,
          TransactionStatus.PROCESSED,
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

      // Publicar evento indicando falha no processamento
      this.eventBus.publish(
        new TransactionProcessedEvent(
          transactionId,
          sourceAccountId,
          destinationAccountId,
          amount,
          false,
          description,
          TransactionStatus.FAILED,
        ),
      );

      throw error;
    } finally {
      // Liberar o queryRunner independente do resultado
      await queryRunner.release();
    }
  }
}
