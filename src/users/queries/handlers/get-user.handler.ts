import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument } from '../../models/user.schema';
import { GetUserQuery } from '../impl/get-user.query';

@QueryHandler(GetUserQuery)
export class GetUserHandler implements IQueryHandler<GetUserQuery> {
  constructor(
    @InjectModel(UserDocument.name)
    private userModel: Model<UserDocument>,
  ) {}

  async execute(query: GetUserQuery) {
    const user = await this.userModel.findOne({ id: query.id }).exec();

    if (!user) {
      throw new NotFoundException(`User with ID "${query.id}" not found`);
    }

    return user;
  }
}
