import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { userSchema } from '../users/entities/user.entity';
import { companySchema } from '../companies/entities/company.entity';
import { IsAuthGuard } from '../guards/is-auth.guard';
import { GoogleOauthGuard } from '../guards/google-oauth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SubscriptionsDomainModule } from '../subscriptions/subscriptions-domain.module';

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
    SubscriptionsDomainModule,
    MongooseModule.forFeature([
      { name: 'user', schema: userSchema },
      { name: 'company', schema: companySchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    IsAuthGuard,
    RolesGuard,
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
  exports: [IsAuthGuard, RolesGuard, JwtModule, MongooseModule],
})
export class AuthModule {}
