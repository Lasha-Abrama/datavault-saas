import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/entities/user.entity';
import { GoogleUser } from './auth.types';
import * as bcrypt from 'bcryptjs';
import { isDuplicateKeyError } from '../users/database-errors';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel('user') private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
  ) {}

  async signIn({ email, password }: SignInDto) {
    const user = await this.userModel.findOne({ email }).select('+password');
    if (!user?.password || !(await bcrypt.compare(password, user.password)))
      throw new UnauthorizedException('Invalid credentials');
    return {
      accessToken: await this.jwtService.signAsync({
        id: user._id.toString(),
        role: user.role,
      }),
    };
  }

  async signInWithGoogle(user: GoogleUser) {
    let existing = await this.userModel.findOne({ email: user.email });
    if (!existing) {
      try {
        existing = await this.userModel.create(user);
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        existing = await this.userModel.findOne({ email: user.email });
        if (!existing) throw error;
      }
    }
    existing.avatar = user.avatar;
    await existing.save();
    return this.jwtService.signAsync({
      id: existing._id.toString(),
      role: existing.role,
    });
  }

  async signUp({ email, fullName, password }: SignUpDto) {
    if (await this.userModel.exists({ email }))
      throw new ConflictException('User already exists');
    try {
      await this.userModel.create({
        email,
        password: await bcrypt.hash(password, 10),
        fullName,
      });
    } catch (error) {
      if (isDuplicateKeyError(error))
        throw new ConflictException('User already exists');
      throw error;
    }
    return 'user created successfully';
  }

  async getCurrentUser(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
