import { PickType } from '@nestjs/mapped-types';
import { SignInDto } from './sign-in.dto';

export class ResendVerificationDto extends PickType(SignInDto, ['email']) {}
