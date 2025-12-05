import { AuthorizationGuard, JwtPayload, RequireScopes } from '@app/roles';
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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { User } from 'apps/user-service/database/drizzle/schema';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { Public } from '../../commons/decorator/public.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDetailsResponseDto } from './dto/user-details.response.dto';
import { UserRolesResponse } from './dto/user-role-scopes.response.dto';
import { UserResponseDto } from './dto/user.response.dto';
import { UsersService } from './users.service';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @ApiOperation({ summary: '이메일로 사용자 찾기' })
  @ApiResponse({
    status: 200,
    description: '사용자 조회 성공',
    type: UserResponseDto,
  })
  @ApiQuery({ name: 'email', description: '찾고자 하는 사용자의 이메일' })
  @Get('find-by-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  async findUserByEmail(@Query('email') email: string) {
    return this.usersService.findUserByEmail(email);
  }

  @ApiOperation({ summary: '사용자 상세 정보 조회' })
  @ApiResponse({
    status: 200,
    description: '사용자 상세 정보 조회 성공',
    type: UserDetailsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자를 찾을 수 없습니다.',
  })
  @ApiResponse({
    status: 500,
    description: '사용자 상세 정보를 불러오는 중 오류가 발생했습니다.',
  })
  @ApiQuery({
    name: 'userId',
    description: '조회할 사용자 ID',
    required: false,
  })
  @Get('detail')
  @RequireScopes(['user:read', 'master', 'admin:users:read'])
  @HttpCode(HttpStatus.OK)
  async getUserDetails(
    @CurrentUser() user: JwtPayload,
    @Query('userId') userId?: string,
  ): Promise<UserDetailsResponseDto> {
    return this.usersService.getUserDetails(userId ?? user.id);
  }

  @ApiOperation({ summary: '사용자 권한 정보 조회' })
  @ApiResponse({
    status: 200,
    description: '사용자 권한 정보 조회 성공',
    type: UserRolesResponse,
  })
  @Get('roles')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(['user:read', 'master', 'admin:users:read'])
  async getUserRoles(@CurrentUser() user: JwtPayload) {
    return this.usersService.getUserRoles(user.id);
  }

  @ApiOperation({ summary: '현재 사용자 정보 조회' })
  @ApiResponse({ status: 200, description: '현재 사용자 정보 조회 성공' })
  @Get('me')
  @RequireScopes(['user:read', 'master', 'admin:users:read'])
  @HttpCode(HttpStatus.OK)
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.retrieveMe(user.id);
  }

  @ApiOperation({ summary: '내 프로필 정보 수정' })
  @ApiResponse({ status: 200, description: '프로필 수정 성공' })
  @Patch('me')
  @RequireScopes(['user:modify', 'master'])
  @HttpCode(HttpStatus.OK)
  async updateMyProfile(
    @CurrentUser() user: JwtPayload,
    @Body() updateUserDto: UpdateUserDto,
  ) {

    await this.usersService.updateMyProfile(user.id, updateUserDto);
    return;
  }

  @ApiOperation({ summary: '사용자 기본 정보 조회' })
  @ApiResponse({
    status: 200,
    description: '사용자 기본 정보 조회 성공',
    type: UserResponseDto,
  })
  @ApiParam({ name: 'id', description: '사용자 ID' })
  @Get(':id')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getUserInfo(@Param('id') id: string) {
    return this.usersService.findUserById(id);
  }
}
