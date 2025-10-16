---
alwaysApply: true
---

# Layer Architecture Rules - 레이어 아키텍처 규칙

## 핵심 철학

**비즈니스 로직은 상세 구현을 모르더라도 흐름을 이해할 수 있어야 한다.**

신규 개발자, 사업 담당자, 영업 담당자에게 코드를 보면서 "대충 이런 흐름이다"라고 설명 가능한 수준이 이상적이다.

**Service는 2-3줄로 비즈니스 흐름만 표현해야 한다.**

---

## 레이어 정의

### 1. Presentation Layer (Controller)

- **책임**: 외부 변화에 민감한 영역
- **포함**: HTTP/GraphQL/WebSocket 처리, DTO 검증, 인증/인가, Error → Response 변환
- **특징**: 외부 의존성이 높은 영역, 요청/응답 클래스
- **파일명 규칙**: `xxx.controller.ts`
- **예시**: `payment.controller.ts`, `user.controller.ts`

---

### 2. Business Layer (Service - Port)

- **책임**: 비즈니스 흐름만 표현 (2-3줄 권장)
- **포함**: 도메인 규칙, 비즈니스 흐름 중계
- **특징**
  - **검증 로직을 갖지 않음** (Manager가 담당)
  - **상세 구현 로직을 갖지 않음** (Manager가 담당)
  - 협력 도구 클래스들을 중계하는 역할
  - 각 협력 도구가 명시적으로 한 가지 일을 담당하도록 조율
  - 실패 시 `throw new Error("명확한 메시지")` 사용
- **파일명 규칙**: `xxx.service.ts` (도메인명 + Service)
- **예시**: `bnpl.service.ts`, `payment.service.ts`, `refund.service.ts`

**✅ 좋은 예시 (3줄)**

```typescript
@Injectable()
export class BnplService {
  constructor(
    private readonly accountReader: BnplAccountReader,
    private readonly creditManager: BnplCreditManager,
  ) {}

  // ✅ 흐름만 표현: "계정 찾고 → 신용 사용"
  async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
    const account = await this.accountReader.findByUserId(userId);
    await this.creditManager.useCreditForPurchase(
      account,
      amount,
      orderId,
      intentId,
      tx,
    );
  }
}
```

**❌ 나쁜 예시 (15줄 - 검증 로직 포함)**

```typescript
// ❌ Service에 검증 로직이 있으면 안 됨
async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  if (!account) throw new Error('Account not found');           // ❌
  if (account.status !== 'ACTIVE') throw new Error('...');      // ❌
  if (account.availableLimit < amount) throw new Error('...');  // ❌

  const event = await this.eventManager.createEvent(...);       // ❌
  await this.creditManager.useCredit(account, amount, tx);      // ❌
  return event;
}
```

---

### 3. Implementation Layer

- **책임**: 모든 비즈니스 로직 담당 (검증 + 실행 + DB 접근)
- **포함**: 데이터 조회/검증, 엔티티 생성/수정, 비즈니스 규칙 실행
- **특징**
  - 가장 많은 클래스가 존재
  - 재사용성이 높은 핵심 레이어
  - 각 클래스는 명확한 단일 책임을 가짐
  - **검증 로직은 여기서 수행**

#### 파일명 규칙 및 역할별 예시

| 유형                    | 설명                             | 파일명 규칙         | 예시                      |
| ----------------------- | -------------------------------- | ------------------- | ------------------------- |
| **Reader**              | 데이터 조회 (레이어 규칙 준수용) | `xxx.reader.ts`     | `bnpl-account.reader.ts`  |
| **Manager**             | 비즈니스 로직 + 검증 + DB 접근   | `xxx.manager.ts`    | `bnpl-credit.manager.ts`  |
| **Creator**             | 신규 엔티티 생성                 | `xxx.creator.ts`    | `bnpl-account.creator.ts` |
| **Validator**           | 입력/도메인 검증                 | `xxx.validator.ts`  | `payment.validator.ts`    |
| **Calculator / Policy** | 계산 / 정책 로직                 | `xxx.calculator.ts` | `discount.policy.ts`      |

#### Reader의 역할

**중요:** Reader는 "단순 wrapping"처럼 보이지만 **레이어 규칙 준수를 위한 필수 레이어**

