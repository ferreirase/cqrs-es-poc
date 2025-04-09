import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
import { AccountCreatedEvent } from '../../events/impl/account-created.event';
import { AccountEntity } from '../../models/account.entity';
import { CreateAccountCommand } from '../impl/create-account.command';

@CommandHandler(CreateAccountCommand)
export class CreateAccountHandler
  implements ICommandHandler<CreateAccountCommand>
{
  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    private eventBus: EventBus,
    private rabbitMQService: RabbitMQService,
    private loggingService: LoggingService,
    private prometheusService: PrometheusService,
  ) {}

  async execute(command: CreateAccountCommand): Promise<AccountEntity> {
    const commandName = 'CreateAccountCommand';
    const startTime = Date.now();

    // Log início do comando
    this.loggingService.logHandlerStart(commandName, {
      owner: command.ownerId,
      initialBalance: command.initialBalance,
    });

    try {
      const { ownerId, initialBalance } = command;

      const account = this.accountRepository.create({
        id: uuidv4(),
        owner_id: ownerId,
        balance: initialBalance,
        createdAt: new Date(),
      });

      await this.accountRepository.save(account);

      this.eventBus.publish(
        new AccountCreatedEvent(account.id, ownerId, initialBalance),
      );

      // Registrar métricas de sucesso
      const executionTime = (Date.now() - startTime) / 1000;

      this.prometheusService
        .getCounter('commands_total')
        .inc({ command: commandName, status: 'success' }, 1);

      this.prometheusService
        .getHistogram('command_duration_seconds')
        .observe({ command: commandName }, executionTime);

      // Log sucesso
      this.loggingService.logCommandSuccess(
        commandName,
        { id: account.id },
        executionTime,
      );

      return account;
    } catch (error) {
      // Registrar métricas de erro
      this.prometheusService
        .getCounter('commands_total')
        .inc({ command: commandName, status: 'error' }, 1);

      // Log erro
      this.loggingService.logCommandError(commandName, error);

      throw error;
    }
  }
}
