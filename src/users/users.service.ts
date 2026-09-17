import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { QueryParams } from './dto/query-params.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../enums/roles.enum';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { isDuplicateKeyError } from './database-errors';

@Injectable()
export class UsersService {
  constructor(@InjectModel('user') private readonly userModel: Model<User>) {}

  async findAll(actor: AuthenticatedUser, { page, take }: QueryParams) {
    this.requireOwner(actor);
    take = Math.min(take, 30);
    const filter = { companyId: actor.companyId };
    const users = await this.userModel
      .find(filter)
      .sort({ _id: -1 })
      .skip((page - 1) * take)
      .limit(take);
    const total = await this.userModel.countDocuments(filter);
    return { users, total, page, take };
  }

  async findOne(actor: AuthenticatedUser, targetUserId: string) {
    this.requireSelfOrOwner(actor, targetUserId);
    const user = await this.userModel.findOne({
      _id: targetUserId,
      companyId: actor.companyId,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateUser(
    actor: AuthenticatedUser,
    targetUserId: string,
    dto: UpdateUserDto,
  ) {
    const target = await this.findOne(actor, targetUserId);
    if (
      dto.email !== undefined &&
      target.role === Role.COMPANY_OWNER &&
      dto.email !== target.email
    )
      throw new BadRequestException(
        'The company owner email cannot be changed without verification',
      );
    const update: UpdateUserDto = {};
    if (dto.email !== undefined) update.email = dto.email;
    if (dto.fullName !== undefined) update.fullName = dto.fullName;
    if (dto.password !== undefined)
      update.password = await bcrypt.hash(dto.password, 10);
    try {
      const user = await this.userModel.findOneAndUpdate(
        { _id: targetUserId, companyId: actor.companyId },
        update,
        { new: true, runValidators: true },
      );
      if (!user) throw new NotFoundException('User not found');
      return user;
    } catch (error) {
      if (isDuplicateKeyError(error))
        throw new ConflictException('Email is already in use');
      throw error;
    }
  }

  async deleteUser(actor: AuthenticatedUser, targetUserId: string) {
    this.requireOwner(actor);
    const target = await this.findOne(actor, targetUserId);
    if (target.role === Role.COMPANY_OWNER)
      throw new BadRequestException('The company owner cannot be deleted');
    const user = await this.userModel.findOneAndDelete({
      _id: targetUserId,
      companyId: actor.companyId,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private requireSelfOrOwner(actor: AuthenticatedUser, targetUserId: string) {
    if (
      actor.role !== Role.COMPANY_OWNER &&
      actor.id !== targetUserId.toLowerCase()
    )
      throw new ForbiddenException('You do not have access to this user');
  }

  private requireOwner(actor: AuthenticatedUser) {
    if (actor.role !== Role.COMPANY_OWNER)
      throw new ForbiddenException('Company owner access is required');
  }
}
