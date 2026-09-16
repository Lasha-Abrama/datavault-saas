import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import { isMongoId } from 'class-validator';
import { AuthenticatedRequest, TokenPayload } from '../auth/auth.types';
import { Role } from '../enums/roles.enum';
import { User } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';

@Injectable()
export class IsAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @InjectModel('user') private readonly userModel: Model<User>,
    @InjectModel('company') private readonly companyModel: Model<Company>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = request.headers.authorization?.match(/^Bearer ([^\s]+)$/);
    if (!match)
      throw new UnauthorizedException('Invalid or missing bearer token');
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(match[1]);
      if (!isMongoId(payload.id)) throw new Error('Invalid token payload');
      const user = await this.userModel.findById(payload.id);
      if (
        !user ||
        !(user.companyId instanceof Types.ObjectId) ||
        !Object.values(Role).includes(user.role)
      )
        throw new Error('Invalid user membership');
      const company = await this.companyModel.findOne({
        _id: user.companyId,
        activatedAt: { $ne: null },
      });
      if (!company) throw new Error('Inactive company');
      request.auth = {
        id: user._id.toString(),
        companyId: user.companyId.toString(),
        role: user.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired bearer token');
    }
  }
}
