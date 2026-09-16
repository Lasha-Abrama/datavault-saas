import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  fullName: string;

  @IsString()
  @Length(6, 20)
  password: string;
}
