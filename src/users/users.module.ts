import { AuthModule } from '../auth/auth.module';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { userSchema } from './entities/user.entity';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: 'user', schema: userSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