```typescript
// ✅ Reader - Service와 Repository 사이의 중간 레이어
@Injectable()
export class BnplAccountReader {
  constructor(private readonly repo: BnplRepository) {}

  // 단순 조회
  async findByUserId(userId: string): Promise<BnplAccount | null> {
    return await this.repo.findAccountByUserId(userId);
  }

  // 복잡한 조회 (검증 포함 가능)
  async findActiveAccount(userId: string): Promise<BnplAccount> {
    const account = await this.repo.findAccountByUserId(userId);
    if (!account) throw new Error('Account not found');
    if (account.status !== 'ACTIVE') throw new Error('Account not active');
    return account;
  }
}
```

**왜 필요한가?**

- Service가 Repository를 직접 참조하면 **규칙 3 위반** (레이어 건너뛰기)
- Reader는 Service와 Repository 사이의 중간 레이어 역할

#### Manager의 역할

**핵심:** Manager는 **검증 + 비즈니스 로직 + DB 접근**을 모두 담당

```typescript
// ✅ Manager - 모든 비즈니스 로직 담당
@Injectable()
export class BnplCreditManager {
  constructor(private readonly repo: BnplRepository) {}

  async useCreditForPurchase(account, amount, orderId, intentId, tx) {
    // 1. 검증 (Manager가 담당!)
    if (!account) throw new Error('Account not found');
    if (account.status !== 'ACTIVE') throw new Error('Account not active');
    if (account.availableLimit < amount) throw new Error('Insufficient credit');

    // 2. 이벤트 생성
    const event = await this.repo.createEvent({...}, tx);
    await this.repo.createEventDetail({...}, tx);

    // 3. 한도 차감
    await this.repo.updateAccount(account.id, {
      availableLimit: account.availableLimit - amount
    }, tx);
  }
}
```

**규칙**

- 한 파일 = 한 책임
- 내부적으로 Repository 사용 가능
- 동일 레이어 간 협력 가능
- 외부(Service, Controller) 참조 불가
- **검증 로직은 Manager에서 수행**

---

### 4. Data Access Layer (Repository / Client)

- **책임**: 다양한 자원(DB, 외부 API 등)에 접근하는 기능 제공
- **포함**: DB 접근, 외부 API 호출, Kafka 메시징
- **특징**
  - 기술 의존성을 격리
  - 구현 로직에 순수한 인터페이스 제공
  - **도메인당 1개의 Repository** (테이블마다 만들지 않음)

- **파일명 규칙**:
  - DB 접근: `xxx.repository.ts` (도메인명 + Repository)
  - 외부 API: `xxx.client.ts`

- **예시**: `bnpl.repository.ts`, `payment.repository.ts`, `toss.client.ts`

**✅ 도메인 통합 Repository**

```typescript
// ✅ 도메인당 1개의 Repository
@Injectable()
export class BnplRepository {
  constructor(private readonly db: DbService<typeof walletSchema>) {}

  // Account 관련
  async findAccountByUserId(userId: string) { ... }
  async createAccount(data: any, tx?: any) { ... }
  async updateAccount(accountId: string, data: any, tx?: any) { ... }

  // Event 관련
  async createEvent(data: any, tx?: any) { ... }
  async findEventsByBatchId(batchId: string, tx?: any) { ... }

  // CMS Response 관련
  async createCmsResponse(data: any, tx?: any) { ... }
  async findCmsResponsesByBatchId(batchId: string) { ... }
}
```

**❌ 테이블마다 Repository (과도한 추상화)**

```typescript
// ❌ 테이블마다 Repository를 만들지 않음
class BnplAccountRepository { ... }
class BnplEventRepository { ... }
class BnplCmsResponseRepository { ... }
```

---

## 4가지 핵심 규칙

### ✅ 규칙 1: 레이어는 위에서 아래로 순방향으로만 참조

```
Controller → Service → Reader/Manager → Repository
```

### ❌ 규칙 2: 레이어의 참조 방향이 역류되지 않아야 함

- `Manager`가 `Service`를 참조하면 안 됨
- `Service`가 `Controller`를 참조하면 안 됨
- Implementation이 Business를 알면 안 됨
- Business가 Presentation을 알면 안 됨

### ❌ 규칙 3: 레이어의 참조가 하위 레이어를 건너뛰지 않아야 함

**중요:** Service가 Repository를 직접 참조하면 안 됨!

```typescript
// ❌ Service가 Repository 직접 참조 (규칙 위반)
class BnplService {
  constructor(private readonly repo: BnplRepository) {}

  async purchaseWithCredit(userId, amount, ...) {
    const account = await this.repo.findAccountByUserId(userId);  // ❌
  }
}

// ✅ Service가 Reader 참조 → Reader가 Repository 참조
class BnplService {
  constructor(private readonly accountReader: BnplAccountReader) {}

  async purchaseWithCredit(userId, amount, ...) {
    const account = await this.accountReader.findByUserId(userId);  // ✅
  }
}
```

