import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

@Injectable()
export class GoogleOauthGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!this.config.get<string>('GOOGLE_CLIENT_ID'))
      throw new ServiceUnavailableException(
        'Google authentication is not configured',
      );
    const request = context.switchToHttp().getRequest<Request>();
    if (request.query.error) return true;
    return super.canActivate(context);
  }
}
