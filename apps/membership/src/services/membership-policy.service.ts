import { Injectable, Logger } from '@nestjs/common';

// 하위 호환성을 위한 타입 export
export type PolicyRuleType =
  // Pause-related policies
  | 'MAX_PAUSES_PER_YEAR'
  | 'MIN_PAUSE_DURATION_DAYS'
  | 'MAX_PAUSE_DURATION_DAYS'
  | 'PAUSE_COOLDOWN_DAYS'
  | 'PAUSE_BLACKOUT_PERIODS'
  // Plan change policies
  | 'PLAN_CHANGE_COOLDOWN_DAYS'
  | 'ALLOWED_PLAN_CHANGES'
  | 'DOWNGRADE_RESTRICTIONS'
  | 'UPGRADE_BENEFITS'
  // Tier-specific policies
  | 'TIER_SPECIFIC_LIMITS'
  | 'VIP_USER_BENEFITS'
  | 'NEW_USER_GRACE_PERIOD'
  // Promotional policies
  | 'PROMOTIONAL_PERIODS'
  | 'SEASONAL_RESTRICTIONS'
  | 'SPECIAL_EVENT_RULES'
  // Refund policies
  | 'TRIAL_REFUND_ENABLED'
  | 'RESUBSCRIPTION_REFUND_WINDOW_HOURS'
  | 'BENEFIT_USAGE_AFFECTS_REFUND'
  | 'PARTIAL_REFUND_CALCULATION_METHOD'
  | 'REFUND_PROCESSING_DAYS'
  // Trial policies
  | 'TRIAL_DURATION_DAYS'
  | 'TRIAL_REUSE_PREVENTION'
  | 'TRIAL_COOLDOWN_DAYS';

export type PolicyValue = Record<string, any>;

/**
 * 하드코딩 정책 테이블
 *
 * 장점:
 * - 빠른 조회 (메모리)
 * - 배포 없이 코드로 관리
 * - 타입 안전성
 *
 * 단점:
 * - 런타임 변경 불가
 * - 배포 필요
 */
const POLICY_TABLE: Record<string, PolicyValue> = {
  // ===== 일시정지 정책 =====
  MAX_PAUSES_PER_YEAR: { count: 2 },
  MIN_PAUSE_DURATION_DAYS: { days: 7 },
  MAX_PAUSE_DURATION_DAYS: { days: 90 },
  PAUSE_COOLDOWN_DAYS: { days: 30 },

  // ===== 환불 정책 =====
  TRIAL_REFUND_ENABLED: { enabled: true },
  RESUBSCRIPTION_REFUND_WINDOW_HOURS: { hours: 24 },
  BENEFIT_USAGE_AFFECTS_REFUND: { enabled: true },

  // ===== 체험 정책 =====
  TRIAL_DURATION_DAYS: { days: 7 },
  TRIAL_REUSE_PREVENTION: { enabled: true },

  // ===== 플랜 변경 정책 =====
  PLAN_CHANGE_COOLDOWN_DAYS: { days: 30 },
};

/**
 * 티어별 정책 오버라이드 (선택적)
 *
 * 특정 티어에 다른 정책을 적용하고 싶을 때 사용
 */
const TIER_POLICY_OVERRIDES: Record<string, Record<string, PolicyValue>> = {
  // 예시: PREMIUM 티어는 더 많은 일시정지 가능
  // 'premium-tier-id': {
  //   MAX_PAUSES_PER_YEAR: { count: 3 },
  //   MAX_PAUSE_DURATION_DAYS: { days: 120 },
  // },
};

/**
 * 멤버십 정책 서비스 (Business Layer)
 *
 * 역할: 하드코딩된 정책 테이블 관리
 * - 인메모리 정책 조회
 * - 티어별 오버라이드 지원
 * - 타입 안전한 정책 값 추출
 */
@Injectable()
export class MembershipPolicyService {
  private readonly logger = new Logger(MembershipPolicyService.name);

