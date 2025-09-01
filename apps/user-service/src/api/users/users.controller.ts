import { AuthorizationGuard, RequireScopes } from '@app/roles';
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
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { Public } from '../../constants/public.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDetailsResponseDto } from './dto/user-details.response.dto';
import { UserRolesResponse } from './dto/user-role-scopes.response.dto';
import { UserResponseDto } from './dto/user.response.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
  @Get('/details')
  @RequireScopes(['user:read', 'master'])
  @HttpCode(HttpStatus.OK)
  async getUserDetails(
    @CurrentUser() user: User,
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
  @ApiParam({ name: 'userId', description: '사용자 ID' })
  @Get('/roles/:userId')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(['user:read', 'master'])
  async getUserRoles(@CurrentUser() user: User) {
    return this.usersService.getUserRoles(user.id);
  }

  @ApiOperation({ summary: '사용자 정보 수정' })
  @ApiResponse({ status: 200, description: '사용자 정보 수정 성공' })
  @ApiParam({ name: 'userId', description: '수정할 사용자 ID' })
  @Patch(':userId')
  @RequireScopes(['user:update', 'master'])
  @HttpCode(HttpStatus.OK)
  async updateUser(
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    await this.usersService.update(userId, updateUserDto);
    return;
  }

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

  @ApiOperation({ summary: '현재 사용자 정보 조회' })
  @ApiResponse({ status: 200, description: '현재 사용자 정보 조회 성공' })
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@CurrentUser() user: User) {
    return this.usersService.retrieveMe(user.id);
  }
}
