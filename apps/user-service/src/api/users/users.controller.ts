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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { User } from 'apps/user-service/database/drizzle/schema';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { Public } from '../../commons/decorators/public.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: '사용자 기본 정보 조회' })
  @ApiResponse({ status: 200, description: '사용자 기본 정보 조회 성공' })
  @ApiParam({ name: 'id', description: '사용자 ID' })
  @Get(':id')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getUserInfo(@Param('id') id: string) {
    return this.usersService.findUserById(id);
  }

  @ApiOperation({ summary: '사용자 상세 정보 조회' })
  @ApiResponse({ status: 200, description: '사용자 상세 정보 조회 성공' })
  @ApiQuery({
    name: 'userId',
    description: '조회할 사용자 ID',
    required: false,
  })
  @ApiBearerAuth()
  @Get('/details')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes(['user:read', 'master'])
  @HttpCode(HttpStatus.OK)
  async getUserDetails(
    @CurrentUser() user: User,
    @Query('userId') userId?: string,
  ) {
    return this.usersService.getUserDetails(userId ?? user.id);
  }

  @ApiOperation({ summary: '사용자 권한 정보 조회' })
  @ApiResponse({ status: 200, description: '사용자 권한 정보 조회 성공' })
  @ApiParam({ name: 'userId', description: '사용자 ID' })
  @ApiBearerAuth()
  @Get('/roles/:userId')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async getUserRoles(
    @Query('userId') userId: string,
    @CurrentUser() user: User,
  ) {
    return this.usersService.getUserRoles(userId ?? user.id);
  }

  @ApiOperation({ summary: '사용자 정보 수정' })
  @ApiResponse({ status: 200, description: '사용자 정보 수정 성공' })
  @ApiParam({ name: 'userId', description: '수정할 사용자 ID' })
  @ApiBearerAuth()
  @Patch(':userId')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes(['users:update', 'master'])
  @HttpCode(HttpStatus.OK)
  async updateUser(
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    await this.usersService.update(userId, updateUserDto);
    return;
  }

  @ApiOperation({ summary: '이메일로 사용자 찾기' })
  @ApiResponse({ status: 200, description: '사용자 조회 성공' })
  @ApiQuery({ name: 'email', description: '찾고자 하는 사용자의 이메일' })
  @Get('find-by-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  async findUserByEmail(@Query('email') email: string) {
    return this.usersService.findUserByEmail(email);
  }

  @ApiOperation({ summary: '현재 사용자 정보 조회' })
  @ApiResponse({ status: 200, description: '현재 사용자 정보 조회 성공' })
  @ApiBearerAuth()
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async getMe(@CurrentUser() user: User) {
    return this.usersService.retrieveMe(user.id);
  }
}
