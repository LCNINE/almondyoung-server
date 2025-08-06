import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseFilters,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { PauseService } from './pause.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { PolicyGuard } from './policy.guard';
import { PolicyAction } from '../shared/schemas/enum';
import {
  PauseSubscriptionRequestSchema,
  PauseSubscriptionRequest,
  ResumeSubscriptionRequestSchema,
  ResumeSubscriptionRequest,
} from '../shared/schemas';
import type { RequestWithPolicyValidation } from '../shared/schemas/policy.type';

/**
 * 일시정지 관리 컨트롤러
 * 구독 일시정지/재개 및 이력 조회 API
 */
@Controller('subscriptions/pause')
@UseFilters(SubscriptionExceptionFilter)
export class PauseController {
  constructor(private readonly pauseService: PauseService) {}

  /**
   * 구독 일시정지
   * PolicyGuard에 정책 액션을 직접 전달하여 검증 수행
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(PolicyGuard(PolicyAction.PAUSE_SUBSCRIPTION))
  async pauseSubscription(
    @Body(new ZodValidationPipe(PauseSubscriptionRequestSchema))
    pauseRequest: PauseSubscriptionRequest,
    @Query('userId') userId: string,
    @Req() req: RequestWithPolicyValidation,
  ) {
    // 정책 검증 결과 활용 (Guard에서 req.policyValidation에 저장)
    const policyValidation = req.policyValidation;

    if (policyValidation) {
      console.log('🔍 PolicyGuard 결과:');
      console.log(`- 검증 결과: ${policyValidation.isValid ? '통과' : '실패'}`);
      console.log(
        `- 적용된 정책 수: ${policyValidation.appliedPolicies.length}`,
      );
      console.log(
        `- 남은 일시정지 횟수: ${policyValidation.remainingQuota?.remainingPauses || 'N/A'}`,
      );
      console.log(`- 실행 시간: ${policyValidation.executionTime}ms`);

      if (policyValidation.warnings.length > 0) {
        console.log(
          `- 경고: ${policyValidation.warnings.map((w) => w.message).join(', ')}`,
        );
      }
    }

    // 정책 검증 결과와 함께 서비스 호출
    const result = await this.pauseService.pauseSubscription(userId, {
      startDate: pauseRequest.startDate,
      endDate: pauseRequest.endDate,
      reason: pauseRequest.reason,
    });

    // 정책 검증 정보를 응답에 추가 (선택사항)
    if (policyValidation?.remainingQuota?.remainingPauses !== undefined) {
      return {
        ...result,
        policyInfo: {
          remainingPauses: policyValidation.remainingQuota.remainingPauses,
          executionTime: policyValidation.executionTime,
        },
      };
    }

    return result;
  }

  /**
   * 구독 재개
   * PolicyGuard에 정책 액션을 직접 전달하여 검증 수행
   */
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PolicyGuard(PolicyAction.RESUME_SUBSCRIPTION))
  async resumeSubscription(
    @Body(new ZodValidationPipe(ResumeSubscriptionRequestSchema))
    resumeRequest: ResumeSubscriptionRequest,
    @Query('userId') userId: string,
    @Req() req: RequestWithPolicyValidation,
  ) {
    // 정책 검증 결과 활용
    const policyValidation = req.policyValidation;

    if (policyValidation) {
      console.log('🔄 구독 재개 정책 검증:');
      console.log(`- 검증 결과: ${policyValidation.isValid ? '통과' : '실패'}`);
      console.log(
        `- 적용된 정책 수: ${policyValidation.appliedPolicies.length}`,
      );
      console.log(`- 실행 시간: ${policyValidation.executionTime}ms`);
    }

    return this.pauseService.resumeSubscription(userId, {
      reason: resumeRequest.reason,
    });
  }

  /**
   * 일시정지 이력 조회
   */
  @Get('history')
  async getPauseHistory(@Query('userId') userId: string) {
    return this.pauseService.getPauseHistory(userId);
  }

  /**
   * 일시정지 자격 확인
   */
  @Get('eligibility')
  async checkPauseEligibility(
    @Query('userId') userId: string,
    @Query('year') year?: string,
  ) {
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.pauseService.checkPauseEligibility(null, userId, currentYear);
  }
}
