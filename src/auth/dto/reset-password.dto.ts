import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, ValidateBy } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ minLength: 43, maxLength: 43, writeOnly: true })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token: string;

  @ApiProperty({ minLength: 8, maxLength: 72, writeOnly: true })
  @IsString()
  @Length(8, 72)
  @Matches(/\S/, {
    message: 'newPassword must contain a non-whitespace character',
  })
  @ValidateBy({
    name: 'bcryptByteLimit',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
    },
  })
  newPassword: string;
}
