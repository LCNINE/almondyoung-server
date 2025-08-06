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
    .array(z.uuid('유효한 UUID 형식이어야 합니다'))
    .min(1, '최소 1개의 사용자 ID가 필요합니다')
    .max(100, '최대 100개의 사용자 ID만 허용됩니다'),
});

// 권한 검증 요청 스키마
const ValidateRightsRequestSchema = z.object({
  userId: z.uuid('유효한 UUID 형식이어야 합니다'),
  requiredTierLevel: z.number().min(1).max(100).optional(),
});

type BulkCheckRequest = z.infer<typeof BulkCheckRequestSchema>;
type ValidateRightsRequest = z.infer<typeof ValidateRightsRequestSchema>;

/**
 * 권한 조회 컨트롤러
 * 사용자 권한 검증 및 벌크 구독 확인 API (사용자/시스템용)
 * 관리자용 권한 관리는 AdminOperationsController에서 처리
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
}
