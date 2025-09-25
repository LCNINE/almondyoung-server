/**
 * 멤버십 정책 테이블 사용 예제
 *
 * 이 파일은 테이블 기반 정책 시스템의 사용법을 보여주는 예제입니다.
 */

import {
  MembershipPolicy,
  MembershipAction,
  MembershipPolicyContext,
  TierCode,
} from './membership-policy-table';

// ===================================================================
// 예제 1: 일시정지 정책 검증
// ===================================================================

export function examplePauseValidation() {
  const context: MembershipPolicyContext = {
    userId: 'user123',
    tierId: 'premium-tier-id',
    tierCode: TierCode.PREMIUM,
    pauseCount: 2, // 이미 2번 일시정지함
    pauseStartDate: '2025-01-01',
    pauseEndDate: '2025-01-05', // 4일간 (최소 7일 미만)
    lastPauseEndDate: '2024-12-01', // 1개월 전 종료
  };

  // 1. 빠른 검증 (boolean 반환)
  const result = MembershipPolicy.canPerformAction(
    MembershipAction.PAUSE_SUBSCRIPTION,
    context,
  );

  console.log('일시정지 가능 여부:', result);
  // 출력: { allowed: false, reason: '일시정지 기간은 최소 7일 이상이어야 합니다.', code: 'PAUSE_DURATION_TOO_SHORT' }

  // 2. 예외 던지는 검증
  try {
    MembershipPolicy.validateAndThrow(
      MembershipAction.PAUSE_SUBSCRIPTION,
      context,
    );
    console.log('일시정지 허용됨');
  } catch (error) {
    console.log('일시정지 거부:', error.message);
    // 출력: '일시정지 기간은 최소 7일 이상이어야 합니다.'
  }
}

// ===================================================================
// 예제 2: 플랜 다운그레이드 정책 검증
// ===================================================================

export function exampleDowngradeValidation() {
  const context: MembershipPolicyContext = {
    userId: 'user456',
    tierId: 'enterprise-tier-id',
    tierCode: TierCode.ENTERPRISE,
    subscriptionStartDate: '2024-12-01', // 1개월 전 시작 (3개월 미만)
    isDowngrade: true,
    lastPlanChangeDate: '2024-12-15', // 15일 전 변경 (30일 미만)
  };

  const violations = MembershipPolicy.validate(
    MembershipAction.DOWNGRADE_PLAN,
    context,
  );

  console.log('다운그레이드 위반 사항들:', violations);
  // 출력: [
  //   { isValid: false, message: '플랜 변경 후 30일이 지나야 다시 변경할 수 있습니다.', code: 'PLAN_CHANGE_COOLDOWN_ACTIVE' },
  //   { isValid: false, message: 'ENTERPRISE 티어는 구독 시작 후 3개월이 지나야 다운그레이드할 수 있습니다.', code: 'DOWNGRADE_TOO_EARLY' }
  // ]
}

// ===================================================================
// 예제 3: 성공적인 업그레이드 케이스
// ===================================================================

export function exampleSuccessfulUpgrade() {
  const context: MembershipPolicyContext = {
    userId: 'user789',
    tierId: 'basic-tier-id',
    tierCode: TierCode.BASIC,
    subscriptionStartDate: '2024-06-01', // 7개월 전 시작
    isDowngrade: false, // 업그레이드
    lastPlanChangeDate: '2024-06-01', // 충분히 오래전
  };

  const result = MembershipPolicy.canPerformAction(
    MembershipAction.UPGRADE_PLAN,
    context,
  );

  console.log('업그레이드 가능 여부:', result);
  // 출력: { allowed: true }
}

// ===================================================================
// 예제 4: 티어별 정책 차이 확인
// ===================================================================

