import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryParams } from './dto/query-params.dto';
import { IsValidMongoDBId } from './dto/is-valid-objectID.dto';
import { IsAuthGuard } from '../guards/is-auth.guard';
import { IsAdminGuard } from '../guards/is-admin.guard';
import { UserId } from '../decorators/user.decorator';

@UseGuards(IsAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(IsAdminGuard)
  @Get()
  findAll(@Query() { page, take }: QueryParams) {
    return this.usersService.findAll({ page, take });
  }

  @Get(':id')
  findOne(@UserId() requesterId: string, @Param() { id }: IsValidMongoDBId) {
    return this.usersService.findOneForRequester(requesterId, id);
  }

  @Patch(':id')
  update(
    @UserId() requesterId: string,
    @Param() { id }: IsValidMongoDBId,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(requesterId, id, updateUserDto);
  }

  @Delete(':id')
  remove(@UserId() requesterId: string, @Param() { id }: IsValidMongoDBId) {
    return this.usersService.deleteUser(requesterId, id);
  }
}
