import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { userSchema } from 'src/users/entities/user.entity';

@Module({
  imports: [
    ConfigModule.forRoot(),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET
    }),
    PassportModule.register({ defaultStrategy: 'google'}), 
    MongooseModule.forFeature([{name: 'user', schema: userSchema}])
  ],
  controllers: [AuthController],
  providers: [
    AuthService, 
    GoogleStrategy,
  ],
})
export class AuthModule {}