**규칙:**

- Business Layer가 Data Access Layer를 직접 참조 ❌
- Service가 Repository 직접 참조 ❌
- Business Layer는 Implementation Layer만 사용 ✅
- Implementation Layer는 Data Access Layer를 사용 ✅

### ❌ 규칙 4: 동일 레이어 간에는 서로 참조하지 않음 (단, Implementation Layer는 예외)

- Controller ↔ Controller ❌
- Service ↔ Service ❌
- Implementation ↔ Implementation ✅ (협력 가능)

---

## 실전 적용 가이드

### Service 작성 시 (2-3줄 권장)

```typescript
// ✅ 좋은 예시 - 흐름만 표현
async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  await this.creditManager.useCreditForPurchase(account, amount, orderId, intentId, tx);
}

// ✅ 좋은 예시 - 흐름만 표현
async completePayment(userId, amount, batchId, aggregationPeriod, tx) {
  const account = await this.accountReader.findByUserId(userId);
  await this.creditManager.restoreCreditForPayment(account, amount, batchId, aggregationPeriod, tx);
}
```

### Manager 작성 시 (검증 + 로직 + DB)

```typescript
// ✅ Manager - 모든 비즈니스 로직
async useCreditForPurchase(account, amount, orderId, intentId, tx) {
  // 1. 검증
  if (!account) throw new Error('Account not found');
  if (account.status !== 'ACTIVE') throw new Error('Account not active');
  if (account.availableLimit < amount) throw new Error('Insufficient credit');

  // 2. 비즈니스 로직 실행
  const event = await this.repo.createEvent({...}, tx);
  await this.repo.createEventDetail({...}, tx);

  // 3. DB 업데이트
  await this.repo.updateAccount(account.id, {...}, tx);
}
```

---

## 네이밍 규칙

### Service 네이밍

**패턴:** `{Domain}Service`

```typescript
// ✅ 도메인 대표 서비스
BnplService; // BNPL 도메인 일반 업무
BnplSettlementService; // BNPL 정산 특화
PaymentService; // Payment 도메인
RefundService; // Refund 도메인

// ❌ 기능 중심 네이밍 (역할이 불명확)
BnplAccountService; // 계정만 다루는 것처럼 보임
BnplTransactionService; // 트랜잭션만 다루는 것처럼 보임
```

### Implementation 네이밍

**패턴:** `{Domain}{Concept}.{role}.ts`

```typescript
// ✅ 명확한 역할 표현
bnpl - account.reader.ts; // BNPL 계정 조회
bnpl - credit.manager.ts; // BNPL 신용 관리
bnpl - account.creator.ts; // BNPL 계정 생성
bnpl - batch.creator.ts; // BNPL 배치 생성

// ❌ .impl 접미사 (역할 불명확)
bnpl - account - reader.impl.ts;
bnpl - credit - manager.impl.ts;
```

### Repository 네이밍

**패턴:** `{Domain}.repository.ts` (도메인당 1개)

```typescript
// ✅ 도메인 통합 Repository
bnpl.repository.ts; // BNPL 도메인 전체
payment.repository.ts; // Payment 도메인 전체

// ❌ 테이블마다 Repository (과도한 추상화)
bnpl - account.repository.ts;
bnpl - event.repository.ts;
bnpl - cms - response.repository.ts;
```

---

## Manager 통합 규칙

**원칙:** 관련된 도메인 행위는 하나의 Manager에 집중

```typescript
// ✅ BnplCreditManager - 신용 관련 모든 로직
class BnplCreditManager {
  useCreditForPurchase()      // 구매 시 신용 사용
  restoreCreditForPayment()   // 결제 성공 시 복원
  restoreCreditForFailure()   // 실패 시 복원
  markEventsAsAggregated()    // 이벤트 집계
  failEventsByBatch()         // 배치 실패
  updateNextBillingDate()     // 결제일 업데이트
}

// ❌ 역할별로 Manager 분리 (불필요한 복잡도)
class BnplCreditManager { useCredit(), restoreCredit() }
class BnplEventManager { createEvent(), markEvents() }
```

**이점:**

- 신용 관련 모든 로직이 한 곳에 집중
- 재사용성 향상
- 유지보수 용이

