import { RequirePermission, PiiResponse, PiiWrite } from '@app/authorization';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpdateUserDto } from '../../users/dto/update-user.dto';
import { AdminUserDetailResponseDto } from './dto/admin-user-detail.response.dto';
import { AdminUsersListResponseDto } from './dto/admin-users-list.response.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { UsersService } from './users.service';
import { UserConsent } from '../../consents/types/consent.type';
import { ServedTenantData } from '../../../tenancy/served-tenant.guard';

@ApiTags('사용자 관리')
@ApiBearerAuth('access-token')
@ServedTenantData()
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @PiiResponse({
    fields: { 'data[].username': 'name', 'data[].email': 'email', 'data[].phoneNumber': 'phone' },
    subjects: [{ path: 'data[].id', type: 'user' }],
  })
  @RequirePermission('customer.profile.read')
  @Get()
  @ApiOperation({
    summary: '사용자 목록 조회',
    description: '사용자 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '사용자 목록 조회 성공',
    type: AdminUsersListResponseDto,
  })
  async getUsers(@Query() query: GetUsersQueryDto) {
    return await this.usersService.getUsers(query);
  }

  @RequirePermission('customer.profile.read')
  @Get('stats/daily-signups')
  @ApiOperation({ summary: '일별 신규 가입자 수 — KST 달력일 귀속' })
  async getDailySignups(@Query() query: DateRangeQueryDto) {
    return this.usersService.getDailySignups(query.from, query.to);
  }

  @RequirePermission('customer.profile.read')
  @Get('consents')
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

  @RequirePermission('customer.profile.read')
  @Get('consent/:userId')
  @ApiOperation({
    summary: '해당 사용자 동의 정보 조회',
    description: '해당 사용자 동의 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '해당 사용자 동의 정보 조회 성공(null일시 해당 사용자가 아직 약관에 동의하지 않은 상태입니다.)',
  })
  async getUserConsent(@Param('userId') userId: string): Promise<UserConsent | null> {
    return await this.usersService.getUserConsentByUserId(userId);
  }

  @PiiResponse({
    fields: {
      username: 'name',
      email: 'email',
      'profile.phoneNumber': 'phone',
      // 주소는 객체로도 JSON 문자열로도 저장돼 있어 통째로 가린다.
      'profile.address': 'redact',
      'profile.birthDate': 'redact',
    },
    subjects: [{ path: 'id', type: 'user' }],
    reveal: true,
  })
  @RequirePermission('customer.profile.read')
  @Get(':userId')
  @ApiOperation({
    summary: '사용자 상세 정보 조회',
    description: '사용자 ID로 상세 정보를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '사용자 상세 정보 조회 성공',
    type: AdminUserDetailResponseDto,
  })
  async getUserById(@Param('userId') userId: string): Promise<AdminUserDetailResponseDto> {
    try {
      return await this.usersService.getUserById(userId);
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('찾을 수 없습니다')) throw new NotFoundException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }

  @ApiOperation({ summary: '사용자 정보 수정' })
  @ApiResponse({ status: 200, description: '프로필 수정 성공' })
  @PiiResponse({ fields: { username: 'name', email: 'email' }, subjects: [{ param: 'userId', type: 'user' }] })
  @PiiWrite({ fields: ['username', 'phoneNumber', 'address'] })
  @RequirePermission('customer.profile.write')
  @Patch(':userId')
  @HttpCode(HttpStatus.OK)
  async updateUser(@Param('userId') userId: string, @Body() updateUserDto: UpdateUserDto) {
    const updatedUser = await this.usersService.updateUser(userId, updateUserDto);

    if (!updatedUser) {
      throw new NotFoundException('해당 사용자를 찾을 수 없습니다.');
    }
    return updatedUser;
  }
}
