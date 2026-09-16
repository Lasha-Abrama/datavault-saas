import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { CompanyProfileDto } from './company-profile.dto';

export class CreateCompanyDto extends CompanyProfileDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  name: string;
}
