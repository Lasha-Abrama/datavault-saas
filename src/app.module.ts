import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { AwsS3Module } from './aws-s3/aws-s3.module';
import { CompaniesModule } from './companies/companies.module';
import { validateEnvironment } from './config/environment';
import { PlansModule } from './plans/plans.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { InvitationsModule } from './invitations/invitations.module';
import { FilesModule } from './files/files.module';
import { StatisticsModule } from './statistics/statistics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI'),
      }),
    }),
    UsersModule,
    AuthModule,
    AwsS3Module,
    CompaniesModule,
    PlansModule,
    SubscriptionsModule,
    InvitationsModule,
    FilesModule,
    StatisticsModule,
  ],
})
export class AppModule {}
