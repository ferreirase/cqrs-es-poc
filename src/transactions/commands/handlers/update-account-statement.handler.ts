import { Injectable, NotFoundException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { AccountDocument } from '../../../accounts/models/account.schema';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { UserDocument } from '../../../users/models/user.schema';
import { StatementUpdatedEvent } from '../../events/impl/statement-updated.event';
import { TransactionEntity } from '../../models/transaction.entity';
import { TransactionAggregateRepository } from '../../repositories/transaction-aggregate.repository';
import { TransactionContextService } from '../../services/transaction-context.service';

interface UpdateStatementMessage {
  commandName: 'UpdateAccountStatementCommand';
  payload: {
    transactionId: string;
    accountId: string;
    amount: number;
    description: string | null;
    transactionTimestamp: Date;
    isSource: boolean;
  };
}

@Injectable()
export class UpdateAccountStatementHandler {
  constructor(
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
    @InjectModel(UserDocument.name)
    private userModel: Model<UserDocument>,
    @InjectRepository(TransactionEntity)
    private transactionEntityRepository: Repository<TransactionEntity>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
    private transactionAggregateRepository: TransactionAggregateRepository,
    private transactionContextService: TransactionContextService,
  ) {}

  async handleUpdateStatementCommand(
    msg: UpdateStatementMessage,
  ): Promise<void> {
    const handlerName = 'UpdateAccountStatementHandler';
    const startTime = Date.now();

    const queueMessage = JSON.parse(
      msg as unknown as string,
    ) as UpdateStatementMessage;

    const {
      transactionId,
      accountId,
      amount,
      description,
      transactionTimestamp,
      isSource,
    } = queueMessage.payload;
    const type = amount < 0 ? 'DEBIT' : 'CREDIT';

    this.loggingService.logHandlerStart(handlerName, {
      ...queueMessage.payload,
      type,
    });

    let success = false;
    let errorMsg: string | undefined = undefined;
    let transactionDetails: TransactionEntity | null = null;
    let sourceUserId: string | undefined = undefined;
    let destinationUserId: string | undefined = undefined;

    try {
      transactionDetails = await this.transactionEntityRepository.findOne({
        where: { id: transactionId },
      });

      if (!transactionDetails) {
        this.loggingService.warn(
          `[${handlerName}] Transaction details not found for ${transactionId} while updating statement for account ${accountId}. Event enrichment might be incomplete.`,
        );
      }

      if (transactionDetails) {
        try {
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
        } catch (userFetchError) {
          this.loggingService.warn(
            `[${handlerName}] Error fetching user IDs for ${transactionId}: ${userFetchError.message}`,
          );
        }
      }

      const account = await this.accountModel.findOne({ id: accountId });

      if (!account) {
        throw new NotFoundException(
          `Account with ID "${accountId}" not found in read model (AccountDocument)`,
        );
      }

      const statementEntry = {
        transactionId,
        amount,
        type,
        description: description || (type === 'DEBIT' ? 'Debit' : 'Credit'),
        balanceAfter: account.balance + amount,
        timestamp: transactionTimestamp || new Date(),
      };

      await this.accountModel.updateOne(
        { id: accountId },
        {
          $push: {
            statements: {
              $each: [statementEntry],
              $sort: { timestamp: -1 },
            },
          },
          $set: {
            balance: statementEntry.balanceAfter,
            updatedAt: new Date(),
          },
        },
      );

      success = true;
      this.loggingService.info(
        `[${handlerName}] Successfully updated statement for account ${accountId}`,
      );
    } catch (error) {
      success = false;
      errorMsg = error.message;
      this.loggingService.error(
        `[${handlerName}] Error updating account statement: ${errorMsg}`,
        {
          transactionId,
          accountId,
          amount,
          error: error.stack,
          payload: queueMessage.payload,
        },
      );
    }

    const event = new StatementUpdatedEvent(
      transactionId,
      accountId,
      amount,
      type,
      success,
      errorMsg,
      transactionDetails?.sourceAccountId,
      transactionDetails?.destinationAccountId,
      sourceUserId,
      destinationUserId,
      transactionDetails?.amount,
      transactionDetails?.description,
      isSource,
    );

    try {
      await this.eventBus.publish(event);
      const executionTime = (Date.now() - startTime) / 1000;
      if (success) {
        this.loggingService.logCommandSuccess(
          handlerName,
          { transactionId, accountId, amount, type },
          executionTime,
          { operation: 'statement_updated_event_published' },
        );
      } else {
        this.loggingService.logCommandError(
          handlerName,
          new Error(errorMsg || 'Statement update failed'),
          { transactionId, accountId, amount, type },
        );
      }
    } catch (publishError) {
      this.loggingService.error(
        `[${handlerName}] CRITICAL: Failed to publish StatementUpdatedEvent for ${transactionId}: ${publishError.message}`,
        { transactionId, error: publishError.stack },
      );
      if (!success) throw new Error(errorMsg);
      else throw publishError;
    }

    if (!success) {
      throw new Error(errorMsg);
    }

    this.loggingService.info(
      `[${handlerName}] Finished processing message for ${transactionId}/${accountId}.`,
    );
  }
}
