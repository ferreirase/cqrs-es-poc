import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';
import { UserDocument, UserSchema } from '../models/user.schema';
import { QueryHandlers } from './handlers';

@Module({
  imports: [
    CqrsModule,
    MongooseModule.forFeature([
      { name: UserDocument.name, schema: UserSchema },
    ]),
  ],
  providers: [...QueryHandlers],
  exports: [...QueryHandlers],
})
export class QueriesModule {}
