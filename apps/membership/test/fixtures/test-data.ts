/**
 * E2E 테스트용 샘플 데이터 생성기
 * Zod 스키마와 DTO를 기반으로 일관된 테스트 데이터 제공
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  CreateTierRequest,
  CreatePlanRequest,
  CreatePolicyRequest,
  CreateSubscriptionRequest,
  PauseSubscriptionRequest,
  ResumeSubscriptionRequest,
  CancelSubscriptionRequest,
} from '../../src/shared/schemas/requests';

/**
 * 테스트용 UUID 생성기
 */
export const generateTestIds = () => ({
  adminId: uuidv4(),
  userId: uuidv4(),
  tierId: uuidv4(),
  planId: uuidv4(),
  policyId: uuidv4(),
  subscriptionId: uuidv4(),
  contractId: uuidv4(),
  entitlementId: uuidv4(),
});

/**
 * 티어 생성 요청 데이터
 */
export const createTierRequestData = (): CreateTierRequest => ({
  code: generateUniqueTierCode(),
  priorityLevel: Math.floor(Math.random() * 100) + 1, // 1-100 랜덤값
});

/**
 * 플랜 생성 요청 데이터
 */
export const createPlanRequestData = (tierId: string): CreatePlanRequest => ({
  tierId,
  price: 10000,
  durationDays: 30,
  currency: 'KRW',
  trialDays: 7,
});

/**
 * 정책 생성 요청 데이터 (일시정지 제한)
 */
export const createPausePolicyRequestData = (): CreatePolicyRequest => {
  // 중복을 피하기 위해 더 다양한 정책 타입 중 하나를 랜덤 선택
  const policyTypes = [
    'MIN_PAUSE_DURATION_DAYS', 
    'MAX_PAUSE_DURATION_DAYS', 
    'PAUSE_COOLDOWN_DAYS',
    'PLAN_CHANGE_COOLDOWN_DAYS',
    'NEW_USER_GRACE_PERIOD',
    'TIER_SPECIFIC_LIMITS',
    'ALLOWED_PLAN_CHANGES',
    'DOWNGRADE_RESTRICTIONS',
    'UPGRADE_BENEFITS',
    'VIP_USER_BENEFITS',
    'PROMOTIONAL_PERIODS',
    'SEASONAL_RESTRICTIONS',
    'SPECIAL_EVENT_RULES'
  ] as const;
  
  const selectedType = policyTypes[Math.floor(Math.random() * policyTypes.length)];
  
  const ruleValues = {
    MIN_PAUSE_DURATION_DAYS: { days: 1 },
    MAX_PAUSE_DURATION_DAYS: { days: 90 },
    PAUSE_COOLDOWN_DAYS: { days: 7 },
    PLAN_CHANGE_COOLDOWN_DAYS: { days: 30 },
    NEW_USER_GRACE_PERIOD: { days: 14 },
    TIER_SPECIFIC_LIMITS: { maxPauses: 3, maxChanges: 2 },
    ALLOWED_PLAN_CHANGES: { types: ['upgrade', 'downgrade'] },
    DOWNGRADE_RESTRICTIONS: { minDays: 30 },
    UPGRADE_BENEFITS: { discount: 10 },
    VIP_USER_BENEFITS: { unlimitedPauses: true },
    PROMOTIONAL_PERIODS: { active: true },
    SEASONAL_RESTRICTIONS: { summer: false },
    SPECIAL_EVENT_RULES: { enabled: false },
  };

  return {
    ruleType: selectedType,
    ruleValue: ruleValues[selectedType],
  };
};

/**
 * 구독 생성 요청 데이터
 */
export const createSubscriptionRequestData = (planId: string): CreateSubscriptionRequest => ({
  planId,
});

/**
 * 구독 일시정지 요청 데이터
 */
export const pauseSubscriptionRequestData = (): PauseSubscriptionRequest => {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(startDate.getDate() + 10);

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    reason: 'E2E Test Pause',
  };
};

/**
 * 구독 재개 요청 데이터
 */
