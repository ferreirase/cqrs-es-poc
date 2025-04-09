import { NotFoundException } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
import { UserUpdatedEvent } from '../../events/impl/user-updated.event';
import { UserEntity } from '../../models/user.entity';
import { UpdateUserCommand } from '../impl/update-user.command';

@CommandHandler(UpdateUserCommand)
export class UpdateUserHandler implements ICommandHandler<UpdateUserCommand> {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private prometheusService: PrometheusService,
  ) {}

  async execute(command: UpdateUserCommand): Promise<UserEntity> {
    const commandName = 'UpdateUserCommand';
    const startTime = Date.now();

    // Log início do comando
    this.loggingService.logHandlerStart(commandName, {
      id: command.id,
    });

    try {
      const { id, name, document, email } = command;

      const user = await this.userRepository.findOne({
        where: { id },
      });
      if (!user) {
        throw new NotFoundException(`User with ID "${id}" not found`);
      }

      // Update only provided fields
      if (name !== undefined) user.name = name;
      if (document !== undefined) user.document = document;
      if (email !== undefined) user.email = email;
      user.updatedAt = new Date();

      await this.userRepository.save(user);

      this.eventBus.publish(
        new UserUpdatedEvent(user.id, user.name, user.document, user.email),
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
        { id: user.id },
        executionTime,
      );

      return user;
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
