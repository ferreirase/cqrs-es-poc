import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountDocument } from '../../../accounts/models/account.schema';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { UpdateAccountStatementCommand } from '../../commands/impl/update-account-statement.command';
import { StatementUpdatedEvent } from '../../events/impl/statement-updated.event';

@CommandHandler(UpdateAccountStatementCommand)
export class UpdateAccountStatementHandler
  implements ICommandHandler<UpdateAccountStatementCommand>
{
  constructor(
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
    private eventBus: EventBus,
    private loggingService: LoggingService,
  ) {}

  async execute(command: UpdateAccountStatementCommand): Promise<void> {
    const { transactionId, accountId, amount, type, description } = command;

    this.loggingService.info(
      `[UpdateAccountStatementHandler] Updating account statement: ${accountId}, type: ${type}, amount: ${amount}`,
    );

    try {
      // Buscar a conta no read model (MongoDB)
      const account = await this.accountModel.findOne({ id: accountId });

      if (!account) {
        throw new Error(
          `Account with ID "${accountId}" not found in read model`,
        );
      }

      // Criar uma entrada no extrato (array de statements dentro do documento da conta)
      // Nota: O modelo precisa ter um campo statements para armazenar o histórico
      const statementEntry = {
        transactionId,
        amount,
        type,
        description,
        timestamp: new Date(),
      };

      // Adicionar ao array de statements (assumindo que o schema tenha este campo)
      // Se a estrutura for diferente, ajuste conforme necessário
      await this.accountModel.updateOne(
        { id: accountId },
        {
          $push: { statements: statementEntry },
          $set: { updatedAt: new Date() },
        },
      );

      // Publicar evento indicando que o extrato foi atualizado com sucesso
      this.eventBus.publish(
        new StatementUpdatedEvent(transactionId, accountId, amount, type, true),
      );

      this.loggingService.info(
        `[UpdateAccountStatementHandler] Successfully updated statement for account ${accountId}`,
      );
    } catch (error) {
      this.loggingService.error(
        `[UpdateAccountStatementHandler] Error updating account statement: ${error.message}`,
      );

      // Publicar evento indicando falha na atualização do extrato
      this.eventBus.publish(
        new StatementUpdatedEvent(
          transactionId,
          accountId,
          amount,
          type,
          false,
        ),
      );

      throw error;
    }
  }
}
