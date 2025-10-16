# 멤버십 서비스 레이어 리팩토링 TASK

## 📋 전체 개요

**목표**: 모든 멤버십 서비스를 레이어 아키텍처 규칙에 맞게 리팩토링  
**기간**: 4-5일  
**담당자**: 시니어 개발자

## 🎯 Phase 1: EntitlementService 리팩토링 (1일)

### Task 1.1: EntitlementReader 생성

**예상 시간**: 2시간

**구현 내용**:

```typescript
// apps/membership/src/services/entitlement/entitlement.reader.ts
@Injectable()
export class EntitlementReader {
  async findActiveEntitlement(userId: string): Promise<Entitlement | null>;
  async getUserEntitlementDetails(userId: string);
  async findById(entitlementId: string): Promise<Entitlement | null>;
}
```

**체크리스트**:

- [ ] `entitlement/entitlement.reader.ts` 파일 생성
- [ ] `findActiveEntitlement` 메서드 구현
- [ ] `getUserEntitlementDetails` 메서드 구현 (기존 getUserEntitlement 로직 이동)
- [ ] `findById` 메서드 구현
- [ ] 타입 정의 추가

### Task 1.2: EntitlementManager 생성

**예상 시간**: 3시간

**구현 내용**:

```typescript
// apps/membership/src/services/entitlement/entitlement.manager.ts
@Injectable()
export class EntitlementManager {
  async createEntitlement(tx, userId, tierId, startsAt, endsAt, sourceBatchId);
  async adjustEntitlement(userId, days, reason, adminId);
  async expireEntitlement(entitlementId, userId);
  async terminateActiveEntitlement(tx, userId, closedBatchId);
}
```

**체크리스트**:

- [ ] `entitlement/entitlement.manager.ts` 파일 생성
- [ ] `createEntitlement` 메서드 구현 (기존 로직 이동)
- [ ] `adjustEntitlement` 메서드 구현 (기존 로직 이동)
- [ ] `expireEntitlement` 메서드 구현 (Lazy Expiration 로직 이동)
- [ ] `terminateActiveEntitlement` 메서드 구현
- [ ] 트랜잭션 처리 확인
- [ ] 이벤트 소싱 연동 확인

### Task 1.3: EntitlementService 리팩토링

**예상 시간**: 2시간

**구현 내용**:

```typescript
// apps/membership/src/services/entitlement.service.ts
@Injectable()
export class EntitlementService {
  constructor(
    private readonly reader: EntitlementReader,
    private readonly manager: EntitlementManager,
  ) {}

  // ✅ 2-3줄로 흐름만 표현
  async checkAndUpdateSubscription(userId: string): Promise<boolean>;
  async getUserEntitlement(userId: string);
  async createEntitlement(tx, userId, tierId, startsAt, endsAt, sourceBatchId);
  async adjustEntitlement(userId, days, reason, adminId);
}
```

**체크리스트**:

- [ ] 기존 EntitlementService 백업
- [ ] Reader/Manager 주입
- [ ] 모든 메서드를 2-3줄로 리팩토링
- [ ] 검증 로직 제거 (Manager로 이동)
- [ ] DB 접근 제거 (Reader/Manager로 이동)

### Task 1.4: 모듈 업데이트 및 테스트

**예상 시간**: 1시간

**체크리스트**:

- [ ] `app.module.ts`에 EntitlementReader, EntitlementManager 추가
- [ ] 기존 테스트 실행 및 수정
- [ ] 새로운 단위 테스트 작성
- [ ] 진단 확인 (에러 없음)

---

## 🎯 Phase 2: SubscriptionService 리팩토링 (1-2일)

### Task 2.1: SubscriptionCreator 생성

**예상 시간**: 3시간

**구현 내용**:

```typescript
// apps/membership/src/services/subscription/subscription.creator.ts
@Injectable()
export class SubscriptionCreator {
  async createNewSubscription(
    userId: string,
    plan: Plan,
    tier: Tier,
  ): Promise<{ contractId: string; entitlementId: string }>;
}
```

**체크리스트**:

- [ ] `subscription/subscription.creator.ts` 파일 생성
- [ ] `createNewSubscription` 메서드 구현
- [ ] 계약 생성 로직 이동
- [ ] 권한 생성 로직 이동
- [ ] 이벤트 배치 생성 로직 이동
- [ ] 트랜잭션 처리

