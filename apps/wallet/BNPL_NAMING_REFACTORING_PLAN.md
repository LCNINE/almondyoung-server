# BNPL 서비스 네이밍 리팩토링 계획

## 📋 현재 상태 분석

### 현재 파일 구조

```
apps/wallet/src/services/bnpl/
├── bnpl-account.service.ts              (Business Layer)
├── bnpl-settlement.service.ts           (Business Layer)
├── bnpl-account-reader.impl.ts          (Implementation Layer) ❌ .impl 접미사
├── bnpl-account-creator.impl.ts         (Implementation Layer) ❌ .impl 접미사
├── bnpl-credit-manager.impl.ts          (Implementation Layer) ❌ .impl 접미사
├── bnpl-event-manager.impl.ts           (Implementation Layer) ❌ .impl 접미사
├── bnpl-batch-creator.impl.ts           (Implementation Layer) ❌ .impl 접미사
├── bnpl-cms-processor.impl.ts           (Implementation Layer) ❌ .impl 접미사
├── bnpl-retry-manager.impl.ts           (Implementation Layer) ❌ .impl 접미사
└── bnpl-cms-response.repository.ts      (Data Access Layer) ✅ 올바름
```

### 문제점

1. **`.impl.ts` 접미사 사용**
   - `layer-architecture.md`에 따르면 Implementation Layer는 역할별 명확한 이름을 사용해야 함
   - `.impl`은 "구현체"라는 의미만 전달하고, 실제 역할(Reader/Manager/Creator 등)이 불명확

2. **클래스명과 파일명 불일치**
   - 파일: `bnpl-account-reader.impl.ts`
   - 클래스: `BnplAccountReaderImpl`
   - 규칙에 따르면 `BnplAccountReader` / `bnpl-account.reader.ts`가 맞음

3. **역할 혼재**
   - `BnplCmsProcessorImpl` - "Processor"는 명확한 역할이 아님
   - `BnplBatchCreatorImpl` - Creator인지 Manager인지 불명확

## 🎯 리팩토링 목표

**layer-architecture.md 규칙 준수:**

| 역할             | 파일명 규칙         | 클래스명 규칙   |
| ---------------- | ------------------- | --------------- |
| Reader           | `xxx.reader.ts`     | `XxxReader`     |
| Manager          | `xxx.manager.ts`    | `XxxManager`    |
| Creator/Appender | `xxx.creator.ts`    | `XxxCreator`    |
| Validator        | `xxx.validator.ts`  | `XxxValidator`  |
| Repository       | `xxx.repository.ts` | `XxxRepository` |

## 📝 상세 리팩토링 계획

### Phase 1: 명확한 역할 분류

#### 1.1 Reader 역할 (데이터 조회)

```
현재: bnpl-account-reader.impl.ts (BnplAccountReaderImpl)
변경: bnpl-account.reader.ts (BnplAccountReader)

책임:
- findByUserId()
- findById()
- findAccountsForBilling()
- getUnbilledAmount()
```

#### 1.2 Creator 역할 (엔티티 생성)

```
현재: bnpl-account-creator.impl.ts (BnplAccountCreatorImpl)
변경: bnpl-account.creator.ts (BnplAccountCreator)

책임:
- create() - 새 BNPL 계정 생성
```

```
현재: bnpl-batch-creator.impl.ts (BnplBatchCreatorImpl)
변경: bnpl-batch.creator.ts (BnplBatchCreator)

책임:
- createBatch() - 월말 배치 생성
```

#### 1.3 Manager 역할 (상태 변경/도메인 행위)

```
현재: bnpl-credit-manager.impl.ts (BnplCreditManagerImpl)
변경: bnpl-credit.manager.ts (BnplCreditManager)

책임:
- useCredit() - 한도 차감
- restoreCredit() - 한도 복원
- updateNextBillingDate() - 결제일 업데이트
```

```
현재: bnpl-event-manager.impl.ts (BnplEventManagerImpl)
변경: bnpl-event.manager.ts (BnplEventManager)

책임:
- createCreditEvent() - 신용 이벤트 생성
- createDebitEvent() - 상환 이벤트 생성
- markEventsAsAggregated() - 이벤트 집계 표시
- failEventsByBatch() - 배치 실패 처리
```

