import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CreateTransactionCommand } from '../commands/impl/create-transaction.command';
import { TransactionType } from '../models/transaction.entity';
import { GetAccountTransactionsQuery } from '../queries/impl/get-account-transactions.query';
import { GetTransactionQuery } from '../queries/impl/get-transaction.query';

class CreateTransactionDto {
  sourceAccountId: string;
  destinationAccountId?: string;
  amount: number;
  type: TransactionType;
  description?: string;
}

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  async createTransaction(@Body() createTransactionDto: CreateTransactionDto) {
    const command = new CreateTransactionCommand(
      null, // id will be generated in the handler
      createTransactionDto.sourceAccountId,
      createTransactionDto.destinationAccountId || null,
      createTransactionDto.amount,
      createTransactionDto.type,
      createTransactionDto.description,
    );

    return this.commandBus.execute(command);
  }

  @Get(':id')
  async getTransaction(@Param('id') id: string) {
    try {
      return {
        transaction: await this.queryBus.execute(new GetTransactionQuery(id)),
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Transaction with ID "${id}" not found`);
    }
  }

  @Get('account/:accountId')
  async getAccountTransactions(@Param('accountId') accountId: string) {
    return this.queryBus.execute(new GetAccountTransactionsQuery(accountId));
  }
}
