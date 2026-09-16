import { AuthenticatedRequest } from '../auth/auth.types';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Role = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.role;
  },
);
