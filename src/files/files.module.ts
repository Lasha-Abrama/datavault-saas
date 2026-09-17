import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { AwsS3Module } from '../aws-s3/aws-s3.module';
import { SubscriptionsDomainModule } from '../subscriptions/subscriptions-domain.module';
import { companyFileSchema } from './entities/company-file.entity';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [
    AuthModule,
    AwsS3Module,
    SubscriptionsDomainModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: config.getOrThrow<number>('FILE_MAX_SIZE_BYTES'),
          files: 1,
          fields: 0,
          parts: 1,
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: 'companyFile', schema: companyFileSchema },
    ]),
  ],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
