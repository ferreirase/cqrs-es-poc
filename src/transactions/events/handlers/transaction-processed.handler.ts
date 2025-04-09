import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RabbitMQService } from '../../../common/messaging/rabbitmq.service';
import {
  TransactionDocument,
  TransactionStatus,
} from '../../models/transaction.schema';
import { TransactionProcessedEvent } from '../impl/transaction-processed.event';

@EventsHandler(TransactionProcessedEvent)
export class TransactionProcessedHandler
  implements IEventHandler<TransactionProcessedEvent>
{
  constructor(
    @InjectModel('TransactionDocument')
    private transactionModel: Model<TransactionDocument>,
    private rabbitMQService: RabbitMQService,
  ) {
    console.log('TransactionProcessedHandler initialized');
  }

  async handle(event: TransactionProcessedEvent) {
    console.log(
      `[TransactionProcessedHandler] Handling event: ${JSON.stringify(event)}`,
    );

    const {
      transactionId,
      sourceAccountId,
      destinationAccountId,
      amount,
      status,
      type,
      description,
      error,
    } = event;

    try {
      // Primeiro, verificar se a transação existe
      const existingTransaction = await this.transactionModel.findOne({
        id: transactionId,
      });

      if (!existingTransaction) {
        console.log(`Transaction ${transactionId} not found, creating it`);
        // Se não existir, criar uma nova
        const newTransaction = await this.transactionModel.create({
          id: transactionId,
          sourceAccountId,
          destinationAccountId,
          amount,
          type,
          description,
          status: status as TransactionStatus,
          processedAt: new Date(),
          createdAt: new Date(),
          error: error,
        });

        // Publicar no RabbitMQ
        this.rabbitMQService.publish('events', 'transaction.processed', {
          id: transactionId,
          sourceAccountId,
          destinationAccountId,
          amount,
          type,
          status,
          processedAt: new Date(),
          error: error,
          success: !error,
        });

        console.log(
          `Transaction read model created: ${transactionId}`,
          newTransaction,
        );
        return;
      }

      // Se existir, atualizar
      const result = await this.transactionModel.findOneAndUpdate(
        { id: transactionId },
        {
          $set: {
            status: status as TransactionStatus,
            destinationAccountId,
            description,
            processedAt: new Date(),
            error: error,
          },
        },
        { new: true },
      );

      // Publicar no RabbitMQ
      this.rabbitMQService.publish('events', 'transaction.processed', {
        id: transactionId,
        sourceAccountId,
        destinationAccountId,
        amount,
        type,
        status,
        processedAt: new Date(),
        error: error,
        success: !error,
      });

      console.log(
        `Transaction read model updated: ${transactionId} with status ${status}`,
        result,
      );
    } catch (err) {
      console.error(`Error updating transaction: ${err.message}`);
      throw err;
    }
  }
}