```
현재: bnpl-retry-manager.impl.ts (BnplRetryManagerImpl)
변경: bnpl-retry.manager.ts (BnplRetryManager)

책임:
- retryBatch() - 실패한 배치 재시도
- getRetryCount() - 재시도 횟수 조회
```

#### 1.4 Processor → Manager로 재분류

```
현재: bnpl-cms-processor.impl.ts (BnplCmsProcessorImpl)
변경: bnpl-cms.manager.ts (BnplCmsManager)

이유:
- "Processor"는 명확한 역할이 아님
- 실제로는 CMS 결과를 처리하고 상태를 변경하는 Manager 역할

책임:
- processSuccess() - CMS 성공 처리
- processFailure() - CMS 실패 처리
- recordResponse() - CMS 응답 기록
```

### Phase 2: 최종 파일 구조

```
apps/wallet/src/services/bnpl/
├── bnpl-account.service.ts           ✅ Business Layer
├── bnpl-settlement.service.ts        ✅ Business Layer
│
├── bnpl-account.reader.ts            ✅ Implementation (Reader)
├── bnpl-account.creator.ts           ✅ Implementation (Creator)
├── bnpl-credit.manager.ts            ✅ Implementation (Manager)
├── bnpl-event.manager.ts             ✅ Implementation (Manager)
├── bnpl-batch.creator.ts             ✅ Implementation (Creator)
├── bnpl-cms.manager.ts               ✅ Implementation (Manager)
├── bnpl-retry.manager.ts             ✅ Implementation (Manager)
│
└── bnpl-cms-response.repository.ts   ✅ Data Access Layer
```

### Phase 3: 클래스명 변경

| 현재 클래스명            | 변경 후 클래스명     | 역할    |
| ------------------------ | -------------------- | ------- |
| `BnplAccountReaderImpl`  | `BnplAccountReader`  | Reader  |
| `BnplAccountCreatorImpl` | `BnplAccountCreator` | Creator |
| `BnplCreditManagerImpl`  | `BnplCreditManager`  | Manager |
| `BnplEventManagerImpl`   | `BnplEventManager`   | Manager |
| `BnplBatchCreatorImpl`   | `BnplBatchCreator`   | Creator |
| `BnplCmsProcessorImpl`   | `BnplCmsManager`     | Manager |
| `BnplRetryManagerImpl`   | `BnplRetryManager`   | Manager |

### Phase 4: Service Layer 의존성 업데이트

#### BnplAccountService

```typescript
// Before
constructor(
  private readonly accountReader: BnplAccountReaderImpl,
  private readonly accountCreator: BnplAccountCreatorImpl,
  private readonly creditManager: BnplCreditManagerImpl,
  private readonly eventManager: BnplEventManagerImpl,
) {}

// After
constructor(
  private readonly accountReader: BnplAccountReader,
  private readonly accountCreator: BnplAccountCreator,
  private readonly creditManager: BnplCreditManager,
  private readonly eventManager: BnplEventManager,
) {}
```

#### BnplSettlementService

```typescript
// Before
constructor(
  private readonly db: DbService<typeof walletSchema>,
  private readonly cmsResponseRepo: BnplCmsResponseRepository,
  private readonly batchCreator: BnplBatchCreatorImpl,
  private readonly cmsProcessor: BnplCmsProcessorImpl,
  private readonly retryManager: BnplRetryManagerImpl,
) {}

// After
constructor(
  private readonly db: DbService<typeof walletSchema>,
  private readonly cmsResponseRepo: BnplCmsResponseRepository,
  private readonly batchCreator: BnplBatchCreator,
  private readonly cmsManager: BnplCmsManager,
  private readonly retryManager: BnplRetryManager,
) {}
```

### Phase 5: Module 등록 업데이트

```typescript
// app.module.ts

// Before
providers: [
  BnplAccountService,
  BnplSettlementService,
  BnplAccountReaderImpl,
  BnplAccountCreatorImpl,
  BnplCreditManagerImpl,
  BnplEventManagerImpl,
  BnplBatchCreatorImpl,
  BnplCmsProcessorImpl,
  BnplRetryManagerImpl,
  BnplCmsResponseRepository,
];

// After
providers: [
  // Business Layer
  BnplAccountService,
  BnplSettlementService,

  // Implementation Layer
  BnplAccountReader,
  BnplAccountCreator,
  BnplCreditManager,
  BnplEventManager,
  BnplBatchCreator,
  BnplCmsManager,
  BnplRetryManager,

  // Data Access Layer
  BnplCmsResponseRepository,
];
```

