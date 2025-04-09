import { HttpException, HttpStatus } from '@nestjs/common';
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
import { UserCreatedEvent } from '../../events/impl/user-created.event';
import { UserEntity } from '../../models/user.entity';
import { CreateUserCommand } from '../impl/create-user.command';

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private prometheusService: PrometheusService,
  ) {}

  async execute(command: CreateUserCommand): Promise<UserEntity> {
    const commandName = 'CreateUserCommand';
    const startTime = Date.now();

    // Log início do comando
    this.loggingService.logHandlerStart(commandName, {
      name: command.name,
      email: command.email,
      document: command.document,
    });

    try {
      const { id, name, document, email } = command;
      const userId = id || uuidv4();

      const [userExists] = (await this.userRepository.query(
        // find user by document or email, only one row
        `SELECT * FROM users WHERE document = $1 OR email = $2 LIMIT 1`,
        [document, email],
      )) as UserEntity[];

      if (userExists) {
        throw new HttpException('User already exists', HttpStatus.BAD_REQUEST);
      }

      const user = this.userRepository.create({
        id: userId,
        name,
        document,
        email,
        createdAt: new Date(),
      });

      await this.userRepository.save(user);

      this.eventBus.publish(
        new UserCreatedEvent(user.id, user.name, user.document, user.email),
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