### Task 2.2: SubscriptionManager 생성

**예상 시간**: 3시간

**구현 내용**:

```typescript
// apps/membership/src/services/subscription/subscription.manager.ts
@Injectable()
export class SubscriptionManager {
  async upgradeSubscription(userId, currentContract, newPlan, newTier);
  async downgradeSubscription(userId, currentContract, newPlan, newTier);
  async voidSubscription(userId, contract, reason);
}
```

**체크리스트**:

- [ ] `subscription/subscription.manager.ts` 파일 생성
- [ ] `upgradeSubscription` 메서드 구현
- [ ] `downgradeSubscription` 메서드 구현
- [ ] `voidSubscription` 메서드 구현
- [ ] 티어 우선순위 검증 로직
- [ ] 이벤트 소싱 연동

### Task 2.3: SubscriptionService 리팩토링

**예상 시간**: 2시간

**구현 내용**:

```typescript
// apps/membership/src/services/subscription.service.ts
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly planService: PlanService,
    private readonly contractReader: SubscriptionContractReader,
    private readonly subscriptionCreator: SubscriptionCreator,
    private readonly subscriptionManager: SubscriptionManager,
  ) {}

  // ✅ 모든 메서드를 2-3줄로 리팩토링
  async createSubscription(userId, planId);
  async getCurrentSubscriptionDetails(userId);
  async upgradeSubscription(userId, newPlanId);
  async cancelSubscription(userId, reason);
  async getSubscriptionHistory(userId);
}
```

**체크리스트**:

- [ ] 기존 SubscriptionService 백업
- [ ] Creator/Manager 주입
- [ ] `createSubscription` 리팩토링 (2-3줄)
- [ ] `upgradeSubscription` 리팩토링 (2-3줄)
- [ ] `cancelSubscription` 리팩토링 (2-3줄)
- [ ] 모든 검증 로직 제거

### Task 2.4: 테스트 업데이트

**예상 시간**: 2시간

**체크리스트**:

- [ ] `app.module.ts` 업데이트
- [ ] 기존 테스트 수정
- [ ] Creator 단위 테스트 작성
- [ ] Manager 단위 테스트 작성
- [ ] 통합 테스트 실행

---

## 🎯 Phase 3: PauseService 리팩토링 (0.5일)

### Task 3.1: PauseManager 생성

**예상 시간**: 2시간

**구현 내용**:

```typescript
// apps/membership/src/services/pause/pause.manager.ts
@Injectable()
export class PauseManager {
  async createPause(userId, entitlement, pauseDays, reason);
  async cancelPause(userId, entitlement, reason);
  async extendPause(userId, entitlement, additionalDays, reason);
}
```

**체크리스트**:

- [ ] `pause/pause.manager.ts` 파일 생성
- [ ] `createPause` 메서드 구현
- [ ] `cancelPause` 메서드 구현
- [ ] `extendPause` 메서드 구현
- [ ] 일시정지 이벤트 생성 로직

### Task 3.2: PauseService 리팩토링

**예상 시간**: 1시간

**구현 내용**:

```typescript
// apps/membership/src/services/pause.service.ts
@Injectable()
export class PauseService {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly pauseManager: PauseManager,
  ) {}

  // ✅ 2-3줄로 리팩토링
  async pauseSubscription(userId, pauseDays, reason);
  async cancelPause(userId, reason);
}
```

**체크리스트**:

- [ ] PauseManager 주입
- [ ] `pauseSubscription` 리팩토링
- [ ] `cancelPause` 리팩토링
- [ ] 테스트 업데이트

### Task 3.3: 테스트 및 검증

**예상 시간**: 1시간

**체크리스트**:

- [ ] `app.module.ts` 업데이트
- [ ] 단위 테스트 작성
- [ ] 통합 테스트 실행
- [ ] 진단 확인

---

## 🎯 Phase 4: PlanService 리팩토링 (0.5일)

### Task 4.1: PlanReader 생성

**예상 시간**: 1시간

**구현 내용**:

```typescript
// apps/membership/src/services/plan/plan.reader.ts
@Injectable()
export class PlanReader {
  async findPlanDetails(planId: string);
  async findAllActivePlans();
  async findPlansByTier(tierId: string);
}
```

