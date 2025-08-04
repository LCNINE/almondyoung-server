# 정책 관리 시스템 - 정책 타입 가이드

## 개요

멤버십 구독 시스템에서 사용되는 정책 타입들에 대한 상세 가이드입니다.

## 지원되는 정책 타입

### 일시정지 관련 정책

#### `MAX_PAUSES_PER_YEAR`
- **설명**: 연간 최대 일시정지 횟수 제한
- **예시 값**: `{ "limit": 2 }`
- **적용 범위**: 전체 사용자 또는 특정 티어

#### `MIN_PAUSE_DURATION_DAYS`
- **설명**: 최소 일시정지 기간 (일 단위)
- **예시 값**: `{ "minDays": 7 }`
- **적용 범위**: 전체 사용자 또는 특정 티어

#### `MAX_PAUSE_DURATION_DAYS`
- **설명**: 최대 일시정지 기간 (일 단위)
- **예시 값**: `{ "maxDays": 90 }`
- **적용 범위**: 전체 사용자 또는 특정 티어

#### `PAUSE_COOLDOWN_DAYS`
- **설명**: 일시정지 후 재일시정지까지의 대기 기간
- **예시 값**: `{ "cooldownDays": 30 }`
- **적용 범위**: 전체 사용자 또는 특정 티어

#### `PAUSE_BLACKOUT_PERIODS`
- **설명**: 일시정지가 금지된 기간 설정
- **예시 값**: `{ "periods": [{"start": "2024-12-01", "end": "2024-12-31", "reason": "연말 프로모션"}] }`
- **적용 범위**: 전체 사용자

### 플랜 변경 관련 정책

#### `PLAN_CHANGE_COOLDOWN_DAYS`
- **설명**: 플랜 변경 후 재변경까지의 대기 기간
- **예시 값**: `{ "cooldownDays": 30 }`
- **적용 범위**: 전체 사용자 또는 특정 티어

#### `ALLOWED_PLAN_CHANGES`
- **설명**: 허용되는 플랜 변경 조합
- **예시 값**: `{ "changes": [{"from": "BASIC", "to": "PREMIUM", "type": "UPGRADE"}] }`
- **적용 범위**: 전체 사용자

#### `DOWNGRADE_RESTRICTIONS`
- **설명**: 다운그레이드 제한 조건
- **예시 값**: `{ "restrictions": ["NO_DOWNGRADE_WITHIN_30_DAYS"] }`
- **적용 범위**: 전체 사용자 또는 특정 티어

#### `UPGRADE_BENEFITS`
- **설명**: 업그레이드 시 제공되는 혜택
- **예시 값**: `{ "benefits": ["IMMEDIATE_ACCESS", "BONUS_CREDITS"] }`
- **적용 범위**: 특정 티어

### 티어별 제한 정책

#### `TIER_SPECIFIC_LIMITS`
- **설명**: 티어별 특별 제한 사항
- **예시 값**: `{ "maxSubscriptions": 1, "maxDevices": 5 }`
- **적용 범위**: 특정 티어

#### `VIP_USER_BENEFITS`
- **설명**: VIP 사용자 특별 혜택
- **예시 값**: `{ "unlimitedPauses": true, "prioritySupport": true }`
- **적용 범위**: 특정 사용자 그룹

### 특별 기간 정책

#### `NEW_USER_GRACE_PERIOD`
- **설명**: 신규 사용자 유예 기간
- **예시 값**: `{ "graceDays": 14, "benefits": ["FREE_PAUSE"] }`
- **적용 범위**: 신규 사용자

#### `PROMOTIONAL_PERIODS`
- **설명**: 프로모션 기간 특별 규칙
- **예시 값**: `{ "startDate": "2024-01-01", "endDate": "2024-01-31", "benefits": ["EXTRA_PAUSE"] }`
- **적용 범위**: 전체 사용자

#### `SEASONAL_RESTRICTIONS`
- **설명**: 계절별 제한 사항
- **예시 값**: `{ "season": "WINTER", "restrictions": ["NO_DOWNGRADE"] }`
- **적용 범위**: 전체 사용자

