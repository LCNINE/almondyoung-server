import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseFilters,
  UsePipes,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RightsService } from './rights.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { z } from 'zod';

// 벌크 구독 확인 요청 스키마
const BulkCheckRequestSchema = z.object({
  userIds: z
    .array(z.string().uuid('유효한 UUID 형식이어야 합니다'))
    .min(1, '최소 1개의 사용자 ID가 필요합니다')
    .max(100, '최대 100개의 사용자 ID만 허용됩니다'),
});

// 권한 검증 요청 스키마
const ValidateRightsRequestSchema = z.object({
  userId: z.string().uuid('유효한 UUID 형식이어야 합니다'),
  requiredTierLevel: z.number().min(1).max(100).optional(),
});

type BulkCheckRequest = z.infer<typeof BulkCheckRequestSchema>;
type ValidateRightsRequest = z.infer<typeof ValidateRightsRequestSchema>;

/**
 * 권한 관리 컨트롤러
 * 사용자 권한 검증 및 벌크 구독 확인 API
 */
@Controller('rights')
@UseFilters(SubscriptionExceptionFilter)
export class RightsController {
  constructor(private readonly rightsService: RightsService) {}

  /**
   * 사용자 권한 조회
   */
  @Get('user/:userId')
  async getUserRights(@Param('userId') userId: string) {
    return this.rightsService.getUserRights(userId);
  }

  /**
   * 사용자 권한 검증
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(ValidateRightsRequestSchema))
  async validateUserRights(@Body() request: ValidateRightsRequest) {
    const isValid = await this.rightsService.validateUserRights(
      request.userId,
      request.requiredTierLevel,
    );

    return {
      userId: request.userId,
      isValid,
      requiredTierLevel: request.requiredTierLevel,
      validatedAt: new Date().toISOString(),
    };
  }

  /**
   * 벌크 구독 확인
   */
  @Post('bulk-check')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(BulkCheckRequestSchema))
  async bulkCheckSubscriptions(@Body() request: BulkCheckRequest) {
    const results = await this.rightsService.bulkCheckSubscriptions(
      request.userIds,
    );

    return {
      results,
      checkedAt: new Date().toISOString(),
      totalUsers: request.userIds.length,
      activeSubscriptions: Object.values(results).filter(
        (result) => result.hasActiveSubscription,
      ).length,
    };
  }

  /**
   * 권한 연장 (관리자용)
   */
  @Post('extend')
  @HttpCode(HttpStatus.OK)
  async extendUserRights(
    @Body()
    request: {
      userId: string;
      additionalDays: number;
      reason: string;
    },
    @Query('adminId') adminId: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    await this.rightsService.extendUserRights(
      request.userId,
      request.additionalDays,
      request.reason,
    );

    return {
      success: true,
      message: `사용자 ${request.userId}의 권한이 ${request.additionalDays}일 연장되었습니다.`,
      extendedBy: adminId,
      extendedAt: new Date().toISOString(),
    };
  }

  /**
   * 권한 종료 (관리자용)
   */
  @Post('terminate')
  @HttpCode(HttpStatus.OK)
  async terminateUserRights(
    @Body()
    request: {
      userId: string;
      reason: string;
    },
    @Query('adminId') adminId: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    await this.rightsService.terminateUserRights(
      request.userId,
      request.reason,
    );

    return {
      success: true,
      message: `사용자 ${request.userId}의 권한이 종료되었습니다.`,
      terminatedBy: adminId,
      terminatedAt: new Date().toISOString(),
      reason: request.reason,
    };
  }

  /**
   * 권한 일시정지 (관리자용)
   */
  @Post('pause')
  @HttpCode(HttpStatus.OK)
  async pauseUserRights(
    @Body()
    request: {
      userId: string;
      pausedAt?: string;
    },
    @Query('adminId') adminId: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    const pausedAt = request.pausedAt ? new Date(request.pausedAt) : new Date();

    await this.rightsService.pauseUserRights(request.userId, pausedAt);

    return {
      success: true,
      message: `사용자 ${request.userId}의 권한이 일시정지되었습니다.`,
      pausedBy: adminId,
      pausedAt: pausedAt.toISOString(),
    };
  }

  /**
   * 권한 재개 (관리자용)
   */
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  async resumeUserRights(
    @Body()
    request: {
      userId: string;
      newEndsAt?: string;
    },
    @Query('adminId') adminId: string,
  ) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    const newEndsAt = request.newEndsAt
      ? new Date(request.newEndsAt)
      : undefined;

    await this.rightsService.resumeUserRights(request.userId, newEndsAt);

    return {
      success: true,
      message: `사용자 ${request.userId}의 권한이 재개되었습니다.`,
      resumedBy: adminId,
      resumedAt: new Date().toISOString(),
      newEndsAt: newEndsAt?.toISOString(),
    };
  }

  /**
   * 권한 통계 조회 (관리자용)
   */
  @Get('stats')
  async getRightsStats(@Query('adminId') adminId: string) {
    // TODO: 실제 구현 시 JWT에서 adminId 추출 및 권한 확인
    // 현재는 간단한 통계만 반환
    return {
      message: '권한 통계 기능은 추후 구현 예정입니다.',
      requestedBy: adminId,
      requestedAt: new Date().toISOString(),
    };
  }
}