**체크리스트**:

- [ ] `plan/plan.reader.ts` 파일 생성
- [ ] 플랜 조회 로직 이동
- [ ] 티어 조회 로직 이동

### Task 4.2: PlanManager 생성

**예상 시간**: 1시간

**구현 내용**:

```typescript
// apps/membership/src/services/plan/plan.manager.ts
@Injectable()
export class PlanManager {
  async createPlan(tierId, price, durationDays, trialDays, adminId);
  async updatePlan(planId, updates, adminId);
  async deactivatePlan(planId, adminId);
}
```

**체크리스트**:

- [ ] `plan/plan.manager.ts` 파일 생성
- [ ] 플랜 생성 로직 이동
- [ ] 플랜 수정 로직 이동
- [ ] 플랜 비활성화 로직 이동

### Task 4.3: PlanService 리팩토링

**예상 시간**: 1시간

**체크리스트**:

- [ ] Reader/Manager 주입
- [ ] 모든 메서드 2-3줄로 리팩토링
- [ ] 테스트 업데이트

---

## 🎯 Phase 5: 서비스 통합 및 정리 (1일)

### Task 5.1: 서비스 통합 검토

**예상 시간**: 2시간

**검토 사항**:

- [ ] SubscriptionService에 취소 기능 통합 가능 여부
- [ ] EntitlementService 독립성 유지 필요성
- [ ] PauseService 독립성 유지 필요성

**결정**:

```
Option 1: 현재 구조 유지 (권장)
- SubscriptionService: 구독 생성/변경
- SubscriptionCancellationService: 구독 취소 (별도)
- EntitlementService: 권한 관리
- PauseService: 일시정지

Option 2: 완전 통합
- SubscriptionService: 모든 구독 관련 기능 통합
```

### Task 5.2: 디렉토리 구조 정리

**예상 시간**: 1시간

**최종 구조**:

```
apps/membership/src/services/
├── subscription.service.ts
├── entitlement.service.ts
├── pause.service.ts
├── plan.service.ts
├── benefit-tracking.service.ts
├── recurring-billing.service.ts
│
├── subscription/
│   ├── subscription.creator.ts
│   ├── subscription.manager.ts
│   ├── subscription-contract.reader.ts
│   └── subscription-cancellation.manager.ts
│
├── entitlement/
│   ├── entitlement.reader.ts
│   └── entitlement.manager.ts
│
├── pause/
│   └── pause.manager.ts
│
└── plan/
    ├── plan.reader.ts
    └── plan.manager.ts
```

**체크리스트**:

- [ ] 디렉토리 구조 정리
- [ ] import 경로 업데이트
- [ ] 파일명 규칙 확인

### Task 5.3: 전체 테스트 실행

**예상 시간**: 2시간

**체크리스트**:

- [ ] 모든 단위 테스트 실행
- [ ] 모든 통합 테스트 실행
- [ ] E2E 테스트 실행
- [ ] 진단 확인 (에러 없음)

### Task 5.4: 문서화

**예상 시간**: 2시간

**체크리스트**:

- [ ] 레이어 아키텍처 가이드 업데이트
- [ ] API 문서 업데이트
- [ ] 코드 주석 추가
- [ ] README 업데이트

---

## 📊 전체 일정 요약

| Phase       | 작업 내용                    | 예상 시간      | 완료 기준                 |
| ----------- | ---------------------------- | -------------- | ------------------------- |
| **Phase 1** | EntitlementService 리팩토링  | 8시간 (1일)    | Reader/Manager 분리 완료  |
| **Phase 2** | SubscriptionService 리팩토링 | 10시간 (1.5일) | Creator/Manager 분리 완료 |
| **Phase 3** | PauseService 리팩토링        | 4시간 (0.5일)  | Manager 분리 완료         |
| **Phase 4** | PlanService 리팩토링         | 3시간 (0.5일)  | Reader/Manager 분리 완료  |
| **Phase 5** | 통합 및 정리                 | 7시간 (1일)    | 모든 테스트 통과          |

**총 예상 시간**: 32시간 (약 4일)

---

## ✅ 완료 체크리스트

### 기능 완료

- [ ] EntitlementService 리팩토링 완료
- [ ] SubscriptionService 리팩토링 완료
- [ ] PauseService 리팩토링 완료
- [ ] PlanService 리팩토링 완료