export const resumeSubscriptionRequestData = (): ResumeSubscriptionRequest => ({
  reason: 'E2E Test Resume',
});

/**
 * 구독 취소 요청 데이터
 */
export const cancelSubscriptionRequestData = (): CancelSubscriptionRequest => ({
  reason: 'E2E Test Cancel',
});

/**
 * 다양한 티어 코드 생성기 (중복 방지용)
 * Zod 스키마: ^[A-Z_]+$ (대문자와 언더스코어만 허용)
 */
export const generateUniqueTierCode = (): string => {
  const baseCodes = ['BASIC', 'STANDARD', 'PREMIUM', 'VIP', 'ENTERPRISE'];
  const suffixes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  
  const baseCode = baseCodes[Math.floor(Math.random() * baseCodes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const timestamp = Date.now().toString().slice(-3); // 마지막 3자리만 사용
  
  // 숫자를 문자로 변환 (0->A, 1->B, ..., 9->J)
  const timestampLetters = timestamp.split('').map(digit => 
    String.fromCharCode(65 + parseInt(digit)) // 0->A, 1->B, ..., 9->J
  ).join('');
  
  // 20자 제한을 고려하여 코드 생성 (예: STANDARD_A_ABC)
  return `${baseCode}_${suffix}_${timestampLetters}`;
};

/**
 * 다양한 가격대 플랜 데이터 생성기
 */
export const createVariedPlanRequestData = (tierId: string, planType: 'monthly' | 'yearly' | 'weekly' = 'monthly'): CreatePlanRequest => {
  const planConfigs = {
    weekly: { price: 2500, durationDays: 7, trialDays: 1 },
    monthly: { price: 10000, durationDays: 30, trialDays: 7 },
    yearly: { price: 100000, durationDays: 365, trialDays: 14 },
  };

  const config = planConfigs[planType];
  
  return {
    tierId,
    price: config.price,
    durationDays: config.durationDays,
    currency: 'KRW',
    trialDays: config.trialDays,
  };
};

/**
 * 다양한 정책 타입 데이터 생성기
 */
export const createPolicyRequestData = (
  policyType: 'MAX_PAUSES_PER_YEAR' | 'MIN_PAUSE_DURATION_DAYS' | 'MAX_PAUSE_DURATION_DAYS' = 'MAX_PAUSES_PER_YEAR'
): CreatePolicyRequest => {
  const policyConfigs = {
    MAX_PAUSES_PER_YEAR: { limit: 2 },
    MIN_PAUSE_DURATION_DAYS: { days: 1 },
    MAX_PAUSE_DURATION_DAYS: { days: 90 },
  };

  return {
    ruleType: policyType,
    ruleValue: policyConfigs[policyType],
  };
};

/**
 * 테스트 시나리오별 완전한 데이터셋
 */
export class TestDataBuilder {
  private ids = generateTestIds();

  /**
   * 기본 관리자 설정 데이터셋
   */
  getAdminSetupData() {
    return {
      ids: this.ids,
      tierRequest: createTierRequestData(),
      planRequest: createPlanRequestData(this.ids.tierId),
      policyRequest: createPausePolicyRequestData(),
    };
  }

  /**
   * 사용자 구독 여정 데이터셋
   */
  getUserJourneyData() {
    return {
      ids: this.ids,
      subscriptionRequest: createSubscriptionRequestData(this.ids.planId),
      pauseRequest: pauseSubscriptionRequestData(),
      resumeRequest: resumeSubscriptionRequestData(),
      cancelRequest: cancelSubscriptionRequestData(),
    };
  }

  /**
   * 새로운 ID 세트로 리셋
   */
  reset() {
    this.ids = generateTestIds();
    return this;
  }

  /**
   * 특정 ID 오버라이드
   */
  withIds(partialIds: Partial<ReturnType<typeof generateTestIds>>) {
    this.ids = { ...this.ids, ...partialIds };
    return this;
  }
}

/**
 * 전역 테스트 데이터 빌더 인스턴스
 */
export const testDataBuilder = new TestDataBuilder();