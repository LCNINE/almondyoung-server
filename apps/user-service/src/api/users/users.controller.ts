import { RequireScopes, USER_SCOPES } from '@app/roles';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from 'apps/user-service/database/drizzle/schema';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { Public } from '../../commons/decorators/public.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * 사용자의 기본 정보를 조회합니다.
   * 민감한 정보는 제외된 기본 정보만 반환됩니다.
   */
  @Get(':id')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getUserInfo(@Param('id') id: string) {
    return this.usersService.findUserById(id);
  }

  /**
   * 사용자의 상세 정보를 조회합니다.
   * 기본 정보, 프로필, 상점 정보를 포함합니다.
   */
  @Get('/details')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes([USER_SCOPES.USER.READ, USER_SCOPES.MASTER])
  @HttpCode(HttpStatus.OK)
  async getUserDetails(
    @CurrentUser() user: User,
    @Query('userId') userId?: string,
  ) {
    return this.usersService.getUserDetails(userId ?? user.id);
  }

  /**
   * 사용자의 권한 정보를 조회합니다.
   * 역할과 스코프 정보를 포함합니다.
   */
  @Get('/roles/:userId')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async getUserRoles(
    @Query('userId') userId: string,
    @CurrentUser() user: User,
  ) {
    return this.usersService.getUserRoles(userId ?? user.id);
  }

  /**
   * 사용자 정보를 업데이트합니다.
   * 사용자명과 주소 정보를 수정할 수 있습니다.
   */
  @Patch(':userId')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes([USER_SCOPES.USER.UPDATE, USER_SCOPES.MASTER])
  @HttpCode(HttpStatus.OK)
  async updateUser(
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    await this.usersService.update(userId, updateUserDto);
    return;
  }

  /**
   * 이메일로 사용자 찾기
   * @Query email - 찾고자 하는 사용자의 이메일
   */
  @Get('find-by-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  async findUserByEmail(@Query('email') email: string) {
    return this.usersService.findUserByEmail(email);
  }

  /**
   * 현재 사용자의 정보를 조회합니다.
   * @param user - 현재 사용자의 정보
   * @returns 현재 사용자의 정보
   */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async getMe(@CurrentUser() user: User) {
    return this.usersService.retrieveMe(user.id);
  }
}
