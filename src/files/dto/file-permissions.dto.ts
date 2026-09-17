import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsMongoId,
  IsOptional,
} from 'class-validator';
import { CompanyFileVisibility } from '../entities/company-file.entity';

const parseEmployeeIds = ({ value }: { value: unknown }) => {
  if (Array.isArray(value) || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return [trimmed];
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

export class UploadFilePermissionsDto {
  @IsEnum(CompanyFileVisibility)
  visibility: CompanyFileVisibility = CompanyFileVisibility.COMPANY_WIDE;

  @Transform(parseEmployeeIds)
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  restrictedUserIds: string[] = [];
}

export class UpdateFilePermissionsDto {
  @IsEnum(CompanyFileVisibility)
  visibility: CompanyFileVisibility;

  @IsOptional()
  @Transform(parseEmployeeIds)
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  restrictedUserIds?: string[];
}
