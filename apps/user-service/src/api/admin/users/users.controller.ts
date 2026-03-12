import { RequireScopes } from '@app/authorization';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UpdateUserDto } from '../../users/dto/update-user.dto';
import { UserResponseDto } from '../../users/dto/user.response.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { UsersService } from './users.service';
import { UserConsent } from '../../consents/types/consent.type';

@ApiTags('사용자 관리')
@ApiBearerAuth('access-token')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequireScopes('master', 'admin:users:read')
  @ApiOperation({
    summary: '사용자 목록 조회',
    description: '사용자 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '사용자 목록 조회 성공',
    type: UserResponseDto,
    isArray: true,
  })
  async getUsers(@Query() query: GetUsersQueryDto) {
    return await this.usersService.getUsers(query);
  }

  @ApiOperation({ summary: '사용자 정보 수정' })
  @ApiResponse({ status: 200, description: '프로필 수정 성공' })
  @Patch(':userId')
  @RequireScopes('master', 'admin:users:modify')
  @HttpCode(HttpStatus.OK)
  async updateUser(
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const updatedUser = await this.usersService.updateUser(
      userId,
      updateUserDto,
    );

    if (!updatedUser) {
      throw new NotFoundException('해당 사용자를 찾을 수 없습니다.');
    }
    return updatedUser;
  }

  @Get('/consent/:userId')
  @RequireScopes('master', 'admin:users:read')
  @ApiOperation({
    summary: '해당 사용자 동의 정보 조회',
    description: '해당 사용자 동의 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description:
      '해당 사용자 동의 정보 조회 성공(null일시 해당 사용자가 아직 약간에 동의하지 않은 상태입니다.)',
  })
  async getUserConsent(
    @Param('userId') userId: string,
  ): Promise<UserConsent | null> {
    const consent = await this.usersService.getUserConsentByUserId(userId);

    return consent;
  }

  @Get('/consents')
  @RequireScopes('master', 'admin:users:read')
  @ApiOperation({
    summary: '모든 사용자 동의 정보 조회',
    description: '모든 사용자 동의 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '모든 사용자 동의 정보 조회 성공',
    isArray: true,
  })
  async getUserConsents(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('sortBy')
    sortBy: 'createdAt' | 'username' | 'email' | 'lastActivityAt' = 'createdAt',
    @Query('order') order: 'asc' | 'desc' = 'desc',
  ) {
    return await this.usersService.getUserConsents({
      page,
      limit,
      sortBy,
      order,
    });
  }
}