  /**
   * 정책 값 조회
   *
   * 우선순위:
   * 1. 티어별 오버라이드
   * 2. 기본 정책 테이블
   * 3. 기본값
   */
  async getPolicyValue<T = PolicyValue>(
    ruleType: PolicyRuleType,
    tierId?: string,
    defaultValue?: T,
  ): Promise<T> {
    // 1. 티어별 오버라이드 확인
    if (tierId && TIER_POLICY_OVERRIDES[tierId]?.[ruleType]) {
      this.logger.debug('Using tier-specific policy', {
        ruleType,
        tierId,
      });
      return TIER_POLICY_OVERRIDES[tierId][ruleType] as T;
    }

    // 2. 기본 정책 테이블 확인
    const policyValue = POLICY_TABLE[ruleType];
    if (policyValue) {
      return policyValue as T;
    }

    // 3. 기본값 사용
    if (defaultValue !== undefined) {
      this.logger.warn('Policy not found, using default', {
        ruleType,
        tierId: tierId || 'global',
        defaultValue,
      });
      return defaultValue;
    }

    // 4. 에러
    this.logger.error('Policy not found and no default provided', {
      ruleType,
      tierId,
    });
    throw new Error(`Policy not found: ${ruleType}`);
  }

  /**
   * 숫자 정책 값 추출
   */
  async getNumberPolicy(
    ruleType: PolicyRuleType,
    key: string,
    tierId?: string,
    defaultValue?: number,
  ): Promise<number> {
    const value = await this.getPolicyValue<Record<string, any>>(
      ruleType,
      tierId,
      defaultValue !== undefined ? { [key]: defaultValue } : undefined,
    );

    if (typeof value[key] !== 'number') {
      this.logger.error('Policy value type mismatch', {
        ruleType,
        key,
        expectedType: 'number',
        actualType: typeof value[key],
      });
      throw new Error(
        `Policy value for key '${key}' is not a number: ${ruleType}`,
      );
    }

    return value[key];
  }

  /**
   * 불린 정책 값 추출
   */
  async getBooleanPolicy(
    ruleType: PolicyRuleType,
    key: string,
    tierId?: string,
    defaultValue?: boolean,
  ): Promise<boolean> {
    const value = await this.getPolicyValue<Record<string, any>>(
      ruleType,
      tierId,
      defaultValue !== undefined ? { [key]: defaultValue } : undefined,
    );

    if (typeof value[key] !== 'boolean') {
      this.logger.error('Policy value type mismatch', {
        ruleType,
        key,
        expectedType: 'boolean',
        actualType: typeof value[key],
      });
      throw new Error(
        `Policy value for key '${key}' is not a boolean: ${ruleType}`,
      );
    }

    return value[key];
  }

  /**
   * 정책 업데이트 (런타임)
   *
   * 주의: 서버 재시작 시 초기화됨
   */
  updatePolicy(
    ruleType: PolicyRuleType,
    value: PolicyValue,
    tierId?: string,
  ): void {
    if (tierId) {
      if (!TIER_POLICY_OVERRIDES[tierId]) {
        TIER_POLICY_OVERRIDES[tierId] = {};
      }
      TIER_POLICY_OVERRIDES[tierId][ruleType] = value;
      this.logger.log('Tier policy updated (runtime)', { ruleType, tierId });
    } else {
      POLICY_TABLE[ruleType] = value;
      this.logger.log('Global policy updated (runtime)', { ruleType });
    }
  }

  /**
   * 모든 정책 조회 (디버깅용)
   */
  getAllPolicies(): Record<string, PolicyValue> {
    return { ...POLICY_TABLE };
  }

  /**
   * 티어별 오버라이드 조회 (디버깅용)
   */
  getTierOverrides(tierId: string): Record<string, PolicyValue> | undefined {
    return TIER_POLICY_OVERRIDES[tierId];
  }
}