---

## AI 작성 시 체크리스트

### Service Layer

- [ ] Service 메서드가 2-3줄인가? ✅
- [ ] Service에 검증 로직이 없는가? ✅
- [ ] Service에 데이터 조회/생성 로직이 없는가? ✅
- [ ] Service가 Repository를 직접 참조하지 않는가? ✅
- [ ] Service 코드만 봐도 비즈니스 흐름이 이해되는가? ✅

### Implementation Layer

- [ ] Manager에 검증 로직이 있는가? ✅
- [ ] Manager가 비즈니스 로직을 담당하는가? ✅
- [ ] Reader가 레이어 규칙 준수를 위해 존재하는가? ✅
- [ ] 각 Implementation 클래스가 단일 책임을 가지는가? ✅
- [ ] 관련 로직이 하나의 Manager에 집중되어 있는가? ✅

### Repository Layer

- [ ] 도메인당 1개의 Repository인가? ✅
- [ ] 테이블마다 Repository를 만들지 않았는가? ✅

---

## 레이어 오염 방지

### Business Layer 금지 import

```typescript
// ❌ Service에서 import 금지
import { eq, and, lte } from 'drizzle-orm';
import { HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
```

### Implementation Layer 허용 import

```typescript
// ✅ Manager/Reader에서 import 가능
import { eq, and, lte } from 'drizzle-orm';
import { getTsid } from 'tsid-ts';
```

---

## 실전 예시: BNPL 도메인

### 최종 구조

```
apps/wallet/src/services/bnpl/
├── bnpl.service.ts              (Business Layer - 일반 업무)
├── bnpl-settlement.service.ts   (Business Layer - 정산 특화)
│
├── bnpl-account.reader.ts       (Implementation - Reader)
├── bnpl-account.creator.ts      (Implementation - Creator)
├── bnpl-credit.manager.ts       (Implementation - Manager) ⭐ 통합
├── bnpl-batch.creator.ts        (Implementation - Creator)
├── bnpl-cms.manager.ts          (Implementation - Manager)
├── bnpl-retry.manager.ts        (Implementation - Manager)
│
└── bnpl.repository.ts           (Data Access - 도메인 통합)
```

### Before & After

**Before (문제점):**

```typescript
// ❌ Service에 검증 로직 (15줄)
async createCreditEvent(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  if (!account) throw new Error('Account not found');
  if (account.status !== 'ACTIVE') throw new Error('...');
  if (account.availableLimit < amount) throw new Error('...');

  const event = await this.eventManager.createCreditEvent(...);
  await this.creditManager.useCredit(account, amount, tx);
  return event;
}
```

**After (개선):**

```typescript
// ✅ Service는 흐름만 (3줄)
async purchaseWithCredit(userId, amount, orderId, intentId, tx) {
  const account = await this.accountReader.findByUserId(userId);
  await this.creditManager.useCreditForPurchase(account, amount, orderId, intentId, tx);
}

// ✅ Manager가 모든 로직 담당
async useCreditForPurchase(account, amount, orderId, intentId, tx) {
  if (!account) throw new Error('Account not found');
  if (account.status !== 'ACTIVE') throw new Error('Account not active');
  if (account.availableLimit < amount) throw new Error('Insufficient credit');

  const event = await this.repo.createEvent({...}, tx);
  await this.repo.updateAccount(account.id, {...}, tx);
}
```

---

## 핵심 교훈

### 1. Reader의 존재 이유

- **처음 생각:** "단순 wrapping이라 무의미"
- **실제:** "레이어 규칙 준수를 위한 필수 레이어"
- Service가 Repository를 직접 참조하면 규칙 3 위반

### 2. Manager의 진짜 역할

- **처음 생각:** "단순히 Repository 호출만"
- **실제:** "검증 + 비즈니스 로직 + DB 접근을 모두 담당"

### 3. Service의 진짜 역할

- **처음 생각:** "검증, 조회, 생성, 업데이트를 직접"
- **실제:** "2-3줄로 비즈니스 흐름만 표현"

### 4. Repository 통합

- **처음 생각:** "테이블마다 Repository 필요"
- **실제:** "도메인당 1개의 Repository로 충분"

---

## 확장 가능성

- 비즈니스 복잡 시 상위 Layer (UseCase, Application Layer 등) 추가 가능
- 변경/확장 시 문서화
- 개발자 창의성 보장, 개방적 표준 유지

---

**이 규칙은 실전 경험을 바탕으로 작성되었습니다.**
