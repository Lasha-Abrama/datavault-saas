import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { GoogleOauthGuard } from 'src/guards/google-oauth.guard';
import { IsAuthGuard } from 'src/guards/is-auth.guard';
import { UserId } from 'src/decorators/user.decorator';



@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('/google')
  @UseGuards(GoogleOauthGuard)
  async googleAuth(){}

  @Get('/google/callback')
  @UseGuards(GoogleOauthGuard)
  async googleRedirect(@Req() req, @Res() res){
    if (req.query.error) {
      return res.redirect(`${process.env.FRONT_URI}/auth/sign-in?error=google_auth_cancelled`);
    }
    
    const token = await this.authService.signInWithGoogle(req.user)
    res.redirect(`${process.env.FRONT_URI}/auth/sign-in?token=${token}`)
  }
 
  @Post('/sign-in')
  signIn(@Body() signInDto: SignInDto){
    return this.authService.signIn(signInDto)
  }

  @Post('/sign-up')
  signUp(@Body() signUpDto: SignUpDto){
    return this.authService.signUp(signUpDto)
  }

  @Get('/current-user')
  @UseGuards(IsAuthGuard)
  currentUser(@UserId() userId){
    return this.authService.getCurrentUser(userId)
  }

 
}