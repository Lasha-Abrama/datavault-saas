import { Transform } from 'class-transformer';
import { IntersectionType } from '@nestjs/mapped-types';
import { IsString, Length, ValidateIf } from 'class-validator';
import { CompanyProfileDto } from '../../companies/dto/company-profile.dto';
import { SignInDto } from './sign-in.dto';

export class SignUpDto extends IntersectionType(SignInDto, CompanyProfileDto) {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  companyName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 100)
  fullName?: string;
}
