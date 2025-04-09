import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../../accounts/models/account.entity';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { ReserveBalanceCommand } from '../../commands/impl/reserve-balance.command';
import { BalanceReservedEvent } from '../../events/impl/balance-reserved.event';
import { TransactionStatus } from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';

@CommandHandler(ReserveBalanceCommand)
export class ReserveBalanceHandler
  implements ICommandHandler<ReserveBalanceCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private rabbitMQService: RabbitMQService,
    private eventBus: EventBus,
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

      // Carregar o agregado de transação
      const transactionAggregate =
        await this.transactionAggregateRepository.findById(transactionId);

      // Se o agregado não for encontrado, é um erro real no fluxo, pois deveria existir
      if (!transactionAggregate) {
        this.loggingService.error(
          `[ReserveBalanceHandler] CRITICAL: Transaction aggregate not found for ID: ${transactionId}. This indicates an issue in the event flow or persistence. The 'transaction.created' event might not have been processed or saved correctly.`,
        );
        // Lançar um erro claro indicando que o agregado não existe quando deveria.
        throw new NotFoundException(
          `Transaction aggregate with ID "${transactionId}" not found. Cannot reserve balance.`,
        );
      }

      // Atualizar o status da transação no agregado (via evento)
      transactionAggregate.reserveBalance(
        transactionId,
        accountId,
        amount,
        true, // Assumindo sucesso aqui, pois o agregado foi encontrado
      );

      // Aplicar e publicar os eventos
      await this.transactionAggregateRepository.save(transactionAggregate);

      // Commit da transação
      await queryRunner.commitTransaction();

      // Criar o evento de BalanceReserved
      const balanceReservedEvent = new BalanceReservedEvent(
        transactionId,
        accountId,
        amount,
        true,
      );

      // Publicar no EventBus do NestJS (para o Saga)
      this.eventBus.publish(balanceReservedEvent);

      // Publicar no RabbitMQ
      this.rabbitMQService.publish('events', 'balance.reserved', {
        transactionId,
        accountId,
        amount,
        status: TransactionStatus.RESERVED,
        success: true,
        reservedAt: new Date(),
      });

      this.loggingService.info(
        `[ReserveBalanceHandler] Successfully reserved balance for account ${accountId}`,
      );
    } catch (error) {
      // Em caso de erro, fazer rollback da transação
      await queryRunner.rollbackTransaction();

      this.loggingService.error(
        `[ReserveBalanceHandler] Error reserving balance: ${error.message}`,
      );

      // Tentar carregar o agregado de transação
      try {
        const transactionAggregate =
          await this.transactionAggregateRepository.findById(transactionId);

        if (transactionAggregate) {
          // Atualizar o status da transação no agregado (via evento de falha)
          transactionAggregate.reserveBalance(
            transactionId,
            accountId,
            amount,
            false,
          );

          // Aplicar e publicar os eventos
          await this.transactionAggregateRepository.save(transactionAggregate);

          // Publicar o evento de falha no EventBus
          const balanceReservedEvent = new BalanceReservedEvent(
            transactionId,
            accountId,
            amount,
            false,
          );
          this.eventBus.publish(balanceReservedEvent);
        }
      } catch (aggError) {
        this.loggingService.error(
          `[ReserveBalanceHandler] Error updating transaction aggregate: ${aggError.message}`,
        );
      }

      throw error;
    } finally {
      // Liberar o queryRunner independente do resultado
      await queryRunner.release();
    }
  }
}
