import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/auth.types';
import { Role } from '../enums/roles.enum';

// Routes must authenticate with IsAuthGuard before applying this guard.
@Injectable()
export class IsAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.role !== Role.ADMIN)
      throw new ForbiddenException('Admin access is required');
    return true;
  }
}
