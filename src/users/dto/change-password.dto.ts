import { IsString, Length, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @Length(1, 72)
  currentPassword: string;

  @IsString()
  @Length(8, 72)
  @Matches(/\S/, {
    message: 'newPassword must contain a non-whitespace character',
  })
  newPassword: string;
}
