import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { JwtService } from '@nestjs/jwt';
import { Role } from 'src/enums/roles.enum';
import { User } from 'src/users/entities/user.entity';
import * as bcrypt from 'bcrypt'

@Injectable()
export class AuthService {
  constructor(
    @InjectModel('user') private userModel: Model<User>,
    private jwtService: JwtService
  ) { }

  async signIn({ email, password }: SignInDto) {
    const existUser = await this.userModel.findOne({ email }).select('+password')
    if (!existUser) throw new BadRequestException('Invalid Credentials')

    const isPassedEqual = await bcrypt.compare(password, existUser.password)
    if (!isPassedEqual) throw new BadRequestException('Invalid Credentials')

    const payLoad = {
      id: existUser._id,
      role: existUser.role
    }

    const accessToken = await this.jwtService.sign(payLoad, { expiresIn: '1h' })

    return { accessToken }
  }

  async signInWithGoogle(user){
    let existsUser = await this.userModel.findOne({email: user.email})
    if(!existsUser){
      existsUser = await this.userModel.create({
        email: user.email,
        avatar: user.avatar,
        fullName: user.fullName
      })
    }
    existsUser.avatar = user.avatar
    await existsUser.save()
    
    const payLoad = {
      id: existsUser._id,
      role: existsUser.role
    }
    const accessToken = await this.jwtService.sign(payLoad, { expiresIn: '1h' })
    return accessToken
  }

  async signUp({ email, fullName, password }: SignUpDto) {
    const existUser = await this.userModel.findOne({ email: email })
    if (existUser) throw new BadRequestException('User Already exists')

    const hashedPass = await bcrypt.hash(password, 10)
    await this.userModel.create({ email,password: hashedPass, fullName })
    return 'user created successfully'
  }

  async getCurrentUser(userId: string) {
    return await this.userModel.findById(userId)
  }
}