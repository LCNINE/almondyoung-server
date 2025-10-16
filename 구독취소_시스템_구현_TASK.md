# 구독 취소 시스템 구현 TASK

## 📋 전체 개요

**목표**: 구독 취소를 환불 가능 여부에 따라 자동 분기하는 통합 API 구현  
**기간**: 4-5일  
**담당자**: 시니어 개발자

## 🎯 Phase 1: Lazy Expiration 구현 (1일)

### Task 1.1: EntitlementService 확장

**예상 시간**: 3시간

**구현 내용**:

```typescript
// apps/membership/src/services/entitlement.service.ts
class EntitlementService {
  /**
   * 구독 상태 체크 및 자동 만료 처리
   * @param userId 사용자 ID
   * @returns 활성 구독 여부
   */
  async checkAndUpdateSubscription(userId: string): Promise<boolean>;

  /**
   * 만료된 권한을 이벤트와 함께 처리
   * @param entitlementId 권한 ID
   * @param userId 사용자 ID
   */
  private async expireEntitlementWithEvent(
    entitlementId: string,
    userId: string,
  ): Promise<void>;
}
```

**체크리스트**:

- [ ] `checkAndUpdateSubscription` 메서드 구현
- [ ] `expireEntitlementWithEvent` 메서드 구현
- [ ] 트랜잭션 처리 확인
- [ ] 이벤트 소싱 연동 (`SUBSCRIPTION_EXPIRED`)

### Task 1.2: 구독 상태 조회 API 수정

**예상 시간**: 2시간

**구현 내용**:

```typescript
// apps/membership/src/controllers/subscription.controller.ts
@Get('status')
/**
 * 구독 상태 조회 및 자동 정규화
 * @sideEffect 만료된 구독의 isCurrent 플래그를 false로 업데이트
 * @rationale 데이터 정합성 보장 및 성능 최적화
 */
async getSubscriptionStatus(@Req() req: FastifyRequest): Promise<SubscriptionStatusResponse>
```

**체크리스트**:

- [ ] 기존 상태 조회 API에 Lazy Expiration 적용
- [ ] API 문서에 사이드 이펙트 명시
- [ ] HTTP 헤더 추가 (`X-Side-Effect: data-normalization`)
- [ ] 응답 형식 정의

### Task 1.3: 단위 테스트 작성

**예상 시간**: 2시간

**체크리스트**:

- [ ] `checkAndUpdateSubscription` 테스트
- [ ] 만료 처리 로직 테스트
- [ ] 이벤트 생성 테스트
- [ ] 트랜잭션 롤백 테스트

### Task 1.4: 인덱스 추가

**예상 시간**: 1시간

**구현 내용**:

```sql
-- 성능 최적화용 인덱스
CREATE INDEX idx_entitlement_user_current_ends
ON subscription_entitlement(user_id, is_current, ends_at)
WHERE is_current = true;
```

**체크리스트**:

- [ ] 마이그레이션 스크립트 작성
- [ ] 인덱스 성능 테스트
- [ ] 롤백 스크립트 준비

---

## 🎯 Phase 2: 정기결제 중단 기능 (1-2일)

### Task 2.1: 데이터베이스 스키마 확장

**예상 시간**: 2시간

**구현 내용**:

```sql
-- subscription_contracts 테이블 확장
ALTER TABLE subscription_contracts
ADD COLUMN recurring_cancelled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN recurring_cancellation_reason_code TEXT,
ADD COLUMN auto_renewal BOOLEAN DEFAULT true;

-- 기존 데이터 업데이트
UPDATE subscription_contracts
SET auto_renewal = true
WHERE auto_renewal IS NULL;

-- 인덱스 추가
CREATE INDEX idx_contracts_auto_renewal
ON subscription_contracts(user_id, auto_renewal, status)
WHERE auto_renewal = true AND status = 'ACTIVE';
```

**체크리스트**:

- [ ] 마이그레이션 스크립트 작성
- [ ] 기존 데이터 무결성 확인
- [ ] 롤백 스크립트 준비
- [ ] 스키마 타입 정의 업데이트

### Task 2.2: 정기결제 중단 로직 구현

