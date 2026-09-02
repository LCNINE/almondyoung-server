import { RequireScopes, JwtPayload } from '@app/authorization';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from 'apps/user-service/database/drizzle/schema';
import { Public } from '../../commons/decorator/public.decorator';
import { InternalApiKeyGuard } from '../../commons/guards/internal-api-key.guard';
import { InternalContactsRequestDto } from './dto/internal-contacts.request.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRolesResponse } from './dto/user-role-scopes.response.dto';
import { UserResponseDto } from './dto/user.response.dto';
import { UserDetailsResponseDto } from './dto/user-details.response.dto';
import { UsersService } from './users.service';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: '이메일로 사용자 찾기' })
  @ApiResponse({
    status: 200,
    description: '사용자 조회 성공',
    type: UserResponseDto,
  })
  @ApiQuery({ name: 'email', description: '찾고자 하는 사용자의 이메일' })
  @Get('find-by-email')
  // 이메일 하나로 loginId·실명이 나오므로 공개하면 익명 열거가 된다.
  // 유일한 호출자는 어드민 "주문 수동입력 > 고객 검색"이고, 같은 화면의 /admin/users/:id 와 동일 스코프.
  // 사전 중복확인이 필요한 가입 폼은 boolean 만 주는 email-available 을 쓴다.
  @RequireScopes('master', 'admin:users:read')
  @HttpCode(HttpStatus.OK)
  async findUserByEmail(@Query('email') email: string) {
    return this.usersService.findUserByEmail(email);
  }

  @ApiOperation({
    summary: '이메일 가입 가능 여부 확인',
    description: '회원가입 폼의 사전 중복 체크용. 사용자 정보(PII)를 노출하지 않고 가입 가능 여부만 반환한다.',
  })
  @ApiResponse({
    status: 200,
    description: 'available=true 면 가입 가능(미사용), false 면 이미 사용 중',
  })
  @ApiQuery({ name: 'email', description: '확인할 이메일' })
  @Get('email-available')
  @Public()
  @HttpCode(HttpStatus.OK)
  async checkEmailAvailable(@Query('email') email: string): Promise<{ available: boolean }> {
    const normalized = (email ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('이메일을 입력해주세요.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException('올바른 이메일 형식이 아닙니다.');
    }
    const available = await this.usersService.isEmailAvailable(normalized);
    return { available };
  }

  @ApiOperation({
    summary: '로그인 ID 가입 가능 여부 확인',
    description: '회원가입 폼의 사전 중복 체크용. 사용자 정보(PII)를 노출하지 않고 가입 가능 여부만 반환한다.',
  })
  @ApiResponse({
    status: 200,
    description: 'available=true 면 가입 가능(미사용), false 면 이미 사용 중',
  })
  @ApiQuery({ name: 'loginId', description: '확인할 로그인 ID' })
  @Get('login-id-available')
  @Public()
  @HttpCode(HttpStatus.OK)
  async checkLoginIdAvailable(@Query('loginId') loginId: string): Promise<{ available: boolean }> {
    const normalized = (loginId ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('아이디를 입력해주세요.');
    }
    // 가입 폼과 같은 규칙. 형식이 틀린 값으로 존재 여부를 캐는 조회를 막는 역할도 겸한다.
    if (!/^[a-z0-9]{4,20}$/.test(normalized)) {
      throw new BadRequestException('아이디는 영문 소문자와 숫자만, 4~20자로 입력해주세요.');
    }
    const available = await this.usersService.isLoginIdAvailable(normalized);
    return { available };
  }

  @ApiOperation({
    summary: '닉네임 가입 가능 여부 확인',
    description: '회원가입 폼의 사전 중복 체크용. 사용자 정보(PII)를 노출하지 않고 가입 가능 여부만 반환한다.',
  })
  @ApiResponse({
    status: 200,
    description: 'available=true 면 가입 가능(미사용), false 면 이미 사용 중',
  })
  @ApiQuery({ name: 'nickname', description: '확인할 닉네임' })
  @Get('nickname-available')
  @Public()
  @HttpCode(HttpStatus.OK)
  async checkNicknameAvailable(@Query('nickname') nickname: string): Promise<{ available: boolean }> {
    const normalized = (nickname ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('닉네임을 입력해주세요.');
    }
    // 가입 폼(BaseSignUpDto)과 같은 길이 규칙.
    if (normalized.length < 2 || normalized.length > 8) {
      throw new BadRequestException('닉네임은 2~8자로 입력해주세요.');
    }
    const available = await this.usersService.isNicknameAvailable(normalized);
    return { available };
  }

  @ApiOperation({ summary: '사용자 권한 정보 조회' })
  @ApiResponse({
    status: 200,
    description: '사용자 권한 정보 조회 성공',
    type: UserRolesResponse,
  })
  @Get('roles')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('user:read', 'master', 'admin:users:read')
  async getUserRoles(@CurrentUser() user: JwtPayload) {
    return this.usersService.getUserRoles(user.id);
  }

  @ApiOperation({ summary: '현재 사용자 정보 조회' })
  @ApiResponse({
    status: 200,
    description: '현재 사용자 정보 조회 성공',
    type: UserResponseDto,
  })
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@CurrentUser() user: JwtPayload): Promise<UserResponseDto> {
    return this.usersService.findActiveUserById(user.id);
  }

  @ApiOperation({ summary: '현재 사용자 프로필 상세 조회 (전화번호, 주소, 상점 정보 포함)' })
  @ApiResponse({
    status: 200,
    description: '프로필 상세 조회 성공',
    type: UserDetailsResponseDto,
  })
  @Get('me/profile')
  @HttpCode(HttpStatus.OK)
  async getMyProfile(@CurrentUser() user: JwtPayload): Promise<UserDetailsResponseDto> {
    return this.usersService.getUserDetails(user.id);
  }

  @ApiOperation({ summary: '내 프로필 정보 수정' })
  @ApiResponse({ status: 200, description: '프로필 수정 성공' })
  @Patch('me')
  @RequireScopes('user:modify', 'master')
  @HttpCode(HttpStatus.OK)
  async updateMyProfile(@CurrentUser() user: JwtPayload, @Body() updateUserDto: UpdateUserDto) {
    await this.usersService.updateMyProfile(user.id, updateUserDto);
    return;
  }

  // ===== Internal Endpoints (서버 간 호출 전용) =====

  @ApiOperation({
    summary: '[Internal] userId 묶음으로 알림 발송용 연락처 조회',
    description:
      '크론성 알림(멤버십 갱신 사전 고지 등)이 userId 만 들고 이메일을 얻기 위한 경로. ' +
      'Authorization: Bearer ${USER_SERVICE_INTERNAL_KEY} 필요.',
  })
  @Post('internal/contacts')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async getInternalContacts(
    @Body() body: InternalContactsRequestDto,
  ): Promise<{ userId: string; email: string; username: string }[]> {
    return this.usersService.findContactsByIds(body.userIds);
  }

  // `GET /users/:id` 는 제거됐다. 유일한 호출자였던 storefront 가입 콜백이 사라졌고,
  // Tempo 트레이스상 7일간 호출 0건이었다. 사용자 단건 조회가 다시 필요하면
  // 본인은 /users/me, 어드민은 /admin/users/:id 를 쓴다.
  // (UsersService.findUserById 는 OIDC·인증 등 13곳에서 쓰이므로 그대로 남아있다.)
}
