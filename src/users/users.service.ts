import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './entities/user.entity';
import { QueryParams } from './dto/query-params.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel('user') private userModel: Model<User>) { }


  async findAll({ page, take }: QueryParams) {
    take = Math.min(take, 30)
    const users = await this.userModel.find().sort({ _id: -1 }).skip((page - 1) * take).limit(page * take)
    const total = await this.userModel.countDocuments()
    return {
      users,
      total,
      page,
      take
    }
  }

  async findOne(id: string) {
    const user = await this.userModel.findById(id)
    if(!user) throw new BadRequestException('user not found')
    return user
  }

  async updateUser(requesterId: string, targetUserId: string, dto: UpdateUserDto) {
    const requester = await this.findOne(requesterId);
  
    if (requester.role !== 'admin' && requester._id.toString() !== targetUserId) {
      throw new ForbiddenException('You are not allowed to update this user');
    }
  
    return await this.userModel.findByIdAndUpdate(targetUserId, dto, { new: true });
  }
  
  async deleteUser(requesterId: string, targetUserId: string) {
    const requester = await this.findOne(requesterId);
  
    if (requester.role !== 'admin' && requester._id.toString() !== targetUserId) {
      throw new ForbiddenException('You are not allowed to delete this user');
    }
  
    return this.userModel.findByIdAndDelete(targetUserId);
  }
  
}
