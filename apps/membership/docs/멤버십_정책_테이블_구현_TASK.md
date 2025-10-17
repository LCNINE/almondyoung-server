# 멤버십 정책 테이블 구현 TASK

> **목표**: 하드코딩된 비즈니스 정책을 DB 테이블로 관리하여 유연성 확보  
> **예상 소요**: 4일  
> **우선순위**: High

---

## 📋 Task Overview

### 현재 상황

- ❌ 정책들이 코드에 하드코딩됨 (TRIAL_DAYS = 7, REFUND_WINDOW = 24시간 등)
- ❌ 정책 변경 시 코드 수정 → 배포 → 재시작 필요
- ❌ 티어별 차별화된 정책 적용 어려움

### 목표 상태

- ✅ DB 테이블에서 정책 동적 로드
- ✅ 정책 변경 시 즉시 반영 (재시작 불필요)
- ✅ 티어별/기간별 정책 차별화
- ✅ 정책 이력 추적 및 관리

---

## 🎯 Phase 1: 기본 구조 구현 (1일)

### Task 1.1: PolicyService 구현

**파일**: `apps/membership/src/services/membership-policy.service.ts`

```typescript
// 구현할 주요 메서드들
class MembershipPolicyService {
  async getPolicy(
    ruleType: PolicyRuleType,
    tierId?: string,
  ): Promise<Policy | null>;
  async getPolicyValue<T>(
    ruleType: PolicyRuleType,
    tierId?: string,
    defaultValue?: T,
  ): Promise<T>;
  async getNumberPolicy(
    ruleType: PolicyRuleType,
    key: string,
    tierId?: string,
    defaultValue?: number,
  ): Promise<number>;
  async getBooleanPolicy(
    ruleType: PolicyRuleType,
    key: string,
    tierId?: string,
    defaultValue?: boolean,
  ): Promise<boolean>;
  async upsertPolicy(
    ruleType: PolicyRuleType,
    ruleValue: PolicyValue,
    tierId?: string,
  ): Promise<Policy>;
  async deactivatePolicy(id: string): Promise<void>;
}
```

**체크리스트**:

- [ ] 기본 CRUD 메서드 구현
- [ ] 티어별 우선순위 로직 (티어별 > 전체)
- [ ] 유효 기간 필터링 (validFrom/validUntil)
- [ ] 캐싱 로직 (5분 TTL)
- [ ] 에러 핸들링 및 로깅

### Task 1.2: 타입 정의

**파일**: `apps/membership/src/shared/types/policy.types.ts`

```typescript
export type PolicyRuleType =
  | 'TRIAL_DURATION_DAYS'
  | 'TRIAL_REUSE_PREVENTION'
  | 'RESUBSCRIPTION_REFUND_WINDOW_HOURS'
  | 'BENEFIT_USAGE_AFFECTS_REFUND'
  | 'MAX_PAUSE_DURATION_DAYS'
  | 'MIN_PAUSE_DURATION_DAYS'
  | 'PAUSE_BLACKOUT_PERIODS';

export interface PolicyValue {
  [key: string]: any;
}

export interface Policy {
  id: string;
  ruleType: PolicyRuleType;
  ruleValue: PolicyValue;
  tierId: string | null;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
}
```

**체크리스트**:

- [ ] PolicyRuleType enum 확장
- [ ] Policy 인터페이스 정의
- [ ] PolicyValue 타입 정의
- [ ] 타입 안전성 확보

### Task 1.3: 단위 테스트

**파일**: `apps/membership/src/services/__tests__/membership-policy.service.spec.ts`

**체크리스트**:

- [ ] 정책 조회 테스트
- [ ] 티어별 우선순위 테스트
- [ ] 캐싱 동작 테스트
- [ ] 기본값 처리 테스트
- [ ] 에러 케이스 테스트

---

## 🔧 Phase 2: 기존 코드에 정책 적용 (2일)

### Task 2.1: 환불 정책 적용

**파일**: `apps/membership/src/services/subscription/subscription-cancellation.manager.ts`

**변경 전**:

```typescript
// ❌ 하드코딩
const REFUND_WINDOW_HOURS = 24;
if (hoursSinceCreation < REFUND_WINDOW_HOURS) {
  // 환불 가능
}
```

**변경 후**:

```typescript
// ✅ 정책 테이블에서 조회
const refundWindowHours = await this.policyService.getNumberPolicy(
  'RESUBSCRIPTION_REFUND_WINDOW_HOURS',
  'hours',
  plan.tierId,
  24, // 기본값
);

if (hoursSinceCreation < refundWindowHours) {
  // 환불 가능
}
```

**체크리스트**:

