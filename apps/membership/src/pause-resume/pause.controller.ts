import {
  Controller,
  Post,
  Get,
  Body,
  UseFilters,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { PauseService } from './pause.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { DevAuthGuard } from '../auth/dev-auth.guard'; // 🚨 개발용 임시 가드
import { PolicyGuard } from '../policy-management/policy.guard';
import { CheckPolicies } from '../policy-management/policy.decorator';
import {
  PauseSubscriptionRequestSchema,
  PauseSubscriptionRequest,
  ResumeSubscriptionRequestSchema,
  ResumeSubscriptionRequest,
} from '../shared/schemas';
import { FastifyRequest } from 'fastify';

/**
 * 일시정지 관리 컨트롤러
 * 🚨 [주의] 현재 개발용 임시 인증 가드(DevAuthGuard)를 사용하고 있습니다.
 */
@Controller('subscriptions/pause')
@UseFilters(SubscriptionExceptionFilter)
export class PauseController {
  constructor(private readonly pauseService: PauseService) { }

  /**
   * 구독 일시정지
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevAuthGuard, PolicyGuard)
  @CheckPolicies('PAUSE_SUBSCRIPTION')
  async pauseSubscription(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(PauseSubscriptionRequestSchema))
    pauseDto: PauseSubscriptionRequest,
  ) {
    const userId = req.user!.userId;
    return this.pauseService.pauseSubscription(
      userId,
      new Date(pauseDto.startDate),
      new Date(pauseDto.endDate),
      pauseDto.reason,
    );
  }

  /**
   * 구독 재개
   */
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevAuthGuard, PolicyGuard)
  @CheckPolicies('RESUME_SUBSCRIPTION')
  async resumeSubscription(
    @Req() req: FastifyRequest,
    // 참고: resumeRequest DTO는 현재 사용되지 않지만, Zod 유효성 검사를 위해 유지합니다.
    @Body(new ZodValidationPipe(ResumeSubscriptionRequestSchema))
    resumeRequest: ResumeSubscriptionRequest,
  ) {
    const userId = req.user!.userId;
    return this.pauseService.resumeSubscription(userId);
  }

  /**
   * 일시정지 이력 조회
   */
  @Get('history')
  @UseGuards(DevAuthGuard)
  async getPauseHistory(@Req() req: FastifyRequest) {
    const userId = req.user!.userId;
    return this.pauseService.getPauseHistory(userId);
  }
}
