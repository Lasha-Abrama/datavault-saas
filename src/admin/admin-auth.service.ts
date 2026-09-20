import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PlatformAdmin } from './entities/platform-admin.entity';
import {
  AdminAudit,
  AdminAuditAction,
  AdminAuditReason,
} from './entities/admin-audit.entity';
import { AdminLoginDto } from './dto/admin.dto';
import {
  PLATFORM_ADMIN_JWT,
  PLATFORM_ADMIN_TOKEN_TYPE,
} from './admin-security';

@Injectable()
export class AdminAuthService {
  private dummyHash?: Promise<string>;
  constructor(
    @InjectModel('platformAdmin') private readonly admins: Model<PlatformAdmin>,
    @InjectModel('adminAudit') private readonly audits: Model<AdminAudit>,
    @Inject(PLATFORM_ADMIN_JWT) private readonly jwt: JwtService,
  ) {}

  async login(dto: AdminLoginDto) {
    const admin = await this.admins
      .findOne({ email: dto.email })
      .select('+password');
    const dummy = await (this.dummyHash ??= bcrypt.hash(
      randomBytes(32).toString('hex'),
      12,
    ));
    const valid = await bcrypt.compare(dto.password, admin?.password ?? dummy);
    try {
      await this.audits.create({
        action:
          valid && admin?.isActive
            ? AdminAuditAction.LOGIN_SUCCEEDED
            : AdminAuditAction.LOGIN_FAILED,
        actorId: admin?._id,
        targetId: admin?._id,
        targetType: admin ? 'platform_admin' : undefined,
        reason:
          valid && admin?.isActive
            ? undefined
            : AdminAuditReason.INVALID_CREDENTIALS,
      });
    } catch {
      // Security-sensitive access fails closed if it cannot be recorded.
      throw new ServiceUnavailableException(
        'Platform authentication temporarily unavailable',
      );
    }
    if (!valid || !admin?.isActive)
      throw new UnauthorizedException('Invalid credentials');
    return {
      accessToken: await this.jwt.signAsync({
        sub: admin._id.toString(),
        type: PLATFORM_ADMIN_TOKEN_TYPE,
      }),
    };
  }
}
