/**
 * 멤버십 정책 테이블 - CTO 스타일 하드코딩 정책
 *
 * 비즈니스 판단에 의한 기본 정책들을 테이블로 관리
 * 동적이거나 복잡한 정책은 DB의 subscription_policies 테이블 사용
 */

// 멤버십 액션 타입 정의
export enum MembershipAction {
  PAUSE_SUBSCRIPTION = 'PAUSE_SUBSCRIPTION',
  RESUME_SUBSCRIPTION = 'RESUME_SUBSCRIPTION',
  CHANGE_PLAN = 'CHANGE_PLAN',
  CANCEL_SUBSCRIPTION = 'CANCEL_SUBSCRIPTION',
  UPGRADE_PLAN = 'UPGRADE_PLAN',
  DOWNGRADE_PLAN = 'DOWNGRADE_PLAN',
}

// 티어 타입 정의 (실제 티어 코드에 맞게 수정 필요)
export enum TierCode {
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  ENTERPRISE = 'ENTERPRISE',
}

// 정책 규칙 타입 정의
export interface PolicyRule {
  name: string;
  description: string;
  validate: (context: MembershipPolicyContext) => PolicyValidationResult;
}

export interface MembershipPolicyContext {
  userId: string;
  tierId?: string;
  tierCode?: TierCode;
  pauseCount?: number;
  pauseStartDate?: string;
  pauseEndDate?: string;
  lastPauseEndDate?: string;
  lastPlanChangeDate?: string;
  subscriptionStartDate?: string;
  isDowngrade?: boolean;
  currentPlanPrice?: number;
  targetPlanPrice?: number;
}

export interface PolicyValidationResult {
  isValid: boolean;
  message?: string;
  code?: string;
}

/**
 * 기본 멤버십 정책 규칙들
 */
