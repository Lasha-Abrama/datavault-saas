import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryParams } from './dto/query-params.dto';
import { IsValidMongoDBId } from './dto/is-valid-objectID.dto';
import { IsAuthGuard } from 'src/guards/is-auth.guard';
import { IsAdminGuard } from 'src/guards/is-admin.guard';
import { UserId } from 'src/decorators/user.decorator';

@UseGuards(IsAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @UseGuards(IsAdminGuard)
  @Get()
  findAll(@Query() { page, take }: QueryParams) {
    return this.usersService.findAll({ page, take });
  }

  @Get(':id')
  findOne(@Param() { id }: IsValidMongoDBId) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(
    @UserId() requesterId: string,
    @Param() { id }: IsValidMongoDBId,
    @Body() updateUserDto: UpdateUserDto
  ) {
    return this.usersService.updateUser(requesterId, id, updateUserDto);
  }

  @Delete(':id')
  remove(
    @UserId() requesterId: string,
    @Param() { id }: IsValidMongoDBId
  ) {
    return this.usersService.deleteUser(requesterId, id);
  }
}