export function exampleTierDifferences() {
  const basicUser: MembershipPolicyContext = {
    userId: 'basic-user',
    tierCode: TierCode.BASIC,
    pauseCount: 2, // BASIC 티어 한도: 2회
    pauseStartDate: '2025-01-01',
    pauseEndDate: '2025-01-31', // 30일 (BASIC 최대: 30일)
  };

  const enterpriseUser: MembershipPolicyContext = {
    userId: 'enterprise-user',
    tierCode: TierCode.ENTERPRISE,
    pauseCount: 4, // ENTERPRISE 티어 한도: 5회
    pauseStartDate: '2025-01-01',
    pauseEndDate: '2025-03-31', // 90일 (ENTERPRISE 최대: 90일)
  };

  const basicResult = MembershipPolicy.canPerformAction(
    MembershipAction.PAUSE_SUBSCRIPTION,
    basicUser,
  );

  const enterpriseResult = MembershipPolicy.canPerformAction(
    MembershipAction.PAUSE_SUBSCRIPTION,
    enterpriseUser,
  );

  console.log('BASIC 티어 일시정지:', basicResult);
  // 출력: { allowed: false, reason: '연간 일시정지 한도(2회)를 초과했습니다.', code: 'PAUSE_LIMIT_EXCEEDED' }

  console.log('ENTERPRISE 티어 일시정지:', enterpriseResult);
  // 출력: { allowed: true }
}

// ===================================================================
// 예제 5: 정책 규칙 정보 조회
// ===================================================================

export function examplePolicyInformation() {
  // 특정 액션에 적용되는 정책들 조회
  const pausePolicies = MembershipPolicy.getActionPolicies(
    MembershipAction.PAUSE_SUBSCRIPTION,
  );

  console.log('일시정지 관련 정책들:');
  pausePolicies.forEach((policy) => {
    console.log(`- ${policy.name}: ${policy.description}`);
  });

  // 출력:
  // - 연간 최대 일시정지 횟수: 연간 일시정지 가능 횟수 제한
  // - 최소 일시정지 기간: 일시정지 최소 기간 제한
  // - 최대 일시정지 기간: 일시정지 최대 기간 제한
  // - 일시정지 쿨다운: 일시정지 종료 후 재신청 대기 기간

  // 전체 정책 테이블 조회
  const allPolicies = MembershipPolicy.getAllPolicies();
  console.log('전체 정책 수:', Object.keys(allPolicies).length);

  // 액션-정책 매핑 조회
  const mappings = MembershipPolicy.getActionMappings();
  console.log('액션별 정책 매핑:', mappings);
}

// ===================================================================
// 실행 예제
// ===================================================================

if (require.main === module) {
  console.log('=== 멤버십 정책 테이블 예제 실행 ===\n');

  console.log('1. 일시정지 정책 검증:');
  examplePauseValidation();
  console.log();

  console.log('2. 다운그레이드 정책 검증:');
  exampleDowngradeValidation();
  console.log();

  console.log('3. 성공적인 업그레이드:');
  exampleSuccessfulUpgrade();
  console.log();

  console.log('4. 티어별 정책 차이:');
  exampleTierDifferences();
  console.log();

  console.log('5. 정책 정보 조회:');
  examplePolicyInformation();
}

/**
 * 하이브리드 정책 서비스와 함께 사용하는 예제
 */
export async function exampleWithHybridService(
  policyService: any, // PolicyValidationService
) {
  const context = {
    userId: 'user123',
    tierId: 'premium',
    pauseCount: 1,
    pauseStartDate: '2025-01-01',
    pauseEndDate: '2025-01-15', // 14일간
  };

  // 1. 테이블 기반 정책만 빠르게 검증 (DB 쿼리 없음)
  const tableResult = await policyService.validateTableOnly(
    'PAUSE_SUBSCRIPTION',
    context,
  );
  console.log('테이블 기반 검증 결과:', tableResult);

  // 2. 하이브리드 검증 (테이블 + DB 정책)
  try {
    await policyService.validate('PAUSE_SUBSCRIPTION', context);
    console.log('하이브리드 검증 통과');
  } catch (error) {
    console.log('하이브리드 검증 실패:', error.message);
  }

  // 3. 테이블 기반 정책 규칙 정보 조회
  const tableRules = policyService.getTableBasedPolicies('PAUSE_SUBSCRIPTION');
  console.log('테이블 기반 정책 규칙들:', tableRules);
}