**예상 시간**: 4시간

**구현 내용**:

```typescript
// apps/membership/src/services/subscription-cancellation.service.ts
class SubscriptionCancellationService {
  /**
   * 정기결제 중단 처리
   * @param userId 사용자 ID
   * @param reasonCode 취소 이유 코드
   * @param reasonText 취소 이유 텍스트
   */
  private async cancelRecurringPayment(
    userId: string,
    reasonCode: string,
    reasonText?: string,
  ): Promise<RecurringCancellationResult>;
}
```

**체크리스트**:

- [ ] `cancelRecurringPayment` 메서드 구현
- [ ] 계약 상태 업데이트 로직
- [ ] `auto_renewal = false` 처리
- [ ] `nextBillingDate = null` 처리
- [ ] 이벤트 소싱 연동 (`RECURRING_CANCELLED`)

### Task 2.3: 응답 타입 정의

**예상 시간**: 1시간

**구현 내용**:

```typescript
// apps/membership/src/shared/dto/response.dto.ts
export interface RecurringCancellationResult {
  type: 'RECURRING_CANCELLATION';
  contractId: string;
  status: 'RECURRING_CANCELLED';
  recurringCancelledAt: Date;
  nextBillingDate: null;
  currentPeriodEndsAt: Date;
  autoRenewal: false;
  refundEligible: false;
  message: string;
}
```

**체크리스트**:

- [ ] 응답 타입 정의
- [ ] Swagger 문서 업데이트
- [ ] 유효성 검증 스키마 작성

### Task 2.4: 단위 테스트 작성

**예상 시간**: 3시간

**체크리스트**:

- [ ] 정기결제 중단 로직 테스트
- [ ] 상태 전이 테스트
- [ ] 이벤트 생성 테스트
- [ ] 에러 케이스 테스트

---

## 🎯 Phase 3: 통합 취소 API (1일)

### Task 3.1: 통합 취소 로직 구현

**예상 시간**: 4시간

**구현 내용**:

```typescript
// apps/membership/src/services/subscription-cancellation.service.ts
class SubscriptionCancellationService {
  /**
   * 통합 구독 취소 (자동 분기)
   * @param userId 사용자 ID
   * @param reasonCode 취소 이유 코드
   * @param reasonText 취소 이유 텍스트
   */
  async cancelSubscription(
    userId: string,
    reasonCode: string,
    reasonText?: string,
  ): Promise<CancellationResult | RecurringCancellationResult>;
}
```

**체크리스트**:

- [ ] 기존 `cancelSubscription` 메서드 수정
- [ ] 환불 가능 여부 자동 판단
- [ ] 즉시 취소 vs 정기결제 중단 분기
- [ ] 응답 타입 통합

### Task 3.2: 컨트롤러 수정

**예상 시간**: 2시간

**구현 내용**:

```typescript
// apps/membership/src/controllers/subscription.controller.ts
@Post('cancel')
async cancelSubscription(
  @Req() req: FastifyRequest,
  @Body() cancelDto: CancelSubscriptionRequest,
): Promise<CancellationResult | RecurringCancellationResult>
```

**체크리스트**:

- [ ] 기존 취소 API 수정
- [ ] 응답 형식 통일
- [ ] 에러 처리 개선
- [ ] API 문서 업데이트

### Task 3.3: 즉시 취소 로직 리팩토링

**예상 시간**: 2시간

**구현 내용**:

```typescript
// apps/membership/src/services/subscription-cancellation.service.ts
private async cancelImmediately(
  userId: string,
  reasonCode: string,
  reasonText?: string
): Promise<ImmediateCancellationResult>
```

**체크리스트**:

- [ ] 기존 즉시 취소 로직을 별도 메서드로 분리
- [ ] 응답 형식에 `type: 'IMMEDIATE_CANCELLATION'` 추가
- [ ] 이벤트 메타데이터에 `cancellationType` 추가

---

## 🎯 Phase 4: 테스트 및 검증 (1일)

### Task 4.1: 통합 테스트 작성

**예상 시간**: 3시간

**체크리스트**:

