import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PolicyEngineService } from './policy-engine.service';

/**
 * 사용자용 정책 정보 컨트롤러
 * 일반 사용자가 자신의 정책 제한사항을 조회할 수 있는 API를 제공합니다.
 */
@ApiTags('user-policies')
@Controller('policies')
export class UserPolicyController {
  constructor(
    private readonly policyEngine: PolicyEngineService,
  ) { }

  /**
   * 현재 사용자의 정책 제한사항을 조회합니다.
   * 
   * @example
   * GET /policies/my-limits?userId=user-123
   * 
   * Response:
   * {
   *   "pause": {
   *     "maxPerYear": 3,
   *     "usedThisYear": 1,
   *     "remainingCount": 2,
   *     "lastPauseDate": "2024-03-15",
   *     "minDuration": 7,
   *     "maxDuration": 90,
   *     "cooldownUntil": null
   *   },
   *   "planChange": {
   *     "cooldownDays": 30,
   *     "lastChangeDate": "2024-02-01",
   *     "nextAvailableDate": "2024-03-02"
   *   }
   * }
   */
  @Get('my-limits')
  @ApiOperation({ summary: '내 정책 제한사항 조회' })
  async getMyPolicyLimits(
    @Query('userId') userId: string,
    @Query('year') year?: string,
  ) {
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();

    // 사용자별 적용 가능한 정책 조회
    const applicablePolicies = await this.policyEngine.getApplicablePolicies(
      userId,
      { year: currentYear }
    );

    // 정책별로 현재 사용량과 제한사항 계산
    const limits = await this.calculateUserLimits(userId, applicablePolicies, currentYear);

    return limits;
  }

  /**
   * 특정 액션에 대한 정책 검증 결과를 미리 확인합니다.
   * 
   * @example
   * GET /policies/check?userId=user-123&action=PAUSE_SUBSCRIPTION&duration=30
   */
  @Get('check')
  @ApiOperation({ summary: '정책 검증 미리보기' })
  async checkPolicyCompliance(
    @Query('userId') userId: string,
    @Query('action') action: string,
    @Query() context: Record<string, any>,
  ) {
    // userId와 action을 제외한 나머지를 context로 사용
    const { userId: _, action: __, ...policyContext } = context;

    const validationResult = await this.policyEngine.validateRequest(
      userId,
      action,
      policyContext,
    );

    return {
      isValid: validationResult.isValid,
      violations: validationResult.violations.map(v => ({
        message: v.message,
        severity: v.severity,
        suggestedAction: v.suggestedAction,
      })),
      warnings: validationResult.warnings,
    };
  }

  /**
   * 사용자의 정책 제한사항을 계산합니다.
   */
  private async calculateUserLimits(
    userId: string,
    applicablePolicies: any[],
    year: number
  ) {
    const limits: any = {};

    // 일시정지 관련 제한사항
    const pausePolicies = applicablePolicies.filter(p =>
      p.ruleType.startsWith('MAX_PAUSES_') ||
      p.ruleType.includes('PAUSE_')
    );

    if (pausePolicies.length > 0) {
      limits.pause = await this.calculatePauseLimits(userId, pausePolicies, year);
    }

    // 플랜 변경 관련 제한사항
    const planChangePolicies = applicablePolicies.filter(p =>
      p.ruleType.includes('PLAN_CHANGE')
    );

    if (planChangePolicies.length > 0) {
      limits.planChange = await this.calculatePlanChangeLimits(userId, planChangePolicies);
    }

    return limits;
  }

  /**
   * 일시정지 제한사항을 계산합니다.
   */
  private async calculatePauseLimits(userId: string, policies: any[], year: number) {
    // TODO: pauseUsageTracker에서 현재 사용량 조회
    // 현재는 임시 데이터로 대체
    const maxPerYearPolicy = policies.find(p => p.ruleType === 'MAX_PAUSES_PER_YEAR');
    const minDurationPolicy = policies.find(p => p.ruleType === 'MIN_PAUSE_DURATION_DAYS');
    const maxDurationPolicy = policies.find(p => p.ruleType === 'MAX_PAUSE_DURATION_DAYS');
    const cooldownPolicy = policies.find(p => p.ruleType === 'PAUSE_COOLDOWN_DAYS');

    return {
      maxPerYear: maxPerYearPolicy?.ruleValue?.value || 0,
      usedThisYear: 0, // TODO: 실제 사용량 조회
      remainingCount: maxPerYearPolicy?.ruleValue?.value || 0, // TODO: 계산
      lastPauseDate: null, // TODO: 마지막 일시정지 날짜 조회
      minDuration: minDurationPolicy?.ruleValue?.value || 0,
      maxDuration: maxDurationPolicy?.ruleValue?.value || 0,
      cooldownUntil: null, // TODO: 쿨다운 종료일 계산
    };
  }

  /**
   * 플랜 변경 제한사항을 계산합니다.
   */
  private async calculatePlanChangeLimits(userId: string, policies: any[]) {
    const cooldownPolicy = policies.find(p => p.ruleType === 'PLAN_CHANGE_COOLDOWN_DAYS');

    return {
      cooldownDays: cooldownPolicy?.ruleValue?.value || 0,
      lastChangeDate: null, // TODO: 마지막 플랜 변경일 조회
      nextAvailableDate: null, // TODO: 다음 변경 가능일 계산
    };
  }
}