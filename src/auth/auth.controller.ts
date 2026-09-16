import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleUser } from './auth.types';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { GoogleOauthGuard } from '../guards/google-oauth.guard';
import { IsAuthGuard } from '../guards/is-auth.guard';
import { UserId } from '../decorators/user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
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
  signIn(@Body() dto: SignInDto) {
    return this.authService.signIn(dto);
  }

  @Post('sign-up')
  signUp(@Body() dto: SignUpDto) {
    return this.authService.signUp(dto);
  }

  @Get('current-user')
  @UseGuards(IsAuthGuard)
  currentUser(@UserId() userId: string) {
    return this.authService.getCurrentUser(userId);
  }
}
