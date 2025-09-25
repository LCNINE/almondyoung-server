import {
  Controller,
  Get,
  Post,
  Body,
  UseFilters,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
// import { AuthGuard } from '@nestjs/passport'; // 실제 AuthGuard 대신 DevAuthGuard를 사용합니다.
import { DevAuthGuard } from '../auth/dev-auth.guard'; // 🚨 개발용 임시 가드
import { SubscriptionService } from '../services/subscription.service';
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
import { PolicyGuard } from '../services/policy/policy.guard';
import { CheckPolicies } from '../services/policy/policy.decorator';
import { FastifyRequest } from 'fastify';
/**
 * 구독 관리 컨트롤러
 * 🚨 [주의] 현재 개발용 임시 인증 가드(DevAuthGuard)를 사용하고 있습니다.
 * 실제 프로덕션 배포 전 반드시 실제 인증 가드(AuthGuard('jwt'))로 교체해야 합니다.
 */
@Controller('subscriptions')
@UseFilters(SubscriptionExceptionFilter)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /**
   * 현재 구독 상태 조회
   */
  @Get('current')
  // @UseGuards(DevAuthGuard) // 🚨 임시로 비활성화
  async getCurrentSubscriptionDetails(@Req() req: FastifyRequest) {
    // 임시로 쿼리 파라미터에서 userId 가져오기
    const userId = (req.query as any).userId || 'test_user_001';
    return this.subscriptionService.getCurrentSubscriptionDetails(userId);
  }
  /**
   * 구독 생성
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // @UseGuards(DevAuthGuard) // 🚨 임시로 비활성화
  async createSubscription(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(CreateSubscriptionRequestSchema))
    createSubscriptionDto: CreateSubscriptionRequest,
  ) {
    // 임시로 쿼리 파라미터에서 userId 가져오기
    const userId = (req.query as any).userId || 'test_user_001';
    return this.subscriptionService.createSubscription(
      userId,
      createSubscriptionDto.planId,
    );
  }

  /**
   * 구독 업그레이드
   */
  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevAuthGuard, PolicyGuard) // 🚨 임시 가드 사용
  @CheckPolicies('CHANGE_PLAN')
  async upgradeSubscription(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(UpgradeSubscriptionRequestSchema))
    upgradeSubscriptionDto: UpgradeSubscriptionRequest,
  ) {
    const userId = req.user!.userId;
    return this.subscriptionService.upgradeSubscription(
      userId,
      upgradeSubscriptionDto.newPlanId,
    );
  }

  /**
   * 구독 다운그레이드
   */
  @Post('downgrade')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevAuthGuard, PolicyGuard) // 🚨 임시 가드 사용
  @CheckPolicies('CHANGE_PLAN')
  async downgradeSubscription(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(DowngradeSubscriptionRequestSchema))
    downgradeSubscriptionDto: DowngradeSubscriptionRequest,
  ) {
    const userId = req.user!.userId;
    // 참고: 서비스 로직에 downgradeSubscription 메소드가 필요합니다.
    return this.subscriptionService.upgradeSubscription(
      userId,
      downgradeSubscriptionDto.newPlanId,
    );
  }

  /**
   * 구독 취소
   */
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevAuthGuard, PolicyGuard) // 🚨 임시 가드 사용
  @CheckPolicies('CANCEL_SUBSCRIPTION')
  async cancelSubscription(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(CancelSubscriptionRequestSchema))
    cancelSubscriptionDto: CancelSubscriptionRequest,
  ) {
    const userId = req.user!.userId;
    return this.subscriptionService.cancelSubscription(
      userId,
      cancelSubscriptionDto.reason,
    );
  }

  /**
   * 구독 이력 조회
   */
  @Get('history')
  @UseGuards(DevAuthGuard) // 🚨 임시 가드 사용
  async getSubscriptionHistory(@Req() req: FastifyRequest) {
    const userId = req.user!.userId;
    return this.subscriptionService.getSubscriptionHistory(userId);
  }
}
