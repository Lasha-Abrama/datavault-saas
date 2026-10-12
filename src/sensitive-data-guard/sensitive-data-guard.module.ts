import { AwsS3Module } from '../aws-s3/aws-s3.module';
import { GuardSanitizationService } from './guard-sanitization.service';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { GuardController } from './guard.controller';
import { GuardService } from './guard.service';
import { GuardWorker } from './guard.worker';
import { GuardRunner } from './guard.runner';
import { GuardAccessService } from './guard-access.service';
import { guardJobSchema } from './entities/guard-job.entity';
import { guardFindingSchema } from './entities/guard-finding.entity';
import { guardEventSchema } from './entities/guard-event.entity';
import {
  DEFAULT_LIMITS,
  GUARD_LIMITS,
  GUARD_RUNTIME_POLICY,
  DEFAULT_RUNTIME_POLICY,
} from './guard.constants';
@Module({
  imports: [
    AuthModule,
    FilesModule,
    AwsS3Module,
    MongooseModule.forFeature([
      { name: 'guardJob', schema: guardJobSchema },
      { name: 'guardFinding', schema: guardFindingSchema },
      { name: 'guardEvent', schema: guardEventSchema },
    ]),
  ],
  controllers: [GuardController],
  providers: [
    GuardService,
    GuardSanitizationService,
    GuardAccessService,
    GuardRunner,
    GuardWorker,
    { provide: GUARD_LIMITS, useValue: DEFAULT_LIMITS },
    { provide: GUARD_RUNTIME_POLICY, useValue: DEFAULT_RUNTIME_POLICY },
  ],
})
export class SensitiveDataGuardModule {}
