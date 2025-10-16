# Design Document

## Overview

이 설계는 결제 시스템의 provider 응답 저장 방식을 표준화하고, BNPL의 비동기 정산 프로세스를 명확하게 추적할 수 있도록 스키마와 로직을 리팩토링합니다.

### 핵심 설계 원칙

1. **일관성**: 모든 provider 응답을 동일한 방식으로 저장
2. **추적성**: BNPL CMS 응답 이력을 완전히 추적
3. **단순성**: 중복 필드 제거, 단일 진실 공급원 유지
4. **확장성**: 새로운 provider 추가 시 동일한 패턴 적용

## Architecture

### 레이어 구조

```
┌─────────────────────────────────────────────────────┐
│ Controller Layer                                     │
│ - HTTP 요청/응답 처리                                 │
│ - DTO 검증                                           │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│ Service Layer (Port)                                 │
│ - PaymentService                                     │
│ - BnplSettlementService (신규)                       │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│ Repository Layer (Adapter)                           │
│ - PaymentAttemptRepository (수정)                    │
│ - BnplCmsResponseRepository (신규)                   │
│ - BnplAccountService (수정)                          │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│ Database Layer                                       │
│ - payment_attempts (수정)                            │
│ - bnpl_events (수정)                                 │
│ - bnpl_cms_responses (신규)                          │
└─────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. 스키마 변경

#### 1.1 payment_attempts 테이블 (수정)

```typescript
export const paymentAttempts = pgTable('payment_attempts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  intentId: varchar('intent_id', { length: 36 }).notNull(),
  provider: paymentProviderEnum('provider').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  status: transactionStatusEnum('status').notNull(),

  // 인덱싱용 필드 (유지)
  transactionId: varchar('transaction_id', { length: 255 }),
  approvalNumber: varchar('approval_number', { length: 255 }),

  // ✅ 신규: 모든 provider 응답 저장
  providerResponseSnapshot: jsonb('provider_response_snapshot'),

  // ❌ 제거: errorMessage (snapshot에서 추출)

  instrumentType: varchar('instrument_type', { length: 16 })
    .$type<'PROFILE' | 'ONE_TIME'>()
    .notNull()
    .default('PROFILE'),
  profileId: varchar('profile_id', { length: 36 }),
  actor: text('actor')
    .$type<'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN'>()
    .notNull()
    .default('USER'),
  requestMetadata: jsonb('request_metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

**변경 사항**:

- `providerResponseSnapshot` 추가: 모든 provider 응답 저장
- `errorMessage` 제거: 중복 제거

#### 1.2 bnpl_events 테이블 (수정)

```typescript
export const bnplEvents = pgTable('bnpl_events', {
  id: varchar('id', { length: 26 }).primaryKey(),
  accountId: varchar('account_id', { length: 26 }).notNull(),

  eventType: bnplEventTypeEnum('event_type').notNull(),
  eventCategory: bnplEventCategoryEnum('event_category').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),

  externalOrderId: varchar('external_order_id', { length: 64 }),
  paymentIntentId: varchar('payment_intent_id', { length: 36 }),

  // 정산 정보
  aggregationPeriod: varchar('aggregation_period', { length: 16 }),
  isAggregated: boolean('is_aggregated').notNull().default(false),
  batchTransactionId: varchar('batch_transaction_id', { length: 50 }),
  batchDueDate: date('batch_due_date'),

  // CMS 현재 상태 (빠른 조회용)
  cmsStatus: varchar('cms_status', { length: 32 }),
  cmsErrorCode: varchar('cms_error_code', { length: 64 }),

  // ❌ 제거: cmsResponseSnapshot (별도 테이블로 이동)

  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  reasonCode: varchar('reason_code', { length: 32 }),
  reasonDetail: text('reason_detail'),
  errorMessage: text('error_message'),

  actor: varchar('actor', { length: 32 }).notNull().default('SYSTEM'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**변경 사항**:

- `cmsResponseSnapshot` 제거: 별도 이력 테이블로 이동

#### 1.3 bnpl_cms_responses 테이블 (신규)

```typescript
export const bnplCmsResponses = pgTable(
  'bnpl_cms_responses',
  {
    id: varchar('id', { length: 26 }).primaryKey().$defaultFn(generateUUIDv7),

    // 배치 단위 추적
    batchId: varchar('batch_id', { length: 50 }).notNull(),
    accountId: varchar('account_id', { length: 26 })
      .notNull()
      .references(() => bnplAccounts.id, { onDelete: 'cascade' }),

    // 개별 이벤트 참조 (선택적 - 배치 전체 응답인 경우 null)
    eventId: varchar('event_id', { length: 26 }).references(
      () => bnplEvents.id,
      { onDelete: 'cascade' },
    ),

    // 응답 타입
    responseType: varchar('response_type', { length: 32 }).notNull(),
    // 'BATCH_REQUEST_SUBMITTED' - 배치 출금 신청
    // 'BATCH_RESULT_CONFIRMED' - 배치 결과 확인
    // 'BATCH_RETRY_ATTEMPTED' - 배치 재시도

    // HMS CMS 응답 원본
    cmsResponseSnapshot: jsonb('cms_response_snapshot').notNull(),

    // 상태 변화 추적
    previousStatus: varchar('previous_status', { length: 32 }),
    newStatus: varchar('new_status', { length: 32 }).notNull(),

    // 메타데이터
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_bnpl_cms_batch').on(t.batchId),
    index('idx_bnpl_cms_account').on(t.accountId),
    index('idx_bnpl_cms_event').on(t.eventId),
    index('idx_bnpl_cms_type').on(t.responseType),
    index('idx_bnpl_cms_created').on(t.createdAt),
  ],
);
```

### 2. Repository 인터페이스

#### 2.1 PaymentAttemptRepository (수정)

```typescript
interface PaymentAttemptRepository {
  // 기존 메서드 (수정)
  create(
    request: PaymentRequest,
    result: PaymentResult,
    providerType: ProviderType,
    status: string,
    tx?: any,
  ): Promise<void>;

  updateStatus(
    attemptId: string,
    status: string,
    result: PaymentResult,
    tx?: any,
  ): Promise<void>;

  // 신규 메서드
  getErrorMessage(attempt: PaymentAttempt): string | null;

  updateStatusBatch(
    attemptIds: string[],
    status: string,
    tx?: any,
  ): Promise<void>;
}
```

#### 2.2 BnplCmsResponseRepository (신규)

```typescript
interface BnplCmsResponseRepository {
  // CMS 응답 기록
  createResponse(
    batchId: string,
    accountId: string,
    responseType: string,
    cmsSnapshot: any,
    previousStatus: string | null,
    newStatus: string,
    eventId?: string,
    tx?: any,
  ): Promise<void>;

  // 이력 조회
  findByBatchId(batchId: string): Promise<BnplCmsResponse[]>;

  findByAccountId(
    accountId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<BnplCmsResponse[]>;

  findByEventId(eventId: string): Promise<BnplCmsResponse[]>;

  // 최신 응답 조회
  findLatestByBatchId(batchId: string): Promise<BnplCmsResponse | null>;
}
```

#### 2.3 BnplAccountService (수정)

```typescript
interface BnplAccountService {
  // 기존 메서드 (유지)
  createBnplAccount(userId: string, creditLimit: number, tx?: any): Promise<BnplAccount>;
  createCreditEvent(...): Promise<BnplEvent>;

  // 기존 메서드 (제거)
  // updateCmsResponse() - BnplSettlementService로 이동

  // 신규 메서드
  restoreCreditLimit(accountId: string, amount: number, tx?: any): Promise<void>;
}
```

### 3. Service 인터페이스

#### 3.1 BnplSettlementService (신규)

```typescript
interface BnplSettlementService {
  /**
   * 월말 배치 생성 및 CMS 출금 신청
   * @returns 생성된 배치 정보
   */
  createMonthlyBatch(): Promise<{
    batchId: string;
    totalAmount: number;
    accountCount: number;
    eventCount: number;
  }>;

  /**
   * CMS 출금 결과 처리
   * @param batchId 배치 ID
   * @param success 성공 여부
   * @param cmsResponse HMS CMS 응답
   */
  processCmsResult(
    batchId: string,
    success: boolean,
    cmsResponse: any,
  ): Promise<void>;

  /**
   * 실패한 배치 재시도
   * @param batchId 원본 배치 ID
   * @returns 새 배치 ID
   */
  retryFailedBatch(batchId: string): Promise<string>;

  /**
   * 배치 상태 조회
   * @param batchId 배치 ID
   */
  getBatchStatus(batchId: string): Promise<{
    batchId: string;
    status: string;
    totalAmount: number;
    events: BnplEvent[];
    history: BnplCmsResponse[];
  }>;
}
```

## Data Models

### PaymentResult (기존 - 변경 없음)

```typescript
interface PaymentResult {
  success: boolean;
  transactionId?: string;
  code: string;
  message: string;
  raw: any; // ← 이 필드를 providerResponseSnapshot에 저장
}
```

### BnplCmsResponse (신규)

```typescript
interface BnplCmsResponse {
  id: string;
  batchId: string;
  accountId: string;
  eventId?: string;
  responseType:
    | 'BATCH_REQUEST_SUBMITTED'
    | 'BATCH_RESULT_CONFIRMED'
    | 'BATCH_RETRY_ATTEMPTED';
  cmsResponseSnapshot: {
    batchId: string;
    totalAmount: number;
    processedAmount?: number;
    status: string;
    errorCode?: string;
    errorMessage?: string;
    approvalNumber?: string;
    requestDate?: string;
    processedDate?: string;
    dueDate?: string;
    retryCount?: number;
    eventIds?: string[];
    hmsResponse: any; // 원본 HMS 응답
  };
  previousStatus: string | null;
  newStatus: string;
  metadata?: any;
  createdAt: Date;
}
```

### BatchInfo (신규)

```typescript
interface BatchInfo {
  batchId: string;
  accountId: string;
  totalAmount: number;
  eventIds: string[];
  dueDate: string;
  status: 'REQUESTED' | 'PROCESSED' | 'FAILED';
}
```

## Error Handling

### 1. Provider 응답 에러 추출

```typescript
// Helper 함수
function getErrorMessage(attempt: PaymentAttempt): string | null {
  if (!attempt.providerResponseSnapshot) {
    return null;
  }

  const snapshot = attempt.providerResponseSnapshot as any;

  // Provider별 에러 메시지 추출
  switch (attempt.provider) {
    case 'HMS_CARD':
      return snapshot?.payment?.result?.message || null;
    case 'HMS_BNPL':
      return snapshot?.message || null;
    case 'TOSS':
      return snapshot?.message || null;
    default:
      return snapshot?.message || snapshot?.errorMessage || null;
  }
}
```

### 2. CMS 실패 처리

```typescript
// CMS 출금 실패 시
async function handleCmsFailure(batchId: string, cmsResponse: any) {
  await db.transaction(async (tx) => {
    // 1. 모든 이벤트 실패 처리
    await tx
      .update(bnplEvents)
      .set({
        cmsStatus: 'FAILED',
        cmsErrorCode: cmsResponse.errorCode,
        status: 'PENDING', // 재시도 대기
      })
      .where(eq(bnplEvents.batchTransactionId, batchId));

    // 2. 모든 payment attempts 실패 처리
    const events = await tx.query.bnplEvents.findMany({
      where: eq(bnplEvents.batchTransactionId, batchId),
    });

    const intentIds = events.map((e) => e.paymentIntentId).filter(Boolean);

    await tx
      .update(paymentAttempts)
      .set({ status: 'FAILED' })
      .where(inArray(paymentAttempts.intentId, intentIds));

    // 3. CMS 응답 기록
    await bnplCmsResponseRepo.createResponse(
      batchId,
      events[0].accountId,
      'BATCH_RESULT_CONFIRMED',
      cmsResponse,
      'REQUESTED',
      'FAILED',
      undefined,
      tx,
    );
  });
}
```

### 3. 재시도 로직

```typescript
async function retryFailedBatch(originalBatchId: string): Promise<string> {
  // 1. 실패한 이벤트 조회
  const failedEvents = await db.query.bnplEvents.findMany({
    where: and(
      eq(bnplEvents.batchTransactionId, originalBatchId),
      eq(bnplEvents.cmsStatus, 'FAILED'),
    ),
  });

  if (failedEvents.length === 0) {
    throw new Error('No failed events found for retry');
  }

  // 2. 재시도 횟수 확인
  const history = await bnplCmsResponseRepo.findByBatchId(originalBatchId);
  const retryCount = history.filter(
    (h) => h.responseType === 'BATCH_RETRY_ATTEMPTED',
  ).length;

  if (retryCount >= 3) {
    throw new Error('Maximum retry attempts exceeded');
  }

  // 3. 새 배치 생성
  const newBatchId = `${originalBatchId}_RETRY_${retryCount + 1}`;
  const totalAmount = failedEvents.reduce((sum, e) => sum + e.amount, 0);
  const dueDate = addDays(new Date(), 5);

  await db.transaction(async (tx) => {
    // 4. 이벤트 업데이트
    await tx
      .update(bnplEvents)
      .set({
        batchTransactionId: newBatchId,
        batchDueDate: dueDate.toISOString().split('T')[0],
        cmsStatus: 'REQUESTED',
        status: 'PENDING',
      })
      .where(eq(bnplEvents.batchTransactionId, originalBatchId));

    // 5. CMS 재신청 (실제 HMS API 호출은 스케줄러에서)
    const cmsRequest = {
      batchId: newBatchId,
      amount: totalAmount,
      dueDate: dueDate.toISOString().split('T')[0],
      retryCount: retryCount + 1,
    };

    // 6. 응답 기록
    await bnplCmsResponseRepo.createResponse(
      newBatchId,
      failedEvents[0].accountId,
      'BATCH_RETRY_ATTEMPTED',
      { ...cmsRequest, status: 'REQUESTED' },
      'FAILED',
      'REQUESTED',
      undefined,
      tx,
    );
  });

  return newBatchId;
}
```

## Testing Strategy

### 1. Unit Tests

#### PaymentAttemptRepository

- `create()`: providerResponseSnapshot 저장 확인
- `getErrorMessage()`: provider별 에러 추출 확인
- `updateStatusBatch()`: 배치 업데이트 확인

#### BnplCmsResponseRepository

- `createResponse()`: 응답 기록 생성 확인
- `findByBatchId()`: 이력 조회 확인
- `findLatestByBatchId()`: 최신 응답 조회 확인

#### BnplSettlementService

- `createMonthlyBatch()`: 배치 생성 로직 확인
- `processCmsResult()`: 성공/실패 처리 확인
- `retryFailedBatch()`: 재시도 로직 확인

### 2. Integration Tests

#### BNPL 전체 플로우

```typescript
describe('BNPL Settlement Flow', () => {
  it('should complete full settlement cycle', async () => {
    // 1. 주문 생성 (AUTHORIZED)
    const attempt = await createBnplPayment(50000);
    expect(attempt.status).toBe('AUTHORIZED');

    // 2. 배치 생성
    const batch = await settlementService.createMonthlyBatch();
    expect(batch.totalAmount).toBe(50000);

    // 3. CMS 성공 처리
    await settlementService.processCmsResult(batch.batchId, true, {
      status: 'PROCESSED',
      approvalNumber: 'CMS_123',
    });

    // 4. Attempt CAPTURED 확인
    const updated = await attemptRepo.findById(attempt.id);
    expect(updated.status).toBe('CAPTURED');

    // 5. CMS 이력 확인
    const history = await cmsResponseRepo.findByBatchId(batch.batchId);
    expect(history).toHaveLength(2); // REQUEST + RESULT
  });

  it('should handle CMS failure and retry', async () => {
    // 1. 주문 생성
    const attempt = await createBnplPayment(50000);

    // 2. 배치 생성
    const batch = await settlementService.createMonthlyBatch();

    // 3. CMS 실패 처리
    await settlementService.processCmsResult(batch.batchId, false, {
      status: 'FAILED',
      errorCode: 'INSUFFICIENT_FUNDS',
    });

    // 4. Attempt FAILED 확인
    const failed = await attemptRepo.findById(attempt.id);
    expect(failed.status).toBe('FAILED');

    // 5. 재시도
    const newBatchId = await settlementService.retryFailedBatch(batch.batchId);
    expect(newBatchId).toContain('_RETRY_1');

    // 6. 재시도 성공
    await settlementService.processCmsResult(newBatchId, true, {
      status: 'PROCESSED',
    });

    // 7. Attempt CAPTURED 확인
    const captured = await attemptRepo.findById(attempt.id);
    expect(captured.status).toBe('CAPTURED');
  });
});
```

### 3. 마이그레이션 테스트

```typescript
describe('Schema Migration', () => {
  it('should add providerResponseSnapshot column', async () => {
    // 마이그레이션 실행
    await runMigration('add_provider_response_snapshot');

    // 컬럼 존재 확인
    const columns = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payment_attempts'
    `);

    expect(
      columns.some((c) => c.column_name === 'provider_response_snapshot'),
    ).toBe(true);
  });

  it('should remove errorMessage column', async () => {
    await runMigration('remove_error_message');

    const columns = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payment_attempts'
    `);

    expect(columns.some((c) => c.column_name === 'error_message')).toBe(false);
  });
});
```

## Implementation Notes

### 1. 마이그레이션 순서

```sql
-- Step 1: payment_attempts에 providerResponseSnapshot 추가
ALTER TABLE payment_attempts
ADD COLUMN provider_response_snapshot JSONB;

-- Step 2: bnpl_cms_responses 테이블 생성
CREATE TABLE bnpl_cms_responses (
  id VARCHAR(26) PRIMARY KEY,
  batch_id VARCHAR(50) NOT NULL,
  account_id VARCHAR(26) NOT NULL REFERENCES bnpl_accounts(id) ON DELETE CASCADE,
  event_id VARCHAR(26) REFERENCES bnpl_events(id) ON DELETE CASCADE,
  response_type VARCHAR(32) NOT NULL,
  cms_response_snapshot JSONB NOT NULL,
  previous_status VARCHAR(32),
  new_status VARCHAR(32) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bnpl_cms_batch ON bnpl_cms_responses(batch_id);
CREATE INDEX idx_bnpl_cms_account ON bnpl_cms_responses(account_id);
CREATE INDEX idx_bnpl_cms_event ON bnpl_cms_responses(event_id);
CREATE INDEX idx_bnpl_cms_type ON bnpl_cms_responses(response_type);
CREATE INDEX idx_bnpl_cms_created ON bnpl_cms_responses(created_at);

-- Step 3: bnpl_events에서 cmsResponseSnapshot 제거
ALTER TABLE bnpl_events
DROP COLUMN cms_response_snapshot;

-- Step 4: payment_attempts에서 errorMessage 제거
ALTER TABLE payment_attempts
DROP COLUMN error_message;
```

### 2. 코드 변경 체크리스트

- [ ] 스키마 파일 업데이트 (`schema.ts`)
- [ ] 마이그레이션 파일 생성
- [ ] `PaymentAttemptRepository.create()` 수정
- [ ] `PaymentAttemptRepository.getErrorMessage()` 추가
- [ ] `BnplCmsResponseRepository` 생성
- [ ] `BnplSettlementService` 생성
- [ ] `BnplAccountService.updateCmsResponse()` 제거
- [ ] Provider별 에러 추출 헬퍼 함수 추가
- [ ] 기존 테스트 수정
- [ ] 새 테스트 추가

### 3. 배포 전 확인사항

- [ ] 모든 테스트 통과
- [ ] 마이그레이션 롤백 스크립트 준비
- [ ] 기존 데이터 백업
- [ ] 스테이징 환경 검증
- [ ] 성능 테스트 (jsonb 조회 성능)

## Performance Considerations

### 1. JSONB 인덱싱

```sql
-- 자주 조회하는 필드에 인덱스 추가
CREATE INDEX idx_payment_attempts_provider_code
ON payment_attempts ((provider_response_snapshot->>'code'));

CREATE INDEX idx_payment_attempts_provider_status
ON payment_attempts ((provider_response_snapshot->>'status'));
```

### 2. 배치 조회 최적화

```typescript
// 한 번의 쿼리로 배치 전체 정보 조회
async function getBatchWithHistory(batchId: string) {
  const [events, history] = await Promise.all([
    db.query.bnplEvents.findMany({
      where: eq(bnplEvents.batchTransactionId, batchId),
    }),
    db.query.bnplCmsResponses.findMany({
      where: eq(bnplCmsResponses.batchId, batchId),
      orderBy: [asc(bnplCmsResponses.createdAt)],
    }),
  ]);

  return { events, history };
}
```

### 3. 대용량 배치 처리

```typescript
// 청크 단위로 처리
async function updateAttemptsBatch(attemptIds: string[], status: string) {
  const CHUNK_SIZE = 100;

  for (let i = 0; i < attemptIds.length; i += CHUNK_SIZE) {
    const chunk = attemptIds.slice(i, i + CHUNK_SIZE);
    await db
      .update(paymentAttempts)
      .set({ status })
      .where(inArray(paymentAttempts.id, chunk));
  }
}
```

## Security Considerations

- Provider 응답에 민감 정보가 포함될 수 있으므로 저장 전 검토 필요 (추후 구현)
- CMS 응답에 계좌 정보가 포함되지 않도록 확인
- JSONB 필드 접근 권한 제어

## Future Enhancements

- Kafka 이벤트 발행 (배치 생성, CMS 결과 등)
- Redis 캐싱 (배치 상태, 최근 CMS 응답)
- 스케줄러 구현 (월말 배치 자동 생성, CMS 결과 자동 확인)
- 민감 데이터 마스킹/암호화
- 배치 처리 대시보드
