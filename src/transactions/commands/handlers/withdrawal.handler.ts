import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { CheckAccountBalanceCommand } from '../../commands/impl/check-account-balance.command';
import { WithdrawalCommand } from '../../commands/impl/withdrawal.command';
import {
  TransactionEntity,
  TransactionStatus,
  TransactionType,
} from '../../models/transaction.entity';

@CommandHandler(WithdrawalCommand)
export class WithdrawalHandler implements ICommandHandler<WithdrawalCommand> {
  constructor(
    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,
    private commandBus: CommandBus,
    private loggingService: LoggingService,
  ) {}

  async execute(command: WithdrawalCommand): Promise<void> {
    const { id, sourceAccountId, destinationAccountId, amount, description } =
      command;
    const transactionId = id || uuidv4();

    this.loggingService.info(
      `[WithdrawalHandler] Starting withdrawal saga for transaction: ${transactionId}`,
    );

    // Registrar o início da transação
    const transaction = this.transactionRepository.create({
      id: transactionId,
      sourceAccountId,
      destinationAccountId,
      amount,
      status: TransactionStatus.PENDING, // Use the enum from your entity
      type: TransactionType.WITHDRAWAL, // Use the enum from your entity
      description,
      createdAt: new Date(),
    });

    await this.transactionRepository.save(transaction);

    // Iniciar a saga verificando o saldo da conta
    // Este é o primeiro passo da saga, que desencadeará todos os outros
    await this.commandBus.execute(
      new CheckAccountBalanceCommand(transactionId, sourceAccountId, amount),
    );

    this.loggingService.info(
      `[WithdrawalHandler] Withdrawal saga started for transaction ${transactionId}`,
    );

    return;
  }
  catch(error) {
    this.loggingService.error(
      `[WithdrawalHandler] Error starting withdrawal saga: ${error.message}`,
    );
    throw error;
  }
}
