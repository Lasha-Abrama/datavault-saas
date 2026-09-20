import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';
import {
  CompanyPlatformReason,
  CompanyPlatformStatus,
} from '../../companies/platform-status';
import { Role } from '../../enums/roles.enum';
import {
  CompanyFileType,
  CompanyFileVisibility,
} from '../../files/entities/company-file.entity';
import { PaymentAccess } from '../../payments/payment.constants';
import { PlanCode } from '../../plans/plan.constants';
import { AdminAuditAction } from '../entities/admin-audit.entity';

export class AdminLoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @Length(3, 254)
  email: string;

  @IsString()
  @Length(1, 72)
  @ValidateBy({
    name: 'bcryptByteLimit',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
    },
  })
  password: string;
}

export class AdminEmptyDto {}

export class AdminPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}

export class AdminCompanyQueryDto extends AdminPaginationDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  search?: string;
  @IsOptional()
  @IsIn(['createdAt', 'name', 'updatedAt'])
  sortBy: 'createdAt' | 'name' | 'updatedAt' = 'createdAt';
  @IsOptional()
  @IsIn(['activated', 'pending'])
  activation?: 'activated' | 'pending';
  @IsOptional()
  @IsEnum(CompanyPlatformStatus)
  status?: CompanyPlatformStatus;
  @IsOptional()
  @IsEnum(PlanCode)
  plan?: PlanCode;
  @IsOptional()
  @IsEnum(PaymentAccess)
  paymentAccess?: PaymentAccess;
  @IsOptional()
  @IsIn(['true', 'false'])
  stripeManaged?: 'true' | 'false';
}

export class AdminUserQueryDto extends AdminPaginationDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  search?: string;
  @IsOptional()
  @IsMongoId()
  companyId?: string;
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
  @IsOptional()
  @IsIn(['createdAt', 'email', 'fullName'])
  sortBy: 'createdAt' | 'email' | 'fullName' = 'createdAt';
}

export class AdminFileQueryDto extends AdminPaginationDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  search?: string;
  @IsOptional()
  @IsMongoId()
  companyId?: string;
  @IsOptional()
  @IsEnum(CompanyFileVisibility)
  visibility?: CompanyFileVisibility;
  @IsOptional()
  @IsEnum(CompanyFileType)
  fileType?: CompanyFileType;
  @IsOptional()
  @IsIn(['createdAt', 'originalFilename', 'size'])
  sortBy: 'createdAt' | 'originalFilename' | 'size' = 'createdAt';
}

export class AdminAuditQueryDto extends AdminPaginationDto {
  @IsOptional()
  @IsEnum(AdminAuditAction)
  action?: AdminAuditAction;
  @IsOptional()
  @IsMongoId()
  actorId?: string;
  @IsOptional()
  @IsMongoId()
  targetId?: string;
}

export class AdminCompanyIdDto {
  @IsMongoId()
  id: string;
}

export class SuspendCompanyDto {
  @IsIn([
    CompanyPlatformReason.SECURITY_REVIEW,
    CompanyPlatformReason.POLICY_REVIEW,
    CompanyPlatformReason.OPERATIONAL_HOLD,
  ])
  reason: CompanyPlatformReason;
}
