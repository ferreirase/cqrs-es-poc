import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { UserEntity } from '../../../users/models/user.entity';
import { NotifyUserCommand } from '../../commands/impl/notify-user.command';
import { UserNotifiedEvent } from '../../events/impl/user-notified.event';
import {
  NotificationStatus,
  NotificationType,
} from '../../models/notification.enum';

@CommandHandler(NotifyUserCommand)
export class NotifyUserHandler implements ICommandHandler<NotifyUserCommand> {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private rabbitMQService: RabbitMQService,
  ) {}

  async execute(command: NotifyUserCommand): Promise<void> {
    const { userId, transactionId, accountId, amount, type, status } = command;

    this.loggingService.info(
      `[NotifyUserHandler] Notifying user ${userId} about transaction ${transactionId}, type: ${type}, status: ${status}`,
    );

    try {
      // Buscar o usuário
      const user = await this.userRepository.findOne({
        where: { id: userId },
      });

      if (!user) {
        throw new Error(`User with ID "${userId}" not found`);
      }

      // Preparar a mensagem de notificação
      const notificationMessage = this.buildNotificationMessage(
        user.name,
        type,
        status,
        amount,
      );

      // Em um sistema real, aqui enviaríamos um email, SMS, push notification, etc.
      // Para este exemplo, apenas publicamos em um tópico RabbitMQ e registramos nos logs

      // Publicar mensagem no RabbitMQ
      this.rabbitMQService.publish(
        'notifications',
        `user.notification.${type.toLowerCase()}`,
        {
          userId,
          email: user.email,
          transactionId,
          accountId,
          amount,
          type,
          status,
          message: notificationMessage,
          timestamp: new Date(),
        },
      );

      this.loggingService.info(
        `[NotifyUserHandler] Notification sent to user ${userId}: ${notificationMessage}`,
      );

      // Publicar evento indicando que a notificação foi enviada com sucesso
      this.eventBus.publish(
        new UserNotifiedEvent(
          userId,
          transactionId,
          accountId,
          amount,
          type,
          true,
        ),
      );
    } catch (error) {
      this.loggingService.error(
        `[NotifyUserHandler] Error notifying user: ${error.message}`,
      );

      // Publicar evento indicando falha no envio da notificação
      this.eventBus.publish(
        new UserNotifiedEvent(
          userId,
          transactionId,
          accountId,
          amount,
          type,
          false,
        ),
      );

      // Neste caso, não relançamos o erro, pois a notificação é considerada não crítica
      // Uma falha aqui não deve impedir o fluxo principal da transação
    }
  }

  private buildNotificationMessage(
    userName: string,
    type: NotificationType,
    status: NotificationStatus,
    amount: number,
  ): string {
    if (status === NotificationStatus.FAILED) {
      return `Olá, ${userName}. Sua transação de ${
        type === NotificationType.WITHDRAWAL ? 'saque' : 'depósito'
      } no valor de R$ ${amount.toFixed(2)} falhou.`;
    }

    if (type === NotificationType.WITHDRAWAL) {
      return `Olá, ${userName}. Um saque de R$ ${amount.toFixed(
        2,
      )} foi realizado com sucesso em sua conta.`;
    } else {
      return `Olá, ${userName}. Um depósito de R$ ${amount.toFixed(
        2,
      )} foi realizado com sucesso em sua conta.`;
    }
  }
}
