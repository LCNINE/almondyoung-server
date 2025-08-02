import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseFilters,
  UsePipes,
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
  @UsePipes(new ZodValidationPipe(CreateSubscriptionRequestSchema))
  async createSubscription(
    @Body() createSubscriptionDto: CreateSubscriptionRequest,
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
  @UsePipes(new ZodValidationPipe(UpgradeSubscriptionRequestSchema))
  async upgradeSubscription(
    @Body() upgradeSubscriptionDto: UpgradeSubscriptionRequest,
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
  @UsePipes(new ZodValidationPipe(DowngradeSubscriptionRequestSchema))
  async downgradeSubscription(
    @Body() downgradeSubscriptionDto: DowngradeSubscriptionRequest,
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
  @UsePipes(new ZodValidationPipe(CancelSubscriptionRequestSchema))
  async cancelSubscription(
    @Body() cancelSubscriptionDto: CancelSubscriptionRequest,
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

  // TODO: 일시정지/재개 기능은 다음 태스크에서 구현
}
