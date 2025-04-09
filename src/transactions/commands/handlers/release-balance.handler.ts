import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { ReleaseBalanceCommand } from '../../commands/impl/release-balance.command';
import { BalanceReleasedEvent } from '../../events/impl/balance-released.event';
import {
  TransactionEntity,
  TransactionStatus,
} from '../../models/transaction.entity';

@CommandHandler(ReleaseBalanceCommand)
export class ReleaseBalanceHandler
  implements ICommandHandler<ReleaseBalanceCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private rabbitMQService: RabbitMQService,
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

      // Commit da transação
      await queryRunner.commitTransaction();

      // Publicar evento indicando que o saldo foi liberado com sucesso
      this.eventBus.publish(
        new BalanceReleasedEvent(transactionId, accountId, amount, true),
      );

      // Publicar no RabbitMQ
      this.rabbitMQService.publish('events', 'balance.released', {
        transactionId,
        accountId,
        amount,
        status: TransactionStatus.CANCELED,
        success: true,
        releasedAt: new Date(),
        previousStatus: transaction.status,
      });

      this.loggingService.info(
        `[ReleaseBalanceHandler] Successfully released balance for account ${accountId}`,
      );
    } catch (error) {
      // Em caso de erro, fazer rollback da transação
      await queryRunner.rollbackTransaction();

      this.loggingService.error(
        `[ReleaseBalanceHandler] Error releasing balance: ${error.message}`,
      );

      // Publicar evento indicando falha na liberação do saldo
      this.eventBus.publish(
        new BalanceReleasedEvent(transactionId, accountId, amount, false),
      );

      // Publicar no RabbitMQ
      this.rabbitMQService.publish('events', 'balance.released', {
        transactionId,
        accountId,
        amount,
        status: TransactionStatus.FAILED,
        success: false,
        error: error.message,
        releasedAt: new Date(),
      });

      throw error;
    } finally {
      // Liberar o queryRunner independente do resultado
      await queryRunner.release();
    }
  }
}