- [ ] `checkRefundEligibility` 메서드 수정
- [ ] 무료 체험 환불 정책 적용
- [ ] 재구독 환불 정책 적용
- [ ] 혜택 사용 영향 정책 적용
- [ ] 기존 테스트 업데이트

### Task 2.2: 무료 체험 정책 적용

**파일**: `apps/membership/src/services/subscription/subscription.creator.ts`

**변경 전**:

```typescript
// ❌ 하드코딩
const effectiveTrialDays = isFirstTime ? plan.trialDays || 0 : 0;
```

**변경 후**:

```typescript
// ✅ 정책 테이블에서 조회
const trialDays = await this.policyService.getNumberPolicy(
  'TRIAL_DURATION_DAYS',
  'days',
  plan.tierId,
  plan.trialDays || 7,
);

const trialReuseEnabled = await this.policyService.getBooleanPolicy(
  'TRIAL_REUSE_PREVENTION',
  'enabled',
  plan.tierId,
  true,
);

const effectiveTrialDays = isFirstTime || !trialReuseEnabled ? trialDays : 0;
```

**체크리스트**:

- [ ] `createNewSubscription` 메서드 수정
- [ ] 체험 기간 정책 적용
- [ ] 체험 재사용 방지 정책 적용
- [ ] 이벤트 메타데이터에 정책 정보 기록
- [ ] 기존 테스트 업데이트

### Task 2.3: 일시정지 정책 적용

**파일**: `apps/membership/src/services/pause.service.ts`

**변경 전**:

```typescript
// ❌ 하드코딩
const MIN_PAUSE_DAYS = 7;
const MAX_PAUSE_DAYS = 90;
const MAX_PAUSES_PER_YEAR = 2;
```

**변경 후**:

```typescript
// ✅ 정책 테이블에서 조회
const minDays = await this.policyService.getNumberPolicy(
  'MIN_PAUSE_DURATION_DAYS',
  'days',
  tierId,
  7,
);

const maxDays = await this.policyService.getNumberPolicy(
  'MAX_PAUSE_DURATION_DAYS',
  'days',
  tierId,
  90,
);

const maxPausesPerYear = await this.policyService.getNumberPolicy(
  'MAX_PAUSES_PER_YEAR',
  'count',
  tierId,
  2,
);
```

**체크리스트**:

- [ ] `validatePauseRequest` 메서드 수정
- [ ] 최소/최대 기간 정책 적용
- [ ] 연간 최대 횟수 정책 적용
- [ ] 블랙아웃 기간 정책 적용
- [ ] 쿨다운 기간 정책 적용

---

## 📊 Phase 3: 초기 데이터 및 마이그레이션 (0.5일)

### Task 3.1: 스키마 확장

**파일**: `apps/membership/src/shared/schemas/entities/schema.ts`

**체크리스트**:

- [ ] `policyRuleTypeEnum`에 새 정책 타입 추가
- [ ] 기존 `subscriptionPolicies` 테이블 확인
- [ ] 필요시 인덱스 추가

### Task 3.2: 초기 데이터 마이그레이션

**파일**: `apps/membership/migrations/add-default-policies.sql`

```sql
-- 환불 정책
INSERT INTO subscription_policies (rule_type, rule_value, tier_id, is_active)
VALUES
  ('TRIAL_REFUND_ENABLED', '{"enabled": true}', NULL, true),
  ('RESUBSCRIPTION_REFUND_WINDOW_HOURS', '{"hours": 24}', NULL, true),
  ('BENEFIT_USAGE_AFFECTS_REFUND', '{"enabled": true}', NULL, true);

-- 체험 정책
INSERT INTO subscription_policies (rule_type, rule_value, tier_id, is_active)
VALUES
  ('TRIAL_DURATION_DAYS', '{"days": 7}', NULL, true),
  ('TRIAL_REUSE_PREVENTION', '{"enabled": true}', NULL, true);

-- 일시정지 정책
INSERT INTO subscription_policies (rule_type, rule_value, tier_id, is_active)
VALUES
  ('MIN_PAUSE_DURATION_DAYS', '{"days": 7}', NULL, true),
  ('MAX_PAUSE_DURATION_DAYS', '{"days": 90}', NULL, true),
  ('MAX_PAUSES_PER_YEAR', '{"count": 2}', NULL, true);
```

**체크리스트**:

- [ ] 마이그레이션 스크립트 작성
- [ ] 기본 정책 데이터 삽입
- [ ] 티어별 차별화 정책 예시 추가
- [ ] 롤백 스크립트 준비

---

## 🧪 Phase 4: 통합 테스트 및 검증 (0.5일)

### Task 4.1: 통합 테스트

**파일**: `apps/membership/test/integration/membership-policy.integration.spec.ts`

