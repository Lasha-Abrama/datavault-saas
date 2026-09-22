import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ minLength: 1, maxLength: 72, writeOnly: true })
  @IsString()
  @Length(1, 72)
  currentPassword: string;

  @ApiProperty({ minLength: 8, maxLength: 72, writeOnly: true })
  @IsString()
  @Length(8, 72)
  @Matches(/\S/, {
    message: 'newPassword must contain a non-whitespace character',
  })
  newPassword: string;
}