### 품질 보증

- [ ] 모든 Service가 2-3줄로 작성됨
- [ ] 모든 검증 로직이 Manager로 이동
- [ ] 모든 DB 접근이 Reader/Manager로 이동
- [ ] 모든 테스트 통과

### 레이어 규칙 준수

- [ ] Service는 Reader/Manager만 호출
- [ ] Reader는 조회만 수행
- [ ] Manager는 검증+로직+DB 담당
- [ ] 파일명이 규칙을 따름

### 문서화

- [ ] 코드 주석 작성
- [ ] API 문서 업데이트
- [ ] 아키텍처 가이드 업데이트
- [ ] README 업데이트

---

## 🔧 개발 가이드

### 리팩토링 순서

1. Reader 생성 (조회 로직 이동)
2. Manager 생성 (검증+로직+DB 이동)
3. Service 리팩토링 (2-3줄로 단순화)
4. 테스트 업데이트
5. 모듈 업데이트

### 주의사항

- 기존 코드 백업 필수
- 단계별로 테스트 실행
- 진단 확인 후 다음 단계 진행
- 하위 호환성 유지

### 테스트 전략

- Service: Mock을 사용한 단위 테스트
- Manager: 실제 로직 검증
- Reader: 조회 결과 검증
- 통합 테스트: 전체 플로우 검증

---

## 📞 문의 및 지원

**담당자**: 시니어 개발자  
**검토자**: CTO  
**예상 완료일**: 2025년 10월 20일

각 Phase 완료 시 검토 요청 예정입니다.

---

## 📊 Phase 1 완료 보고서

### ✅ Task 1.1-1.4 완료 (2025-10-16)

**완료된 작업**:

1. ✅ EntitlementReader 생성 완료
2. ✅ EntitlementManager 생성 완료
3. ✅ EntitlementService 리팩토링 완료 (2-3줄)
4. ✅ 모듈 업데이트 및 테스트 통과

**생성된 파일**:

- `apps/membership/src/services/entitlement/entitlement.reader.ts`
- `apps/membership/src/services/entitlement/entitlement.manager.ts`
- `apps/membership/src/services/entitlement.service.ts` (리팩토링)

**테스트 결과**:

- 모든 단위 테스트 통과 (4/4)
- 타입 에러 없음
- 레이어 아키텍처 규칙 준수

**코드 리뷰 결과**:

- ✅ 코드 품질: 우수
- ✅ 레이어 분리: 완벽
- ✅ 타입 안정성: 확보
- ✅ 테스트 커버리지: 양호

**개선 사항**:

- PlanService 의존성 제거됨 (미사용)
- Service 메서드가 2-3줄로 단순화됨
- Reader/Manager 역할 명확히 분리됨

**다음 단계**: Phase 2 - SubscriptionService 리팩토링

---

## 📊 Phase 2 완료 보고서

### ✅ Task 2.1-2.4 완료 (2025-10-16)

**완료된 작업**:

1. ✅ SubscriptionCreator 생성 완료
2. ✅ SubscriptionManager 생성 완료
3. ✅ SubscriptionService 리팩토링 완료 (2-3줄)
4. ✅ 모듈 업데이트 및 테스트 통과

**생성된 파일**:

- `apps/membership/src/services/subscription/subscription.creator.ts`
- `apps/membership/src/services/subscription/subscription.manager.ts`
- `apps/membership/src/services/subscription.service.ts` (리팩토링)
- `apps/membership/src/services/subscription/subscription-contract.reader.ts` (확장)

**테스트 결과**:

- 모든 단위 테스트 통과 (4/4)
- 타입 에러 없음
- 레이어 아키텍처 규칙 준수

**코드 리뷰 결과**:

- ✅ 코드 품질: 우수
- ✅ 레이어 분리: 완벽
- ✅ 타입 안정성: 확보
- ✅ 테스트 커버리지: 양호

**개선 사항**:

1. SubscriptionManager의 fromTierId 처리 수정 필요
   - 현재: `fromTierId: currentContract.planId` (잘못됨)
   - 수정: 현재 티어 ID를 파라미터로 전달받아 사용
2. Service 메서드가 2-3줄로 단순화됨
3. Creator/Manager 역할 명확히 분리됨

**다음 단계**: 개선사항 반영 후 커밋
