import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseFilters,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import {
  CreateSubscriptionRequestSchema,
  CreateSubscriptionRequest,
  UpgradeSubscriptionRequestSchema,
  UpgradeSubscriptionRequest,
  DowngradeSubscriptionRequestSchema,
  DowngradeSubscriptionRequest,
  CancelSubscriptionRequestSchema,
  CancelSubscriptionRequest,
} from '../shared/schemas';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';

/**
 * 구독 관리 컨트롤러
 */
@Controller('subscriptions')
@UseFilters(SubscriptionExceptionFilter)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /**
   * 현재 구독 상태 조회
   */
  @Get('current')
  async getCurrentSubscription(@Query('userId') userId: string) {
    return this.subscriptionService.getCurrentSubscription(userId);
  }

  /**
   * 구독 생성
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSubscription(
    // ✅ 파이프를 @Body 파라미터에 직접 적용
    @Body(new ZodValidationPipe(CreateSubscriptionRequestSchema))
    createSubscriptionDto: CreateSubscriptionRequest,
    @Query('userId') userId: string,
  ) {
    return this.subscriptionService.createSubscription(
      userId,
      createSubscriptionDto.planId,
    );
  }

  /**
   * 구독 업그레이드
   */
  @Post('upgrade')
  @HttpCode(HttpStatus.CREATED) // 일관성을 위해 HttpCode 추가
  async upgradeSubscription(
    // ✅ 파이프를 @Body 파라미터에 직접 적용
    @Body(new ZodValidationPipe(UpgradeSubscriptionRequestSchema))
    upgradeSubscriptionDto: UpgradeSubscriptionRequest,
    @Query('userId') userId: string,
  ) {
    return this.subscriptionService.upgradeSubscription(
      userId,
      upgradeSubscriptionDto.newPlanId,
    );
  }

  /**
   * 구독 다운그레이드
   */
  @Post('downgrade')
  @HttpCode(HttpStatus.OK) // 다운그레이드는 즉시 생성되는 것이 아니므로 200 OK가 더 적합할 수 있습니다.
  async downgradeSubscription(
    // ✅ 파이프를 @Body 파라미터에 직접 적용
    @Body(new ZodValidationPipe(DowngradeSubscriptionRequestSchema))
    downgradeSubscriptionDto: DowngradeSubscriptionRequest,
    @Query('userId') userId: string,
  ) {
    return this.subscriptionService.downgradeSubscription(
      userId,
      downgradeSubscriptionDto.newPlanId,
    );
  }

  /**
   * 구독 취소
   */
  @Post('cancel')
  @HttpCode(HttpStatus.OK) // 취소도 200 OK가 더 적합합니다.
  async cancelSubscription(
    // ✅ 파이프를 @Body 파라미터에 직접 적용
    @Body(new ZodValidationPipe(CancelSubscriptionRequestSchema))
    cancelSubscriptionDto: CancelSubscriptionRequest,
    @Query('userId') userId: string,
  ) {
    return this.subscriptionService.cancelSubscription(
      userId,
      cancelSubscriptionDto.reason,
    );
  }

  /**
   * 구독 이력 조회
   */
  @Get('history')
  async getSubscriptionHistory(@Query('userId') userId: string) {
    return this.subscriptionService.getSubscriptionHistory(userId);
  }
}
