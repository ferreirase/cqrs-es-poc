import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { ConsumeMessage } from 'amqplib';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { AccountEntity } from '../../accounts/models/account.entity';
import { AccountDocument } from '../../accounts/models/account.schema';
import { TransactionEntity } from '../../transactions/models/transaction.entity';
import { TransactionDocument } from '../../transactions/models/transaction.schema';
import { RabbitMQService } from '../messaging/rabbitmq.service';

@Injectable()
export class DataSyncService implements OnModuleInit {
  private readonly logger = new Logger(DataSyncService.name);

  constructor(
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,

    @InjectRepository(TransactionEntity)
    private transactionRepository: Repository<TransactionEntity>,

    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,

    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,

    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async onModuleInit() {
    // Setup queue and bind it to the exchange with appropriate routing keys
    await this.rabbitMQService.createQueueAndBind(
      'transaction_events',
      ['transaction.created', 'transaction.updated', 'transaction.processed'],
      { durable: true },
    );

    // Subscribe to the queue
    await this.rabbitMQService.subscribe<any>(
      'transaction_events',
      this.handleTransactionEvent.bind(this),
    );

    this.logger.log('Subscribed to transaction events queue');
  }

  public async handleTransactionEvent(_: any, amqpMsg: ConsumeMessage) {
    this.logger.debug('Received transaction event', {
      routingKey: amqpMsg.fields.routingKey,
    });

    try {
      // Handle different event types based on routing key
      switch (amqpMsg.fields.routingKey) {
        case 'transaction.created':
          this.logger.debug('Syncing new transaction...');
          break;
        case 'transaction.updated':
          this.logger.debug('Syncing updated transaction...');
          break;
        case 'transaction.processed':
          this.logger.debug('Syncing processed transaction...');
          break;
      }

      // Sync transactions after processing event
      await this.syncTransactions();
    } catch (error) {
      this.logger.error(`Error processing transaction event: ${error.message}`);
      throw error;
    }
  }

  async syncTransactions() {
    const transactions = await this.transactionRepository.find();

    for (const transaction of transactions) {
      await this.transactionModel.findOneAndUpdate(
        { id: transaction.id },
        {
          id: transaction.id,
          sourceAccountId: transaction.sourceAccountId,
          destinationAccountId: transaction.destinationAccountId,
          amount: transaction.amount,
          type: transaction.type,
          status: transaction.status,
          description: transaction.description,
          createdAt: transaction.createdAt,
          processedAt: transaction.processedAt,
        },
        { upsert: true, new: true },
      );
    }

    this.logger.log(`${transactions.length} transactions synchronized`);
  }
}

// import { HttpException, Injectable, Logger } from '@nestjs/common';
// import { InjectModel } from '@nestjs/mongoose';
// import { InjectRepository } from '@nestjs/typeorm';
// import { ConsumeMessage } from 'amqplib';
// import { Model } from 'mongoose';
// import { Repository } from 'typeorm';
// import { AccountEntity } from '../../accounts/models/account.entity';
// import { AccountDocument } from '../../accounts/models/account.schema';
// import { TransactionEntity } from '../../transactions/models/transaction.entity';
// import { Transaction } from '../../transactions/models/transaction.schema';
// import { RabbitMQService } from '../messaging/rabbitmq.service';

// @Injectable()
// export class DataSyncService {
//   private readonly logger = new Logger(DataSyncService.name);

//   constructor(
//     @InjectRepository(AccountEntity)
//     private accountRepository: Repository<AccountEntity>,

//     @InjectRepository(TransactionEntity)
//     private transactionRepository: Repository<TransactionEntity>,

//     @InjectModel(AccountDocument.name)
//     private accountModel: Model<AccountDocument>,

//     @InjectModel(Transaction.name)
//     private transactionModel: Model<Transaction>,

//     private readonly rabbitMQService: RabbitMQService,
//   ) {}

//   public async handleTransactionEvent(message: any, amqpMsg: ConsumeMessage) {
//     this.logger.debug('Received transaction event', {
//       routingKey: amqpMsg.fields.routingKey,
//       message,
//     });

//     try {
//       await this.syncTransactions();
//     } catch (error) {
//       this.logger.error(`Error processing transactions: ${error.message}`);
//       throw new HttpException(
//         `Error processing transactions: ${error.message}`,
//         500,
//       );
//     }
//   }

//   // async onModuleInit() {
//   //   // Executar sincronização inicial ao iniciar a aplicação
//   //   await this.syncAllData();
//   // }

//   // /**
//   //  * Executa a sincronização de todos os dados a cada 10 minutos
//   //  */
//   // @Cron(CronExpression.EVERY_30_SECONDS)
//   // async scheduledSync() {
//   //   this.logger.log('Iniciando sincronização programada de dados');
//   //   await this.syncAllData();
//   //   this.logger.log('Sincronização programada concluída');
//   // }

//   // /**
//   //  * Sincroniza todos os dados entre as bases
//   //  */
//   // async syncAllData() {
//   //   try {
//   //     await this.syncAccounts();
//   //     await this.syncTransactions();
//   //     this.logger.log('Sincronização completa executada com sucesso');
//   //   } catch (error) {
//   //     this.logger.error(
//   //       `Erro durante sincronização: ${error.message}`,
//   //       error.stack,
//   //     );
//   //   }
//   // }

//   /**
//    * Sincroniza as contas da base de comando para a base de consulta
//    */

//   async syncAccounts() {
//     this.logger.log('Sincronizando contas...');
//     const accounts = await this.accountRepository.find();

//     for (const account of accounts) {
//       await this.accountModel.findOneAndUpdate(
//         { id: account.id },
//         {
//           id: account.id,
//           owner: account.owner,
//           balance: account.balance,
//           createdAt: account.createdAt,
//           updatedAt: account.updatedAt,
//         },
//         { upsert: true, new: true },
//       );
//     }

//     this.logger.log(`${accounts.length} contas sincronizadas`);
//   }

//   /**
//    * Sincroniza as transações da base de comando para a base de consulta
//    */
//   async syncTransactions() {
//     this.logger.log('Sincronizando transações...');
//     const transactions = await this.transactionRepository.find();

//     for (const transaction of transactions) {
//       await this.transactionModel.findOneAndUpdate(
//         { id: transaction.id },
//         {
//           id: transaction.id,
//           sourceAccountId: transaction.sourceAccountId,
//           destinationAccountId: transaction.destinationAccountId,
//           amount: transaction.amount,
//           type: transaction.type,
//           status: transaction.status,
//           description: transaction.description,
//           createdAt: transaction.createdAt,
//           processedAt: transaction.processedAt,
//         },
//         { upsert: true, new: true },
//       );
//     }

//     this.logger.log(`${transactions.length} transações sincronizadas`);
//   }

//   // /**
//   //  * Método para forçar uma sincronização sob demanda
//   //  */
//   // async forceSyncAll() {
//   //   this.logger.log('Iniciando sincronização forçada de dados');
//   //   await this.syncAllData();
//   //   this.logger.log('Sincronização forçada concluída');
//   //   return { message: 'Sincronização concluída com sucesso' };
//   // }
// }
