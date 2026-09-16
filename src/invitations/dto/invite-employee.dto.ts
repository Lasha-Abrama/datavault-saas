import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class InviteEmployeeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;
}
