import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { GoogleUser } from './auth.types';
import * as bcrypt from 'bcryptjs';
import {
  duplicateKeyField,
  isDuplicateKeyError,
} from '../users/database-errors';
import { Role } from '../enums/roles.enum';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel('user') private readonly userModel: Model<User>,
    @InjectModel('company') private readonly companyModel: Model<Company>,
    @InjectConnection() private readonly connection: Connection,
    private readonly jwtService: JwtService,
  ) {}

  async signIn({ email, password }: SignInDto) {
    const user = await this.userModel.findOne({ email }).select('+password');
    if (!user?.password || !(await bcrypt.compare(password, user.password)))
      throw new UnauthorizedException('Invalid credentials');
    return { accessToken: await this.signToken(user) };
  }

  async signInWithGoogle(profile: GoogleUser) {
    const user = await this.userModel.findOne({ email: profile.email });
    if (!user)
      throw new UnauthorizedException(
        'No account is registered for this Google identity',
      );
    user.avatar = profile.avatar;
    await user.save();
    return this.signToken(user);
  }

  async signUp({ email, fullName, password, companyName }: SignUpDto) {
    try {
      const user = await this.connection.transaction(async (session) => {
        const [company] = await this.companyModel.create(
          [{ name: companyName }],
          { session },
        );
        const [owner] = await this.userModel.create(
          [
            {
              email,
              password: await bcrypt.hash(password, 10),
              fullName,
              companyId: company._id,
              role: Role.COMPANY_OWNER,
            },
          ],
          { session },
        );
        return owner;
      });
      return { accessToken: await this.signToken(user) };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        if (duplicateKeyField(error) === 'email')
          throw new ConflictException('Email is already in use');
        if (duplicateKeyField(error) === 'name')
          throw new ConflictException('Company name is already in use');
        throw new ConflictException('Company or user already exists');
      }
      throw error;
    }
  }

  async getCurrentUser(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async signToken(user: User & { _id: Types.ObjectId }) {
    if (
      !(user.companyId instanceof Types.ObjectId) ||
      !Object.values(Role).includes(user.role)
    )
      throw new UnauthorizedException('User is not assigned to a company');
    return this.jwtService.signAsync({ id: user._id.toString() });
  }
}
