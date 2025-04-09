import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CreateAccountCommand } from '../commands/impl/create-account.command';
import { UpdateAccountBalanceCommand } from '../commands/impl/update-account-balance.command';
import { GetAccountBalanceQuery } from '../queries/impl/get-account-balance.query';
import { GetAccountQuery } from '../queries/impl/get-account.query';
import { GetAccountsQuery } from '../queries/impl/get-accounts.query';

class CreateAccountDto {
  ownerId: string;
  initialBalance?: number;
}

class UpdateBalanceDto {
  amount: number;
}

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  async createAccount(@Body() createAccountDto: CreateAccountDto) {
    try {
      if (!isValidUUID(createAccountDto.ownerId)) {
        throw new BadRequestException('Invalid owner UUID');
      }

      const account = await this.queryBus.execute(
        new GetAccountQuery(createAccountDto.ownerId),
      );

      if (account) {
        throw new BadRequestException('Account already exists');
      }

      const command = new CreateAccountCommand(
        createAccountDto.ownerId,
        createAccountDto.initialBalance || 0,
      );

      return this.commandBus.execute(command);
    } catch (error) {
      console.error(error);
      throw new BadRequestException(`Error creating account: ${error.message}`);
    }
  }

  @Get()
  async getAllAccounts() {
    return this.queryBus.execute(new GetAccountsQuery());
  }

  @Get(':id')
  async getAccount(@Param('id') id: string) {
    try {
      return await this.queryBus.execute(new GetAccountQuery(id));
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
  }

  @Get(':id/balance')
  async getAccountBalance(@Param('id') id: string) {
    try {
      return {
        balance: await this.queryBus.execute(new GetAccountBalanceQuery(id)),
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
  }

  @Patch(':id/balance')
  async updateBalance(
    @Param('id') id: string,
    @Body() updateBalanceDto: UpdateBalanceDto,
  ) {
    const command = new UpdateAccountBalanceCommand(
      id,
      updateBalanceDto.amount,
    );

    return this.commandBus.execute(command);
  }
}

/**
 * Verifica se o owner é um UUID válido
 * @param ownerId UUID do owner
 * @returns true se for um UUID válido, false caso contrário
 */
function isValidUUID(ownerId: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    ownerId,
  );
}
