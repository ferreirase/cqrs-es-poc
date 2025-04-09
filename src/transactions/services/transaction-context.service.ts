import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { AccountDocument } from '../../accounts/models/account.schema';
import { LoggingService } from '../../common/monitoring/logging.service';
import { UserDocument } from '../../users/models/user.schema';
import { TransactionEntity } from '../models/transaction.entity';

/**
 * Serviço que mantém o contexto de execução da transação durante todo o fluxo da Saga.
 * Usado para recuperar dinamicamente informações necessárias para os comandos e eventos
 * sem precisar hardcoded nos handlers.
 */
@Injectable()
export class TransactionContextService {
  private readonly transactionCache = new Map<string, any>();

  constructor(
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectModel(UserDocument.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AccountDocument.name)
    private readonly accountModel: Model<AccountDocument>,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Armazena informações no contexto de transação
   */
  async setTransactionContext(transactionId: string, data: any): Promise<void> {
    const existingContext = this.transactionCache.get(transactionId) || {};
    this.transactionCache.set(transactionId, { ...existingContext, ...data });
  }

  /**
   * Recupera informações do contexto de transação
   */
  getTransactionContext(transactionId: string): any {
    return this.transactionCache.get(transactionId) || {};
  }

  /**
   * Remove o contexto de transação quando não for mais necessário
   */
  clearTransactionContext(transactionId: string): void {
    this.transactionCache.delete(transactionId);
  }

  /**
   * Carrega informações da transação do banco de dados
   */
  async loadTransactionDetails(transactionId: string): Promise<void> {
    try {
      const transaction = await this.transactionRepository.findOne({
        where: { id: transactionId },
      });

      if (!transaction) {
        throw new Error(`Transaction with ID "${transactionId}" not found`);
      }

      const context = {
        sourceAccountId: transaction.sourceAccountId,
        destinationAccountId: transaction.destinationAccountId,
        amount: transaction.amount,
        description:
          transaction.description || `Withdrawal operation - ${transactionId}`,
        type: transaction.type,
        status: transaction.status,
      };

      await this.setTransactionContext(transactionId, context);

      // Se tivermos as informações das contas, vamos buscar os usuários associados também
      await this.loadAccountUserDetails(transactionId);
    } catch (error) {
      this.loggingService.error(
        `[TransactionContextService] Error loading transaction details: ${error.message}`,
      );
    }
  }

  /**
   * Carrega informações dos usuários associados às contas
   */
  async loadAccountUserDetails(transactionId: string): Promise<void> {
    const context = this.getTransactionContext(transactionId);

    if (!context) return;

    try {
      // Buscar informações do usuário da conta de origem
      if (context.sourceAccountId) {
        const sourceAccount = await this.accountModel.findOne({
          id: context.sourceAccountId,
        });

        if (sourceAccount && sourceAccount.owner) {
          const sourceUser = await this.userModel.findOne({
            id: sourceAccount.owner,
          });

          if (sourceUser) {
            await this.setTransactionContext(transactionId, {
              sourceUserId: sourceUser.id,
              sourceUserEmail: sourceUser.email,
              sourceUserName: sourceUser.name,
            });
          }
        }
      }

      // Buscar informações do usuário da conta de destino
      if (context.destinationAccountId) {
        const destAccount = await this.accountModel.findOne({
          id: context.destinationAccountId,
        });

        if (destAccount && destAccount.owner) {
          const destUser = await this.userModel.findOne({
            id: destAccount.owner,
          });

          if (destUser) {
            await this.setTransactionContext(transactionId, {
              destinationUserId: destUser.id,
              destinationUserEmail: destUser.email,
              destinationUserName: destUser.name,
            });
          }
        }
      }
    } catch (error) {
      this.loggingService.error(
        `[TransactionContextService] Error loading account user details: ${error.message}`,
      );
    }
  }
}
