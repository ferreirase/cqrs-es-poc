import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { AccountDocument } from '../../../accounts/models/account.schema';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { UserEntity } from '../../../users/models/user.entity';
import { UserDocument } from '../../../users/models/user.schema';
import { UserNotifiedEvent } from '../../events/impl/user-notified.event';
import {
  NotificationStatus,
  NotificationType,
} from '../../models/notification.enum';
import { TransactionEntity } from '../../models/transaction.entity';

interface NotifyUserMessage {
  commandName: 'NotifyUserCommand';
  payload: {
    transactionId: string;
    userId: string;
    accountId: string;
    notificationType: NotificationType;
    status: NotificationStatus;
    message: string;
    details: { transactionId: string; amount: number };
  };
}

@Injectable()
export class NotifyUserHandler {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(TransactionEntity)
    private transactionEntityRepository: Repository<TransactionEntity>,
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
    @InjectModel(UserDocument.name)
    private userModel: Model<UserDocument>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
  ) {}

  @RabbitSubscribe({
    exchange: 'paymaker-exchange',
    routingKey: 'commands.notify_user',
    queue: 'notify_user_commands_queue',
    queueOptions: {
      durable: true,
    },
  })
  async handleNotifyUserCommand(msg: NotifyUserMessage): Promise<void> {
    const handlerName = 'NotifyUserHandler';
    const startTime = Date.now();

    const queueMessage = JSON.parse(
      msg as unknown as string,
    ) as NotifyUserMessage;

    const {
      userId,
      transactionId,
      accountId,
      notificationType,
      status,
      message,
      details,
    } = queueMessage.payload;

    const amount = details.amount;

    this.loggingService.logHandlerStart(handlerName, {
      ...queueMessage.payload,
    });

    let notificationSuccess = false;
    let notificationError: string | undefined = undefined;
    let transactionDetails: TransactionEntity | null = null;
    let sourceUserId: string | undefined = undefined;
    let destinationUserId: string | undefined = undefined;

    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new Error(`User with ID "${userId}" not found for notification.`);
      }
      const userName = user.name || 'Cliente';

      try {
        transactionDetails = await this.transactionEntityRepository.findOne({
          where: { id: transactionId },
        });
        if (transactionDetails) {
          if (transactionDetails.sourceAccountId) {
            const sourceAcc = await this.accountModel.findOne({
              id: transactionDetails.sourceAccountId,
            });
            if (sourceAcc?.owner) sourceUserId = sourceAcc.owner;
          }
          if (transactionDetails.destinationAccountId) {
            const destAcc = await this.accountModel.findOne({
              id: transactionDetails.destinationAccountId,
            });
            if (destAcc?.owner) destinationUserId = destAcc.owner;
          }
        }
      } catch (fetchError) {
        this.loggingService.warn(
          `[${handlerName}] Error fetching transaction/user context for ${transactionId}: ${fetchError.message}`,
        );
      }

      const finalMessage =
        message ||
        this.buildNotificationMessage(
          userName,
          notificationType,
          status,
          amount,
        );

      this.loggingService.info(
        `[${handlerName}] Sending notification to user ${userId} (Email: ${user.email}): ${finalMessage}`,
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      notificationSuccess = true;
      this.loggingService.info(
        `[${handlerName}] Notification supposedly sent successfully for ${transactionId} to user ${userId}.`,
      );
    } catch (error) {
      notificationSuccess = false;
      notificationError = error.message;
      this.loggingService.error(
        `[${handlerName}] Error sending notification for ${transactionId} to user ${userId}: ${notificationError}`,
        {
          ...queueMessage.payload,
          error: error.stack,
        },
      );
    }

    const event = new UserNotifiedEvent(
      transactionId,
      userId,
      accountId,
      notificationType,
      status,
      notificationSuccess,
      notificationError,
      transactionDetails?.sourceAccountId,
      transactionDetails?.destinationAccountId,
      destinationUserId ||
        (accountId === transactionDetails?.destinationAccountId
          ? userId
          : undefined),
      amount,
      message,
    );

    try {
      await this.eventBus.publish(event);
      const executionTime = (Date.now() - startTime) / 1000;
      if (notificationSuccess) {
        this.loggingService.logCommandSuccess(
          handlerName,
          { transactionId, userId, notificationType, status },
          executionTime,
          { operation: 'user_notified_event_published' },
        );
      } else {
        this.loggingService.warn(
          `[${handlerName}] Failed to send notification (event published).`,
          { transactionId, userId, error: notificationError },
        );
      }
    } catch (publishError) {
      this.loggingService.error(
        `[${handlerName}] CRITICAL: Failed to publish UserNotifiedEvent for ${transactionId}: ${publishError.message}`,
        { transactionId, error: publishError.stack },
      );
    }
    this.loggingService.info(
      `[${handlerName}] Finished processing message for ${transactionId}/${userId}.`,
    );
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
      return `Olá, ${userName}. Uma operação de R$ ${amount.toFixed(
        2,
      )} foi realizada com sucesso em sua conta.`;
    }
  }
}
