import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { QueryParams } from './dto/query-params.dto';
import { Role } from '../enums/roles.enum';
import { isDuplicateKeyError } from './database-errors';

@Injectable()
export class UsersService {
  constructor(@InjectModel('user') private readonly userModel: Model<User>) {}

  async findAll({ page, take }: QueryParams) {
    take = Math.min(take, 30);
    const users = await this.userModel
      .find()
      .sort({ _id: -1 })
      .skip((page - 1) * take)
      .limit(take);
    const total = await this.userModel.countDocuments();
    return { users, total, page, take };
  }

  async findOne(id: string) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findOneForRequester(requesterId: string, targetUserId: string) {
    await this.authorize(requesterId, targetUserId);
    return this.findOne(targetUserId);
  }

  async updateUser(
    requesterId: string,
    targetUserId: string,
    dto: UpdateUserDto,
  ) {
    await this.authorize(requesterId, targetUserId);
    // Explicitly allow editable fields, even when invoked outside the HTTP layer.
    const update: UpdateUserDto = {};
    if (dto.email !== undefined) update.email = dto.email;
    if (dto.fullName !== undefined) update.fullName = dto.fullName;
    if (dto.password !== undefined)
      update.password = await bcrypt.hash(dto.password, 10);
    try {
      const user = await this.userModel.findByIdAndUpdate(
        targetUserId,
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

  async deleteUser(requesterId: string, targetUserId: string) {
    await this.authorize(requesterId, targetUserId);
    const user = await this.userModel.findByIdAndDelete(targetUserId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async authorize(requesterId: string, targetUserId: string) {
    const requester = await this.findOne(requesterId);
    if (
      requester.role !== Role.ADMIN &&
      requester._id.toString() !== targetUserId.toLowerCase()
    )
      throw new ForbiddenException('You are not allowed to modify this user');
  }
}
