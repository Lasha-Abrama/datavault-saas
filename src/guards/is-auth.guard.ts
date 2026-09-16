import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isMongoId } from 'class-validator';
import { AuthenticatedRequest, TokenPayload } from '../auth/auth.types';
import { Role } from '../enums/roles.enum';

@Injectable()
export class IsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    if (!match)
      throw new UnauthorizedException('Invalid or missing bearer token');
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(match[1]);
      if (!isMongoId(payload.id) || !Object.values(Role).includes(payload.role))
        throw new Error('Invalid token payload');
      request.userId = payload.id;
      request.role = payload.role;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired bearer token');
    }
  }
}
