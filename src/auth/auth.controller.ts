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
  ServiceUnavailableException,
  ForbiddenException,
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
import { GoogleOAuthFlowService } from './google-oauth-flow.service';
import { GoogleExchangeDto } from './dto/google-exchange.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly companyVerificationService: CompanyVerificationService,
    private readonly config: ConfigService,
    private readonly googleOAuthFlow: GoogleOAuthFlowService,
  ) {}

  @Get('google')
  @UseGuards(ThrottlerGuard, GoogleOauthGuard)
  @Throttle({ publicAuth: { limit: 10, ttl: 60_000 } })
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(ThrottlerGuard, GoogleOauthGuard)
  @Throttle({ publicAuth: { limit: 20, ttl: 60_000 } })
  async googleRedirect(
    @Req() req: Request & { user: GoogleUser },
    @Res() res: Response,
  ) {
    const redirect = new URL(
      '/auth/sign-in',
      this.config.getOrThrow<string>('FRONT_URI'),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.query.error)
      redirect.searchParams.set('error', 'google_auth_cancelled');
    else {
      const user = await this.authService.resolveGoogleUser(req.user);
      redirect.hash = new URLSearchParams({
        code: await this.googleOAuthFlow.createExchange(user._id),
      }).toString();
    }
    res.redirect(redirect.toString());
  }

  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ publicAuth: { limit: 10, ttl: 60_000 } })
  async googleExchange(
    @Body() dto: GoogleExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.config.get<string>('GOOGLE_CLIENT_ID'))
      throw new ServiceUnavailableException(
        'Google authentication is not configured',
      );
    if (this.config.get<string>('NODE_ENV') === 'production' && !req.secure)
      throw new ForbiddenException('HTTPS is required for Google exchange');
    res.setHeader('Cache-Control', 'private, no-store');
    const userId = await this.googleOAuthFlow.consumeExchange(dto.code);
    return this.authService.exchangeGoogleUser(userId);
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