**체크리스트**:

- [ ] 환불 정책 통합 테스트
- [ ] 체험 정책 통합 테스트
- [ ] 일시정지 정책 통합 테스트
- [ ] 티어별 정책 차별화 테스트
- [ ] 정책 변경 시 즉시 반영 테스트

### Task 4.2: 기존 테스트 업데이트

**체크리스트**:

- [ ] `subscription-cancellation.integration.spec.ts` 업데이트
- [ ] `recurring-billing-pause.integration.spec.ts` 업데이트
- [ ] 모든 테스트 통과 확인

---

## 🎛️ Phase 5: 관리 기능 (선택사항)

### Task 5.1: Admin API

**파일**: `apps/membership/src/controllers/policy-admin.controller.ts`

```typescript
@Controller('admin/policies')
export class PolicyAdminController {
  @Get()
  async listPolicies(@Query() query: ListPoliciesDto) {}

  @Post()
  async createPolicy(@Body() dto: CreatePolicyDto) {}

  @Put(':id')
  async updatePolicy(@Param('id') id: string, @Body() dto: UpdatePolicyDto) {}

  @Delete(':id')
  async deactivatePolicy(@Param('id') id: string) {}
}
```

**체크리스트**:

- [ ] 정책 목록 조회 API
- [ ] 정책 생성 API
- [ ] 정책 수정 API
- [ ] 정책 비활성화 API
- [ ] 권한 검증 (Admin만 접근)

---

## 📝 구현 가이드라인

### 1. 의존성 주입

```typescript
// subscription-cancellation.manager.ts
constructor(
  private readonly dbService: DbService,
  private readonly contractEventManager: ContractEventManager,
  private readonly policyService: MembershipPolicyService, // ✅ 추가
) {}
```

### 2. 에러 처리

```typescript
try {
  const policy = await this.policyService.getPolicy('TRIAL_DURATION_DAYS');
} catch (error) {
  this.logger.error('Failed to load policy', { error });
  // 기본값 사용 또는 에러 전파
}
```

### 3. 로깅

```typescript
this.logger.info('Policy applied', {
  ruleType: 'RESUBSCRIPTION_REFUND_WINDOW_HOURS',
  value: refundWindowHours,
  tierId,
  userId,
});
```

### 4. 캐시 무효화

```typescript
// 정책 변경 시
await this.policyService.upsertPolicy('TRIAL_DURATION_DAYS', { days: 14 });
// → 자동으로 관련 캐시 무효화됨
```

---

## ✅ 완료 기준

### Phase 1 완료 기준

- [ ] PolicyService 모든 메서드 구현 완료
- [ ] 단위 테스트 90% 이상 커버리지
- [ ] 타입 안전성 확보

### Phase 2 완료 기준

- [ ] 3개 서비스에 정책 적용 완료
- [ ] 기존 하드코딩 제거
- [ ] 모든 기존 테스트 통과

### Phase 3 완료 기준

- [ ] 마이그레이션 성공적으로 실행
- [ ] 기본 정책 데이터 정상 삽입
- [ ] 롤백 테스트 완료

### Phase 4 완료 기준

- [ ] 통합 테스트 모두 통과
- [ ] 정책 변경 시 즉시 반영 확인
- [ ] 성능 테스트 (캐싱 효과 확인)

---

## 🚨 주의사항

### 1. 하위 호환성

- 기존 하드코딩된 값을 기본값으로 사용
- 정책이 없어도 서비스 정상 동작 보장

### 2. 성능

- 캐싱으로 DB 부하 최소화
- 정책 조회 실패 시 빠른 fallback

### 3. 데이터 정합성

- 정책 값 검증 로직 추가
- 잘못된 정책으로 인한 서비스 장애 방지

### 4. 모니터링

- 정책 적용 로그 남기기
- 정책 변경 이력 추적

---

## 📊 예상 효과

### Before (하드코딩)

```typescript
const TRIAL_DAYS = 7; // 코드 수정 필요
const REFUND_WINDOW = 24; // 배포 필요
```

### After (정책 테이블)

```sql
-- 즉시 반영!
UPDATE subscription_policies
SET rule_value = '{"days": 14}'
WHERE rule_type = 'TRIAL_DURATION_DAYS';
```

### 비즈니스 임팩트

- ✅ 정책 변경 시간: 1주일 → 1분
- ✅ 티어별 차별화 서비스 가능
- ✅ A/B 테스트 용이
- ✅ 프로모션 기간 정책 자동 적용

---

**총 예상 소요 시간: 4일**

- Phase 1: 1일
- Phase 2: 2일
- Phase 3: 0.5일
- Phase 4: 0.5일
- Phase 5: 선택사항 (1일)