- [ ] 무료체험 중 취소 → 즉시 취소 시나리오
- [ ] 무료체험 후 취소 → 정기결제 중단 시나리오
- [ ] 만료된 구독 조회 → 자동 정규화 시나리오
- [ ] 이벤트 소싱 정합성 테스트

### Task 4.2: E2E 테스트 작성

**예상 시간**: 3시간

**구현 내용**:

```typescript
// apps/membership/test/integration/subscription-cancellation.integration.spec.ts
describe('구독 취소 통합 시나리오', () => {
  it('무료체험 중 취소 → 즉시 취소 + 환불', async () => {});
  it('무료체험 후 취소 → 정기결제 중단', async () => {});
  it('만료된 구독 조회 → 자동 정규화', async () => {});
});
```

**체크리스트**:

- [ ] 전체 플로우 E2E 테스트
- [ ] API 응답 형식 검증
- [ ] 데이터베이스 상태 검증
- [ ] 이벤트 생성 검증

### Task 4.3: 성능 테스트

**예상 시간**: 2시간

**체크리스트**:

- [ ] Lazy Expiration 성능 측정
- [ ] 인덱스 효과 검증
- [ ] 동시성 테스트
- [ ] 메모리 사용량 확인

---

## 🚀 배포 및 모니터링

### Task 5.1: 배포 준비

**예상 시간**: 2시간

**체크리스트**:

- [ ] 환경별 설정 확인
- [ ] 마이그레이션 스크립트 검증
- [ ] 롤백 계획 수립
- [ ] 배포 문서 작성

### Task 5.2: 모니터링 설정

**예상 시간**: 2시간

**체크리스트**:

- [ ] Lazy Expiration 실행 메트릭
- [ ] 취소 유형별 통계 대시보드
- [ ] 에러 알림 설정
- [ ] 성능 모니터링 설정

---

## 📊 전체 일정 요약

| Phase       | 작업 내용            | 예상 시간      | 완료 기준              |
| ----------- | -------------------- | -------------- | ---------------------- |
| **Phase 1** | Lazy Expiration 구현 | 8시간 (1일)    | 만료 자동 처리 동작    |
| **Phase 2** | 정기결제 중단 기능   | 10시간 (1.5일) | 정기결제 중단 API 동작 |
| **Phase 3** | 통합 취소 API        | 8시간 (1일)    | 자동 분기 동작         |
| **Phase 4** | 테스트 및 검증       | 8시간 (1일)    | 모든 테스트 통과       |
| **Phase 5** | 배포 및 모니터링     | 4시간 (0.5일)  | 프로덕션 배포 완료     |

**총 예상 시간**: 38시간 (약 5일)

## ✅ 완료 체크리스트

### 기능 완료

- [ ] Lazy Expiration 동작 확인
- [ ] 환불 가능 시 즉시 취소 동작 확인
- [ ] 환불 불가 시 정기결제 중단 동작 확인
- [ ] 이벤트 소싱 정상 동작 확인

### 품질 보증

- [ ] 모든 단위 테스트 통과
- [ ] 모든 통합 테스트 통과
- [ ] E2E 테스트 통과
- [ ] 성능 테스트 통과

### 문서화

- [ ] API 문서 업데이트
- [ ] 코드 주석 작성
- [ ] 배포 가이드 작성
- [ ] 운영 매뉴얼 작성

### 배포 준비

- [ ] 마이그레이션 스크립트 검증
- [ ] 롤백 계획 수립
- [ ] 모니터링 설정 완료
- [ ] 프로덕션 배포 완료

---

## 🔧 개발 환경 설정

### 필요한 도구

- Node.js 18+
- PostgreSQL 14+
- Redis (캐싱용, 선택사항)
- Docker (로컬 개발용)

### 로컬 개발 명령어

```bash
# 의존성 설치
npm install

# 데이터베이스 마이그레이션
npm run db:migrate

# 테스트 실행
npm run test
npm run test:e2e

# 개발 서버 실행
npm run start:dev
```

## 📞 문의 및 지원

**담당자**: 시니어 개발자  
**검토자**: CTO  
**예상 완료일**: 2025년 10월 21일

각 Phase 완료 시 검토 요청 예정입니다.
