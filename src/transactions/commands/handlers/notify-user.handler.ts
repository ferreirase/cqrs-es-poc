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
import { TransactionStatus } from '../../models/transaction.schema';
import { TransactionContextService } from '../../services/transaction-context.service';

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
    private transactionContextService: TransactionContextService,
  ) {}

  async handleNotifyUserCommand(msg: any): Promise<void> {
    const handlerName = 'NotifyUserHandler';
    const startTime = Date.now();

    // Adicionando logs para depuração
    this.loggingService.info(
      `[${handlerName}] RAW MESSAGE RECEIVED: ${JSON.stringify(msg)}`,
      { type: typeof msg },
    );

    // Parse seguro: suporta tanto objeto quanto string
    let queueMessage;

    try {
      if (typeof msg === 'string') {
        queueMessage = JSON.parse(msg);
      } else if (msg && typeof msg === 'object') {
        if (typeof msg.content === 'object') {
          // Formato específico do RabbitMQ - @golevelup/nestjs-rabbitmq às vezes envia neste formato
          const content = msg.content ? msg.content.toString() : '{}';
          try {
            queueMessage = JSON.parse(content);
          } catch (e) {
            queueMessage = msg; // Fallback - usar o objeto original
          }
        } else {
          queueMessage = msg;
        }
      } else {
        throw new Error(`Unsupported message format: ${typeof msg}`);
      }
    } catch (error) {
      this.loggingService.error(
        `[${handlerName}] Failed to parse message: ${error.message}`,
        { originalMessage: JSON.stringify(msg) },
      );
      return; // Parar processamento em caso de erro de parsing
    }

    // Validação robusta da mensagem recebida
    if (!queueMessage || typeof queueMessage !== 'object') {
      this.loggingService.error(
        `[${handlerName}] Received invalid message format: ${typeof queueMessage}`,
        { receivedMessage: JSON.stringify(queueMessage) },
      );
      return;
    }

    // Verificar se a mensagem é válida
    if (!queueMessage.payload || typeof queueMessage.payload !== 'object') {
      this.loggingService.error(
        `[${handlerName}] Missing or invalid payload in message`,
        { receivedMessage: JSON.stringify(queueMessage) },
      );
      return;
    }

    // Log adicional para depuração
    this.loggingService.info(
      `[${handlerName}] PARSED MESSAGE: ${JSON.stringify(queueMessage)}`,
    );

    const {
      userId,
      transactionId,
      accountId,
      notificationType,
      status,
      message,
      details,
    } = queueMessage.payload;

    // Validar campos obrigatórios
    if (!userId || !transactionId || !accountId) {
      this.loggingService.error(
        `[${handlerName}] Missing required fields in payload`,
        {
          receivedPayload: JSON.stringify(queueMessage.payload),
          userId: userId || 'MISSING',
          transactionId: transactionId || 'MISSING',
          accountId: accountId || 'MISSING',
        },
      );
      return;
    }

    const amount = details?.amount;

    this.loggingService.logHandlerStart(handlerName, {
      ...queueMessage.payload,
    });

    // Verificar se já existe uma notificação para este usuário/transação
    // para evitar duplicação
    try {
      // Verificar em algum registro existente se a notificação já foi enviada
      // Aqui você pode adicionar uma verificação na sua tabela de notificações
      // ou em outro mecanismo de rastreamento para ver se essa
      // combinação específica de usuário/transação já foi notificada

      // Por simplicidade, vamos usar uma verificação básica aqui
      const existingTransaction =
        await this.transactionEntityRepository.findOne({
          where: { id: transactionId },
        });

      if (existingTransaction?.status === TransactionStatus.COMPLETED) {
        this.loggingService.info(
          `[${handlerName}] Transaction ${transactionId} is already COMPLETED, skipping notification for user ${userId}`,
        );
        return;
      }
    } catch (error) {
      this.loggingService.warn(
        `[${handlerName}] Error checking notification status: ${error.message}`,
        { error: error.stack },
      );
      // Continuar mesmo com erro na verificação
    }

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
    amount?: number,
  ): string {
    if (status === NotificationStatus.SUCCESS) {
      switch (type) {
        case NotificationType.WITHDRAWAL:
          return `Olá ${userName}, seu saque ${
            amount ? `de ${amount}` : ''
          } foi processado com sucesso.`;
        case NotificationType.DEPOSIT:
          return `Olá ${userName}, seu depósito ${
            amount ? `de ${amount}` : ''
          } foi processado com sucesso.`;
        default:
          return `Olá ${userName}, sua transação foi processada com sucesso.`;
      }
    } else {
      return `Olá ${userName}, ocorreu um erro ao processar sua transação.`;
    }
  }
}