export const MEMBERSHIP_POLICY_RULES: Record<string, PolicyRule> = {
  // 일시정지 관련 정책
  MAX_PAUSES_PER_YEAR: {
    name: '연간 최대 일시정지 횟수',
    description: '연간 일시정지 가능 횟수 제한',
    validate: (context) => {
      const maxPauses = getTierPauseLimit(context.tierCode);
      const currentPauses = context.pauseCount || 0;

      if (currentPauses >= maxPauses) {
        return {
          isValid: false,
          message: `연간 일시정지 한도(${maxPauses}회)를 초과했습니다.`,
          code: 'PAUSE_LIMIT_EXCEEDED',
        };
      }
      return { isValid: true };
    },
  },

  MIN_PAUSE_DURATION: {
    name: '최소 일시정지 기간',
    description: '일시정지 최소 기간 제한',
    validate: (context) => {
      const minDays = 7; // 모든 티어 공통 7일
      const { pauseStartDate, pauseEndDate } = context;

      if (pauseStartDate && pauseEndDate) {
        const duration = Math.ceil(
          (new Date(pauseEndDate).getTime() -
            new Date(pauseStartDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );

        if (duration < minDays) {
          return {
            isValid: false,
            message: `일시정지 기간은 최소 ${minDays}일 이상이어야 합니다.`,
            code: 'PAUSE_DURATION_TOO_SHORT',
          };
        }
      }
      return { isValid: true };
    },
  },

  MAX_PAUSE_DURATION: {
    name: '최대 일시정지 기간',
    description: '일시정지 최대 기간 제한',
    validate: (context) => {
      const maxDays = getTierMaxPauseDays(context.tierCode);
      const { pauseStartDate, pauseEndDate } = context;

      if (pauseStartDate && pauseEndDate) {
        const duration = Math.ceil(
          (new Date(pauseEndDate).getTime() -
            new Date(pauseStartDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );

        if (duration > maxDays) {
          return {
            isValid: false,
            message: `일시정지 기간은 최대 ${maxDays}일을 초과할 수 없습니다.`,
            code: 'PAUSE_DURATION_TOO_LONG',
          };
        }
      }
      return { isValid: true };
    },
  },

  PAUSE_COOLDOWN: {
    name: '일시정지 쿨다운',
    description: '일시정지 종료 후 재신청 대기 기간',
    validate: (context) => {
      const cooldownDays = 30; // 모든 티어 공통 30일
      const { lastPauseEndDate } = context;

      if (lastPauseEndDate) {
        const daysSinceLastPause = Math.ceil(
          (new Date().getTime() - new Date(lastPauseEndDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );

        if (daysSinceLastPause < cooldownDays) {
          return {
            isValid: false,
            message: `마지막 일시정지 종료 후 ${cooldownDays}일이 지나야 다시 일시정지할 수 있습니다.`,
            code: 'PAUSE_COOLDOWN_ACTIVE',
          };
        }
      }
      return { isValid: true };
    },
  },

  // 플랜 변경 관련 정책
  PLAN_CHANGE_COOLDOWN: {
    name: '플랜 변경 쿨다운',
    description: '플랜 변경 후 재변경 대기 기간',
    validate: (context) => {
      const cooldownDays = 30; // 모든 티어 공통 30일
      const { lastPlanChangeDate } = context;

      if (lastPlanChangeDate) {
        const daysSinceLastChange = Math.ceil(
          (new Date().getTime() - new Date(lastPlanChangeDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );

        if (daysSinceLastChange < cooldownDays) {
          return {
            isValid: false,
            message: `플랜 변경 후 ${cooldownDays}일이 지나야 다시 변경할 수 있습니다.`,
            code: 'PLAN_CHANGE_COOLDOWN_ACTIVE',
          };
        }
      }
      return { isValid: true };
    },
  },

  DOWNGRADE_RESTRICTION: {
    name: '다운그레이드 제한',
    description: '티어별 다운그레이드 허용 정책',
    validate: (context) => {
      const { tierCode, isDowngrade, subscriptionStartDate } = context;

      if (!isDowngrade) {
        return { isValid: true }; // 다운그레이드가 아니면 통과
      }

      // BASIC 티어는 다운그레이드 불가
      if (tierCode === TierCode.BASIC) {
        return {
          isValid: false,
          message: 'BASIC 티어에서는 다운그레이드할 수 없습니다.',
          code: 'DOWNGRADE_NOT_ALLOWED',
        };
      }

      // ENTERPRISE 티어는 구독 시작 후 3개월 후에만 다운그레이드 가능
      if (tierCode === TierCode.ENTERPRISE && subscriptionStartDate) {
        const monthsSinceStart = Math.ceil(
          (new Date().getTime() - new Date(subscriptionStartDate).getTime()) /
            (1000 * 60 * 60 * 24 * 30),
        );

        if (monthsSinceStart < 3) {
          return {
            isValid: false,
            message:
              'ENTERPRISE 티어는 구독 시작 후 3개월이 지나야 다운그레이드할 수 있습니다.',
            code: 'DOWNGRADE_TOO_EARLY',
          };
        }
      }

      return { isValid: true };
    },
  },

  MIN_SUBSCRIPTION_PERIOD: {
    name: '최소 구독 기간',
    description: '구독 취소 전 최소 유지 기간',
    validate: (context) => {
      const minDays = getTierMinSubscriptionDays(context.tierCode);
      const { subscriptionStartDate } = context;

      if (subscriptionStartDate) {
        const daysSinceStart = Math.ceil(
          (new Date().getTime() - new Date(subscriptionStartDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );

        if (daysSinceStart < minDays) {
          return {
            isValid: false,
            message: `구독 시작 후 ${minDays}일이 지나야 취소할 수 있습니다.`,
            code: 'SUBSCRIPTION_TOO_NEW',
          };
        }
      }
      return { isValid: true };
    },
  },
};

/**
 * 액션별 적용 정책 매핑 테이블
 */
export const ACTION_POLICY_MAPPING: Record<MembershipAction, string[]> = {
  [MembershipAction.PAUSE_SUBSCRIPTION]: [
    'MAX_PAUSES_PER_YEAR',
    'MIN_PAUSE_DURATION',
    'MAX_PAUSE_DURATION',
    'PAUSE_COOLDOWN',
  ],
  [MembershipAction.RESUME_SUBSCRIPTION]: [
    // 재개는 특별한 제한 없음
  ],
  [MembershipAction.CHANGE_PLAN]: ['PLAN_CHANGE_COOLDOWN'],
  [MembershipAction.UPGRADE_PLAN]: ['PLAN_CHANGE_COOLDOWN'],
  [MembershipAction.DOWNGRADE_PLAN]: [
    'PLAN_CHANGE_COOLDOWN',
    'DOWNGRADE_RESTRICTION',
  ],
  [MembershipAction.CANCEL_SUBSCRIPTION]: ['MIN_SUBSCRIPTION_PERIOD'],
};

/**
 * 티어별 정책 값 조회 헬퍼 함수들
 */
function getTierPauseLimit(tierCode?: TierCode): number {
  const limits = {
    [TierCode.BASIC]: 1, // 연간 1회 - 원하는 횟수로 변경하세요
    [TierCode.PREMIUM]: 2, // 연간 2회 - 원하는 횟수로 변경하세요
    [TierCode.ENTERPRISE]: 3, // 연간 3회 - 원하는 횟수로 변경하세요
  };
  return limits[tierCode || TierCode.BASIC];
}

function getTierMaxPauseDays(tierCode?: TierCode): number {
  const maxDays = {
    [TierCode.BASIC]: 30, // 최대 30일
    [TierCode.PREMIUM]: 60, // 최대 60일
    [TierCode.ENTERPRISE]: 90, // 최대 90일
  };
  return maxDays[tierCode || TierCode.BASIC];
}

function getTierMinSubscriptionDays(tierCode?: TierCode): number {
  const minDays = {
    [TierCode.BASIC]: 30, // 최소 30일
    [TierCode.PREMIUM]: 60, // 최소 60일
    [TierCode.ENTERPRISE]: 90, // 최소 90일
  };
  return minDays[tierCode || TierCode.BASIC];
}

/**
 * 멤버십 정책 관리 클래스
 */
export class MembershipPolicy {
  /**
   * 특정 액션에 대한 정책 검증
   */
  static validate(
    action: MembershipAction,
    context: MembershipPolicyContext,
  ): PolicyValidationResult[] {
    const applicablePolicies = ACTION_POLICY_MAPPING[action] || [];
    const results: PolicyValidationResult[] = [];

    for (const policyName of applicablePolicies) {
      const policy = MEMBERSHIP_POLICY_RULES[policyName];
      if (policy) {
        const result = policy.validate(context);
        if (!result.isValid) {
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * 첫 번째 위반 정책에서 에러 던지기
   */
  static validateAndThrow(
    action: MembershipAction,
    context: MembershipPolicyContext,
  ): void {
    const violations = this.validate(action, context);
    if (violations.length > 0) {
      throw new Error(violations[0].message || 'Policy violation');
    }
  }

  /**
   * 액션 수행 가능 여부 확인
   */
  static canPerformAction(
    action: MembershipAction,
    context: MembershipPolicyContext,
  ): { allowed: boolean; reason?: string; code?: string } {
    const violations = this.validate(action, context);

    if (violations.length > 0) {
      return {
        allowed: false,
        reason: violations[0].message,
        code: violations[0].code,
      };
    }

    return { allowed: true };
  }

  /**
   * 특정 액션에 적용되는 모든 정책 규칙 반환
   */
  static getActionPolicies(action: MembershipAction): PolicyRule[] {
    const policyNames = ACTION_POLICY_MAPPING[action] || [];
    return policyNames
      .map((name) => MEMBERSHIP_POLICY_RULES[name])
      .filter(Boolean);
  }

  /**
   * 전체 정책 테이블 반환 (디버깅/관리용)
   */
  static getAllPolicies(): Record<string, PolicyRule> {
    return MEMBERSHIP_POLICY_RULES;
  }

  /**
   * 액션-정책 매핑 테이블 반환
   */
  static getActionMappings(): Record<MembershipAction, string[]> {
    return ACTION_POLICY_MAPPING;
  }
}

/**
 * 멤버십 정책 에러 클래스
 */
export class MembershipPolicyError extends Error {
  constructor(
    message: string,
    public readonly action: MembershipAction,
    public readonly code?: string,
    public readonly context?: MembershipPolicyContext,
  ) {
    super(message);
    this.name = 'MembershipPolicyError';
  }
}
