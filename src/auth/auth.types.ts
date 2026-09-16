import { Request } from 'express';
import { Role } from '../enums/roles.enum';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  role?: Role;
}

export interface TokenPayload {
  id: string;
  role: Role;
}

export interface GoogleUser {
  email: string;
  fullName: string;
  avatar?: string;
}
