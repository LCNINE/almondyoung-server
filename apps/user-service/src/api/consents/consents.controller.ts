import { RequireScopes, JwtPayload } from '@app/authorization';
import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConsentsService } from './consents.service';
import { CreateConsentDto, UpdateMarketingConsentDto } from './dto/consent-dto';
import { UserConsent } from './types/consent.type';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';

@ApiTags('동의 관리')
@Controller('consents')
@ApiBearerAuth('access-token')
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @ApiOperation({ summary: '내 동의 정보 조회' })
  @ApiResponse({
    status: 200,
    description: '내 동의 정보 조회 성공',
    type: CreateConsentDto,
  })
  @ApiResponse({
    status: 404,
    description: '내 동의 정보를 찾을 수 없음',
  })
  @Get()
  @RequireScopes('user:read')
  async getMyConsent(@CurrentUser() user: JwtPayload): Promise<UserConsent | null> {
    return await this.consentsService.getMyConsent(user.id);
  }

  @ApiOperation({ summary: '사용자 동의 정보 생성' })
  @ApiResponse({
    status: 201,
    description: '사용자 동의 정보 생성 성공',
  })
  @Post()
  @RequireScopes('user:modify')
  async createConsent(@CurrentUser() user: JwtPayload, @Body() createConsentDto: CreateConsentDto): Promise<void> {
    return this.consentsService.createConsent(user.id, createConsentDto);
  }

  @ApiOperation({ summary: '내 광고성 정보 수신 동의 변경' })
  @ApiResponse({ status: 200, description: '변경 결과와 처리 시각' })
  @ApiResponse({ status: 404, description: '동의 정보가 없음' })
  @Patch('marketing')
  @RequireScopes('user:modify')
  async updateMyMarketingConsent(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMarketingConsentDto,
  ): Promise<{ marketingConsent: boolean; changedAt: Date }> {
    return this.consentsService.updateMyMarketingConsent(user.id, dto);
  }

  // notification-service용 API들 (인증 없이 접근 가능)
  @ApiOperation({
    summary: '사용자 마케팅 동의 여부 조회 (notification-service용)',
  })
  @ApiResponse({
    status: 200,
    description: '마케팅 동의 여부 조회 성공',
    schema: {
      type: 'object',
      properties: {
        isMarketingEnabled: { type: 'boolean' },
      },
    },
  })
  @Get('marketing/:userId')
  @RequireScopes('master', 'admin:users:read')
  async getMarketingConsent(@Param('userId') userId: string): Promise<{ isMarketingEnabled: boolean }> {
    const isMarketingEnabled = await this.consentsService.getUserMarketingConsent(userId);
    return { isMarketingEnabled };
  }

  @ApiOperation({ summary: '사용자 프로필 조회 (notification-service용)' })
  @ApiResponse({
    status: 200,
    description: '사용자 프로필 조회 성공',
  })
  @Get('profile/:userId')
  @RequireScopes('master', 'admin:users:read')
  async getUserProfile(@Param('userId') userId: string) {
    const profile = await this.consentsService.getUserProfile(userId);
    if (!profile) {
      throw new NotFoundException('User profile not found');
    }
    return profile;
  }

  @ApiOperation({ summary: '조건별 사용자 목록 조회 (notification-service용)' })
  @ApiResponse({
    status: 200,
    description: '사용자 목록 조회 성공',
  })
  @Post('search')
  @RequireScopes('master', 'admin:users:read')
  async getUsersByCriteria(@Body() criteria: any) {
    return await this.consentsService.getUsersByCriteria(criteria);
  }
}