## 🔍 네이밍 규칙 정리

### 파일명 패턴

```
{domain}.{role}.ts

예시:
- bnpl-account.reader.ts
- bnpl-credit.manager.ts
- bnpl-batch.creator.ts
- bnpl-cms-response.repository.ts
```

### 클래스명 패턴

```
{Domain}{Role}

예시:
- BnplAccountReader
- BnplCreditManager
- BnplBatchCreator
- BnplCmsResponseRepository
```

### 역할별 접미사

- `.reader.ts` → `Reader` (조회)
- `.manager.ts` → `Manager` (상태 변경)
- `.creator.ts` → `Creator` (생성)
- `.appender.ts` → `Appender` (추가)
- `.validator.ts` → `Validator` (검증)
- `.repository.ts` → `Repository` (데이터 접근)
- `.client.ts` → `Client` (외부 API)

## ✅ 리팩토링 체크리스트

### 파일 작업

- [ ] `bnpl-account-reader.impl.ts` → `bnpl-account.reader.ts`
- [ ] `bnpl-account-creator.impl.ts` → `bnpl-account.creator.ts`
- [ ] `bnpl-credit-manager.impl.ts` → `bnpl-credit.manager.ts`
- [ ] `bnpl-event-manager.impl.ts` → `bnpl-event.manager.ts`
- [ ] `bnpl-batch-creator.impl.ts` → `bnpl-batch.creator.ts`
- [ ] `bnpl-cms-processor.impl.ts` → `bnpl-cms.manager.ts`
- [ ] `bnpl-retry-manager.impl.ts` → `bnpl-retry.manager.ts`

### 클래스명 변경

- [ ] `BnplAccountReaderImpl` → `BnplAccountReader`
- [ ] `BnplAccountCreatorImpl` → `BnplAccountCreator`
- [ ] `BnplCreditManagerImpl` → `BnplCreditManager`
- [ ] `BnplEventManagerImpl` → `BnplEventManager`
- [ ] `BnplBatchCreatorImpl` → `BnplBatchCreator`
- [ ] `BnplCmsProcessorImpl` → `BnplCmsManager`
- [ ] `BnplRetryManagerImpl` → `BnplRetryManager`

### 의존성 업데이트

- [ ] `BnplAccountService` import 및 constructor 수정
- [ ] `BnplSettlementService` import 및 constructor 수정
- [ ] `app.module.ts` providers 수정
- [ ] 기타 참조하는 파일 검색 및 수정

### 검증

- [ ] TypeScript 컴파일 에러 없음
- [ ] 모든 import 경로 정상
- [ ] 테스트 파일 업데이트 (있는 경우)
- [ ] 문서 업데이트

## 📊 Before & After 비교

### Before (현재)

```
❌ 역할이 불명확한 .impl 접미사
❌ 클래스명에 Impl 접미사
❌ Processor 같은 모호한 네이밍
❌ 파일명과 역할의 불일치
```

### After (리팩토링 후)

```
✅ 명확한 역할 기반 네이밍 (Reader/Manager/Creator)
✅ layer-architecture.md 규칙 100% 준수
✅ 파일명만 봐도 역할 파악 가능
✅ 일관된 네이밍 컨벤션
```

## 🎓 기대 효과

1. **가독성 향상**
   - 파일명만 봐도 역할을 즉시 파악 가능
   - 신규 개발자 온보딩 시간 단축

2. **유지보수성 향상**
   - 명확한 책임 분리
   - 수정 시 영향 범위 파악 용이

3. **표준 준수**
   - layer-architecture.md 규칙 완벽 준수
   - 팀 전체 코드베이스 일관성 확보

4. **확장성**
   - 새로운 기능 추가 시 어디에 배치할지 명확
   - 역할별 패턴이 명확하여 복제 용이

## 🚀 실행 순서

1. **승인 대기** - 이 문서 검토 및 승인
2. **파일 리네임** - 7개 파일 이름 변경
3. **클래스명 변경** - 7개 클래스 이름 변경
4. **의존성 업데이트** - Service, Module 수정
5. **검증** - 컴파일 및 테스트
6. **문서 업데이트** - 기존 문서 갱신

---

**이 계획에 동의하시면 즉시 리팩토링을 진행하겠습니다.**
