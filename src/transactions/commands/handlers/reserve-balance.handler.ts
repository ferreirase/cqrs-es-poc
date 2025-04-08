import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { ReserveBalanceCommand } from '../../commands/impl/reserve-balance.command';
import { BalanceReservedEvent } from '../../events/impl/balance-reserved.event';
import {
  TransactionEntity,
  TransactionStatus,
  TransactionType,
} from '../../models/transaction.entity';

@CommandHandler(ReserveBalanceCommand)
export class ReserveBalanceHandler
  implements ICommandHandler<ReserveBalanceCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
  ) {}

  async execute(command: ReserveBalanceCommand): Promise<void> {
    const { transactionId, accountId, amount } = command;

    this.loggingService.info(
      `[ReserveBalanceHandler] Reserving balance for account ${accountId}, amount: ${amount}`,
    );

    const queryRunner =
      this.accountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Bloquear a linha da conta para garantir exclusividade
      const account = await queryRunner.manager
        .getRepository(AccountEntity)
        .findOne({
          where: { id: accountId },
          lock: { mode: 'pessimistic_write' },
        });

      if (!account) {
        throw new NotFoundException(`Account with ID "${accountId}" not found`);
      }

      // Verificar saldo novamente (garantia adicional)
      if (account.balance < amount) {
        throw new Error(`Insufficient balance in account ${accountId}`);
      }

      // Registrar a reserva na tabela de transações
      const transaction = await queryRunner.manager
        .getRepository(TransactionEntity)
        .findOne({
          where: { id: transactionId },
        });

      if (transaction) {
        transaction.status = TransactionStatus.RESERVED;
        transaction.updatedAt = new Date();
        await queryRunner.manager.save(transaction);
      } else {
        // Criar uma nova transação se não existir
        const newTransaction = this.transactionRepository.create({
          id: transactionId,
          sourceAccountId: accountId,
          amount: amount,
          status: TransactionStatus.RESERVED,
          type: TransactionType.WITHDRAWAL,
          createdAt: new Date(),
        });
        await queryRunner.manager.save(newTransaction);
      }

      // Commit da transação
      await queryRunner.commitTransaction();

      // Publicar evento indicando que o saldo foi reservado com sucesso
      this.eventBus.publish(
        new BalanceReservedEvent(transactionId, accountId, amount, true),
      );

      this.loggingService.info(
        `[ReserveBalanceHandler] Successfully reserved balance for account ${accountId}`,
      );
    } catch (error) {
      // Em caso de erro, fazer rollback da transação
      await queryRunner.rollbackTransaction();

      this.loggingService.error(
        `[ReserveBalanceHandler] Error reserving balance: ${error.message}`,
      );

      // Publicar evento indicando falha na reserva do saldo
      this.eventBus.publish(
        new BalanceReservedEvent(transactionId, accountId, amount, false),
      );

      throw error;
    } finally {
      // Liberar o queryRunner independente do resultado
      await queryRunner.release();
    }
  }
}
