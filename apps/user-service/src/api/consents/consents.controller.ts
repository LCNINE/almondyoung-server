import { AuthorizationGuard } from '@app/roles/guards/authorization-guard';
import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Post,
  UseGuards,
  Param,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { User } from 'apps/user-service/database/drizzle/schema';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { ConsentsService } from './consents.service';
import { CreateConsentDto } from './dto/consent-dto';
import { UserConsent } from './types/consent.type';

@ApiTags('동의 관리')
@Controller('consents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @ApiOperation({ summary: '사용자 동의 정보 조회' })
  @ApiResponse({
    status: 200,
    description: '사용자 동의 정보 조회 성공',
    type: CreateConsentDto,
  })
  @ApiResponse({
    status: 404,
    description: '사용자 동의 정보를 찾을 수 없음',
  })
  @Get()
  async getConsents(@CurrentUser() user: User): Promise<UserConsent | null> {
    return await this.consentsService.getUserConsent(user.id);
  }

  @ApiOperation({ summary: '사용자 동의 정보 생성' })
  @ApiResponse({
    status: 201,
    description: '사용자 동의 정보 생성 성공',
  })
  @Post()
  async createConsent(
    @CurrentUser() user: User,
    @Body() createConsentDto: CreateConsentDto,
  ): Promise<void> {
    return this.consentsService.createConsent(user.id, createConsentDto);
  }

  // notification-service용 API들 (인증 없이 접근 가능)
  @ApiOperation({ summary: '사용자 마케팅 동의 여부 조회 (notification-service용)' })
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
  async getUsersByCriteria(@Body() criteria: any) {
    return await this.consentsService.getUsersByCriteria(criteria);
  }
}
