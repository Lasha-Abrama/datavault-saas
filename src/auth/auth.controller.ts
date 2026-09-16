import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleUser } from './auth.types';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { GoogleOauthGuard } from '../guards/google-oauth.guard';
import { IsAuthGuard } from '../guards/is-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { VerifyAccountDto } from './dto/verify-account.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { CompanyVerificationService } from './company-verification.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly companyVerificationService: CompanyVerificationService,
    private readonly config: ConfigService,
  ) {}

  @Get('google')
  @UseGuards(GoogleOauthGuard)
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleOauthGuard)
  async googleRedirect(
    @Req() req: Request & { user: GoogleUser },
    @Res() res: Response,
  ) {
    const redirect = new URL(
      '/auth/sign-in',
      this.config.getOrThrow<string>('FRONT_URI'),
    );
    if (req.query.error)
      redirect.searchParams.set('error', 'google_auth_cancelled');
    else
      redirect.searchParams.set(
        'token',
        await this.authService.signInWithGoogle(req.user),
      );
    res.redirect(redirect.toString());
  }

  @Post('sign-in')
  @UseGuards(ThrottlerGuard)
  @Throttle({ publicAuth: { limit: 10, ttl: 60_000 } })
  signIn(@Body() dto: SignInDto) {
    return this.authService.signIn(dto);
  }

  @Post('sign-up')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ publicAuth: { limit: 10, ttl: 60_000 } })
  signUp(@Body() dto: SignUpDto) {
    return this.authService.signUp(dto);
  }

  @Post('verify-account')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ publicAuth: { limit: 20, ttl: 60_000 } })
  verifyAccount(@Body() dto: VerifyAccountDto) {
    return this.companyVerificationService.verify(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ publicAuth: { limit: 5, ttl: 60_000 } })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.companyVerificationService.resend(dto.email);
  }

  @Get('current-user')
  @UseGuards(IsAuthGuard)
  currentUser(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getCurrentUser(user.id);
  }
}