#### `SPECIAL_EVENT_RULES`
- **설명**: 특별 이벤트 기간 규칙
- **예시 값**: `{ "eventName": "BLACK_FRIDAY", "rules": ["DOUBLE_PAUSE_LIMIT"] }`
- **적용 범위**: 전체 사용자

## 정책 생성 예시

```typescript
// 연간 최대 일시정지 횟수 제한 정책
const maxPausePolicy = {
  ruleType: 'MAX_PAUSES_PER_YEAR',
  ruleValue: { limit: 2 },
  tierId: 'premium-tier-id', // 선택사항
  validFrom: '2024-01-01T00:00:00Z',
  validUntil: '2024-12-31T23:59:59Z'
};

// 최소 일시정지 기간 정책
const minPauseDurationPolicy = {
  ruleType: 'MIN_PAUSE_DURATION_DAYS',
  ruleValue: { minDays: 7 },
  // 모든 티어에 적용
};
```

## 정책 검증 예시

```typescript
// 일시정지 요청 검증
const validationRequest = {
  userId: 'user-123',
  action: 'PAUSE_SUBSCRIPTION',
  context: {
    subscriptionId: 'sub-123',
    requestedStartDate: '2024-02-01',
    requestedEndDate: '2024-02-08'
  }
};
```

## 주의사항

1. **정책 우선순위**: 티어별 정책이 전역 정책보다 우선 적용됩니다.
2. **유효 기간**: `validFrom`과 `validUntil`을 설정하여 정책의 유효 기간을 제한할 수 있습니다.
3. **정책 충돌**: 상충하는 정책이 있을 경우, 더 제한적인 정책이 우선 적용됩니다.
4. **실시간 적용**: 정책 변경은 즉시 적용되며, 기존 진행 중인 작업에는 영향을 주지 않습니다.

## 새로운 정책 타입 추가

새로운 정책 타입을 추가하려면:

1. `apps/membership/src/shared/schemas/requests.ts`의 `POLICY_RULE_TYPES` 배열에 추가
2. 해당 정책의 검증 로직을 `PolicyEngineService`에 구현
3. 이 문서에 정책 타입 설명 추가
4. 테스트 케이스 작성

## 정책 엔진 API

### 새로 추가된 메서드들

#### `getApplicablePoliciesWithPriority(userId, context)`
- **설명**: 사용자별 적용 가능한 정책들을 우선순위와 함께 조회
- **반환값**: 우선순위 순으로 정렬된 정책 목록
- **사용 예시**:
```typescript
const policies = await policyEngine.getApplicablePoliciesWithPriority('user-123', {
  tierLevel: 3,
  subscriptionType: 'PREMIUM'
});
```

#### `applyPolicies(userId, action, context)`
- **설명**: 정책을 사용자에게 적용하고 결과를 반환
- **반환값**: `ALLOW`, `DENY`, `WARNING` 중 하나의 결정과 상세 정보
- **사용 예시**:
```typescript
const result = await policyEngine.applyPolicies('user-123', 'PAUSE_SUBSCRIPTION', {
  startDate: '2024-02-01',
  endDate: '2024-02-08'
});
```

#### `checkPolicyCompliance(userId, policies)`
- **설명**: 특정 정책들에 대한 준수 여부를 확인
- **반환값**: 전체 준수 상태와 개별 정책별 상세 정보
- **사용 예시**:
```typescript
const compliance = await policyEngine.checkPolicyCompliance('user-123', policies);
```

#### `filterPoliciesByTier(policies, tierId)`
- **설명**: 티어별 정책 필터링을 수행
- **반환값**: 해당 티어에 적용 가능한 정책 목록
- **사용 예시**:
```typescript
const tierPolicies = await policyEngine.filterPoliciesByTier(allPolicies, 'premium-tier');
```

## 관련 파일

- `apps/membership/src/shared/schemas/requests.ts` - 정책 요청 스키마
- `apps/membership/src/shared/schemas/types.ts` - 정책 타입 정의
- `apps/membership/src/policy-management/` - 정책 관리 모듈
- `apps/membership/src/policy-management/policy-engine.service.ts` - 정책 엔진 서비스