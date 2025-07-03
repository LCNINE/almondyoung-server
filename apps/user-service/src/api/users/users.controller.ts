import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { User } from 'apps/user-service/database/drizzle/schema';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getMe(@CurrentUser() user: User) {
    // todo: 비즈프로필 join까지 같이
    return user;
  }

  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  async updateMe(
    @CurrentUser() user: User,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(user, updateUserDto);
  }
}
