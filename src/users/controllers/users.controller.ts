import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CreateUserCommand } from '../commands/impl/create-user.command';
import { UpdateUserCommand } from '../commands/impl/update-user.command';
import { GetUserQuery } from '../queries/impl/get-user.query';
import { GetUsersQuery } from '../queries/impl/get-users.query';

@Controller('users')
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  async createUser(
    @Body()
    createUserDto: {
      name: string;
      document: string;
      email: string;
      accountId?: string;
    },
  ) {
    const { name, document, email, accountId } = createUserDto;
    return this.commandBus.execute(
      new CreateUserCommand(null, name, document, email, accountId),
    );
  }

  @Put(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() updateUserDto: { name?: string; document?: string; email?: string },
  ) {
    const { name, document, email } = updateUserDto;
    return this.commandBus.execute(
      new UpdateUserCommand(id, name, document, email),
    );
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.queryBus.execute(new GetUserQuery(id));
  }

  @Get()
  async getUsers() {
    return this.queryBus.execute(new GetUsersQuery());
  }
}
