import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { userSchema } from '../users/entities/user.entity';
import { IsAuthGuard } from '../guards/is-auth.guard';
import { IsAdminGuard } from '../guards/is-admin.guard';
import { GoogleOauthGuard } from '../guards/google-oauth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    PassportModule.register({ session: false }),
    MongooseModule.forFeature([{ name: 'user', schema: userSchema }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    IsAuthGuard,
    IsAdminGuard,
    GoogleOauthGuard,
    {
      provide: GoogleStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('GOOGLE_CLIENT_ID')
          ? new GoogleStrategy(config)
          : null,
    },
  ],
  exports: [IsAuthGuard, IsAdminGuard, JwtModule],
})
export class AuthModule {}
