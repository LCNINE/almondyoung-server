# 작업 14 — 반품 환불 상태기계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 반품 환불을 시도별 결정적 idempotency key + intent-first attempt 행 상태기계로 재구성해 크래시 자가치유(P1-9)·`already_refunded` 완료 매핑(P1-8)·이중환불 방어(P2-12)를 확보하고, 부분반품 비례식 기준을 통일(P1-10)한다.

**Architecture:** Wallet 은 idempotency key 로 성공·실패를 캐시하고 동시 같은 key 를 409 로 막는다. 이를 이용해 `return_refund_attempts` 신규 테이블에 Wallet 호출 **전** attempt 행(key·amount·status=pending)을 커밋(intent-first SoT)하고, 결과를 순수 분류기 `classifyRefundOutcome` 로 3분류(확정성공/확정실패/불확정)해 attempt 행과 반품 상태를 전이한다. 초회·재시도가 단일 헬퍼 `attemptReturnRefund` 로 통합된다.

**Tech Stack:** NestJS · Drizzle ORM(postgres.js) · Jest · `@InjectTypedDb<typeof inventorySchema>`.

## Global Constraints

- **이중환불 금지가 최상위 불변식** — 규율 1(N 증가=Wallet 확정 실패만) · 규율 2(intent-first attempt 행이 key·amount SoT) · 규율 3(409 IN_FLIGHT≠확정실패, 같은 key 재생). 어떤 위반도 회귀.
- **레이어**: Controller→Service→Reader/Manager→Repository. 도메인 예외(`@app/shared`)는 이 서비스가 기존에 Nest 예외(`ConflictException`·`BadRequestException`·`NotFoundException`)를 쓰므로 **기존 패턴 유지**(P3-1 도메인 에러 이관은 WS-E 소유, 침범 금지).
- **재생 body 안정성**: 재사용 attempt 는 `amount` 를 행에서 로드(재계산 금지) — Wallet body-hash 일치 필수.
- **DB 주입**: `@InjectTypedDb<typeof inventorySchema>()`, `this.db.db`. tx 는 `this.db.db.transaction(async (tx) => …)`.
- **취소 경로 net 동작 보존**: 공유 client 정제가 `store-sales-orders.service.ts` switch 를 깨지 않는다.
- **검증 체크리스트(공통 규약)**: `nest build core` exit 0 · arch 경계 spec(`apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts`) PASS · 변경 파일 신규 eslint error 0(repo 전역 lint 는 상시 debt, 전역 판정 금지) · admin-web 무변경. dev DB 부재 → 통합 spec 은 ⏸(SKIP), 유닛만 실행.
- **마이그레이션 적용 ⏸**: `drizzle-kit generate` 오프라인 생성만. `db:migrate` 는 dev DB 복구 시(작업 1·2·3·8a 미적용분과 일괄).

---

### Task 1: P1-10 — 부분반품 비례식 분자·분모 기준 통일

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts:1287-1320` (`calculateReturnRefund`)
- Test: `apps/core/src/modules/sales-order/services/store-return-exchange.service.spec.ts`

**Interfaces:**
- Consumes: 없음(순수 함수 내부 수정)
- Produces: `calculateReturnRefund` 시그니처 불변 — 동작만 정확화.

**배경:** 분모 `allLinesTotals`(:1308)는 `l.totalPrice ?? l.unitPrice*qty`(할인 반영), 분자 `returnedLinesTotals`(:1315)는 `returnQty * l.unitPrice`(할인 미반영). 라인 할인 시 분자·분모 기준 불일치 → 과대/과소. 수정: 분자를 라인 무게(분모와 동일 기준)의 **반품수량 비율**로.

- [ ] **Step 1: 실패 테스트 작성** — `store-return-exchange.service.spec.ts` 하단에 추가.

```typescript
// ── calculateReturnRefund (P1-10) tests ───────────────────────────────────────
describe('StoreReturnExchangeService.calculateReturnRefund (P1-10 기준 통일)', () => {
  // private 메서드 → 인스턴스 통해 호출 (기존 스펙의 private 접근 관행과 동일)
  function calc(service: StoreReturnExchangeService, ...args: unknown[]): number {
    return (service as unknown as { calculateReturnRefund: (...a: unknown[]) => number }).calculateReturnRefund(...args);
  }

  it('할인 라인 부분반품 시 분자도 totalPrice 기준으로 비례(과대환불 없음)', () => {
    const service = new StoreReturnExchangeService({ db: {} } as never, {} as never);
    // 라인A: qty2 unitPrice 10000 이나 totalPrice 12000(주문할인 반영, 8000 할인)
    // 라인B: qty1 unitPrice 5000 totalPrice 5000
    // 주문 totalAmount 17000, 배송비 0 → productSubtotal 17000
    // 라인A 1개만 반품: 분모=12000+5000=17000, 라인A 무게=12000, 반품비중=1/2 → 6000
    // 반품액 = round(6000 * 17000 / 17000) = 6000
    const returnItems = [{ salesOrderLineId: 'A', quantity: 1, unitPrice: 10000 }];
    const allLines = [
      { id: 'A', quantity: 2, unitPrice: 10000, totalPrice: 12000 },
      { id: 'B', quantity: 1, unitPrice: 5000, totalPrice: 5000 },
    ];
    expect(calc(service, returnItems, allLines, 17000, 0)).toBe(6000);
  });

  it('할인 없는 라인은 기존과 동일(unitPrice×qty = totalPrice)', () => {
    const service = new StoreReturnExchangeService({ db: {} } as never, {} as never);
    const returnItems = [{ salesOrderLineId: 'A', quantity: 1, unitPrice: 10000 }];
    const allLines = [
      { id: 'A', quantity: 2, unitPrice: 10000, totalPrice: 20000 },
      { id: 'B', quantity: 1, unitPrice: 5000, totalPrice: 5000 },
    ];
    // 분모 25000, 라인A 무게 20000, 반품비중 1/2 → 10000; productSubtotal 25000
    // round(10000 * 25000 / 25000) = 10000
    expect(calc(service, returnItems, allLines, 25000, 0)).toBe(10000);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest --config apps/core/jest.config.ts store-return-exchange.service.spec -t "P1-10"`
Expected: 첫 테스트 FAIL — 현재 분자가 `1*10000=10000` 이라 `round(10000*17000/17000)=10000 ≠ 6000`.

- [ ] **Step 3: 최소 구현** — `calculateReturnRefund` 의 분자 계산(`:1313-1316`)을 라인 무게 기반으로 교체.

```typescript
    // totalPrice 또는 unitPrice × quantity를 라인 무게로 사용 (분모·분자 동일 기준)
    const lineWeight = (l: { unitPrice: number | null; quantity: number; totalPrice: number | null }): number =>
      l.totalPrice ?? (l.unitPrice ?? 0) * l.quantity;

    const allLinesTotals = allLines.reduce((acc, l) => acc + lineWeight(l), 0);
    if (allLinesTotals <= 0) {
      return returnItems.reduce((acc, item) => acc + item.quantity * (item.unitPrice ?? 0), 0);
    }

    const returnedLinesTotals = allLines.reduce((acc, l) => {
      const returnQty = returnQtyByLineId.get(l.id) ?? 0;
      if (returnQty <= 0 || l.quantity <= 0) return acc;
      // 라인 무게를 반품수량 비율로 배분 (할인 포함 기준)
      return acc + (lineWeight(l) * returnQty) / l.quantity;
    }, 0);

    const productSubtotal = Math.max(0, orderTotal - orderShippingFee);
    return Math.round((returnedLinesTotals * productSubtotal) / allLinesTotals);
```

(기존 `:1307-1319` 블록 교체. `returnQtyByLineId`·`isFullReturn`·`orderTotal` 등 상위 코드는 유지.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --config apps/core/jest.config.ts store-return-exchange.service.spec -t "P1-10"`
Expected: PASS (both).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/store-return-exchange.service.ts \
        apps/core/src/modules/sales-order/services/store-return-exchange.service.spec.ts
git commit -m "fix(core): 반품 환불 비례식 분자를 분모와 동일 기준으로 통일 (작업 14, P1-10)"
```

---

### Task 2: `return_refund_attempts` 테이블 + enum + 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (returnRequests 인근 `:3277~3372`)
- Create: `apps/core/drizzle/<timestamp>_add-return-refund-attempts.sql` (drizzle-kit 생성)
- Modify: `apps/core/drizzle/meta/*` (drizzle-kit 생성)

**Interfaces:**
- Produces:
  - `returnRefundAttemptStatusEnum` — pgEnum `['pending','succeeded','failed']`
  - `returnRefundAttempts` pgTable — 컬럼 `id, returnRequestId, attemptNumber, idempotencyKey, amount, status, walletOutcome, createdAt, updatedAt`
  - `returnExchangeTables.returnRefundAttempts` — 그룹 export 에 추가
  - 타입 `ReturnRefundAttempt = InferSelectModel<typeof returnRefundAttempts>` / `NewReturnRefundAttempt`

- [ ] **Step 1: enum + 테이블 정의 추가** — `inventory.schema.ts` 의 `returnRequestStatusEnum`(`:3235`) 아래, `returnRequests` 테이블 위(또는 인근)에.

```typescript
export const returnRefundAttemptStatusEnum = pgEnum('return_refund_attempt_status', [
  'pending',
  'succeeded',
  'failed',
]);
```

`returnRequestItems`(`:3303`) 정의 아래에 테이블 추가:

```typescript
export const returnRefundAttempts = pgTable(
  'return_refund_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnRequestId: uuid('return_request_id')
      .references(() => returnRequests.id, { onDelete: 'cascade' })
      .notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    // = correlationId = Wallet Idempotency-Key. 시도별 결정적 key 의 단일 진실(SoT).
    idempotencyKey: text('idempotency_key').notNull(),
    // Wallet body 의 SoT — 재사용(재생) 시 동일 amount 강제 (body-hash 일치).
    amount: integer('amount').notNull(),
    status: returnRefundAttemptStatusEnum('status').notNull().default('pending'),
    walletOutcome: jsonb('wallet_outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqReturnRefundAttemptNumber: unique('uq_return_refund_attempt_number').on(t.returnRequestId, t.attemptNumber),
    // 불변식: 반품당 in-flight(pending) attempt 최대 1개 — Phase A 의 "pending 재사용" 규칙을 DB 로 강제
    uqReturnRefundAttemptPending: uniqueIndex('uq_return_refund_attempt_pending')
      .on(t.returnRequestId)
      .where(sql`${t.status} = 'pending'`),
    idxReturnRefundAttemptsRequest: index('idx_return_refund_attempts_request').on(t.returnRequestId),
  }),
);
```

- [ ] **Step 2: 그룹 export + 타입 추가** — `returnExchangeTables`(`:3363`)에 항목 추가하고, 타입 export 추가.

```typescript
export const returnExchangeTables = {
  returnRequests,
  returnRequestItems,
  exchangeRequests,
  exchangeRequestItems,
  returnRefundAttempts,
} as const;
```

`ReturnRequestItem` 타입 export(`:3378`) 아래에:

```typescript
export type ReturnRefundAttempt = InferSelectModel<typeof returnRefundAttempts>;
export type NewReturnRefundAttempt = InferInsertModel<typeof returnRefundAttempts>;
```

- [ ] **Step 3: 컴파일 확인** — import 누락 시 여기서 드러난다(`integer`/`text`/`jsonb`/`unique`/`uniqueIndex`/`pgEnum`/`sql` 는 이미 이 파일에서 사용 중이라 import 존재).

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit 2>&1 | grep -i "inventory.schema\|return_refund\|returnRefundAttempts" || echo "schema OK"`
Expected: `schema OK` (스키마 관련 에러 없음).

- [ ] **Step 4: 마이그레이션 오프라인 생성** — dev DB 없이 생성(작업 8a 판례).

Run: `npm run db:generate:core -- --name add-return-refund-attempts`
Expected: `apps/core/drizzle/<ts>_add-return-refund-attempts.sql` 생성. 파일 내용이 정확히 (a) `CREATE TYPE "public"."return_refund_attempt_status"` (b) `CREATE TABLE "return_refund_attempts"` (c) unique 제약 2 + 인덱스 1 + FK 1 뿐인지 리뷰. **다른 테이블 변경(DROP/ALTER)이 섞이면 STOP** — schema.ts 를 다시 확인.

- [ ] **Step 5: 생성 SQL 리뷰** — partial unique 가 `WHERE "status" = 'pending'` 로 나왔는지, `ON DELETE cascade` FK 인지 확인.

Run: `cat apps/core/drizzle/$(ls -t apps/core/drizzle | grep add-return-refund-attempts | head -1)`
Expected: additive DDL 만(CREATE TYPE/TABLE/INDEX). **적용하지 않음**(dev DB ⏸).

- [ ] **Step 6: arch 경계 회귀 + 빌드**

Run: `npx jest --config apps/core/jest.config.ts inventory-write-boundary.arch && npx nest build core`
Expected: arch PASS(신규 테이블은 stockEvents 직접 INSERT 아님) · build exit 0.

- [ ] **Step 7: 커밋** — schema.ts + drizzle SQL + meta 를 **단일 커밋**(CLAUDE.md 규칙).

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle/
git commit -m "feat(core): return_refund_attempts 테이블 신설 — intent-first 환불 attempt SoT (작업 14)"
```

---

### Task 3: Wallet client 정제 — `failed.determinate` + `in_flight` kind

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/wallet-refund.client.ts:21-27` (outcome type), `:88-135`·`:160-175` (분류)
- Test: `apps/core/src/modules/sales-order/services/wallet-refund.client.spec.ts`

**Interfaces:**
- Produces:
  - `WalletRefundOutcome` 의 `failed` 에 `determinate: boolean` 필드 추가(4xx·200-OK-FAILED=true, 5xx=false)
  - 새 kind `{ kind: 'in_flight'; errorCode: string; errorMessage: string }` (409 `IDEMPOTENCY_KEY_IN_FLIGHT`)
- Consumes(하위 태스크): Task 4 `classifyRefundOutcome` 가 이 타입을 소비.

- [ ] **Step 1: 실패 테스트 작성** — `wallet-refund.client.spec.ts` 에 추가.

```typescript
  it('4xx(비즈니스 거부)는 failed determinate=true', async () => {
    global.fetch = mockFetch(400, { error: 'INVALID_AMOUNT', message: 'Amount must be positive' });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', -1, { correlationId: 'c1' });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.determinate).toBe(true);
  });

  it('5xx(서버 오류)는 failed determinate=false (불확정)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 503, statusText: 'Service Unavailable',
      json: jest.fn().mockResolvedValue({ error: 'UPSTREAM_DOWN', message: 'try later' }),
    });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') expect(result.determinate).toBe(false);
  });

  it('409 IDEMPOTENCY_KEY_IN_FLIGHT 는 in_flight kind', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 409, statusText: 'Conflict',
      json: jest.fn().mockResolvedValue({ error: 'IDEMPOTENCY_KEY_IN_FLIGHT', message: 'in progress' }),
    });
    const client = new WalletRefundClient();
    const result = await client.refundByIntent('intent-1', 1000, { correlationId: 'c1' });
    expect(result.kind).toBe('in_flight');
  });
```

기존 테스트 `'다른 400 에러는 failed로 처리'`(`:64-72`)는 유지되나, `determinate` 단언은 새 테스트가 커버.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest --config apps/core/jest.config.ts wallet-refund.client.spec`
Expected: 새 3개 FAIL(`determinate` undefined / `in_flight` 미존재), 기존 통과.

- [ ] **Step 3: outcome 타입 확장** — `:21-27` 교체.

```typescript
export type WalletRefundOutcome =
  | { kind: 'success'; refunds: WalletRefundResult[] }
  | { kind: 'partial_pending'; refunds: WalletRefundResult[] }
  | { kind: 'failed'; errorCode: string; errorMessage: string; determinate: boolean }
  | { kind: 'in_flight'; errorCode: string; errorMessage: string }
  | { kind: 'already_refunded'; errorCode: string; errorMessage: string }
  | { kind: 'no_intent_id' }
  | { kind: 'wallet_unavailable'; errorMessage: string };
```

- [ ] **Step 4: 분류 로직 수정** — non-ok 블록(`:124-134`)에서 already_refunded 판정 **직후**, `failed` 반환 전에 in_flight 분기 추가하고 determinate 부여.

`:124-134` 의 already_refunded `if (...) { return { kind: 'already_refunded', ... }; }` 아래를 교체:

```typescript
      if (ALREADY_REFUNDED_CODES.has(errorCode) || alreadyRefundedByMessage) {
        this.logger.warn(
          `[WalletRefundClient] Already-refunded detected for intent ${intentId}: ${errorCode} — ${errorMessage}. correlationId=${options.correlationId}`,
        );
        return { kind: 'already_refunded', errorCode, errorMessage };
      }

      // 409 처리중 = 불확정 (규율 3). 같은 key 재시도 버킷이며 N 증가 금지.
      if (response.status === 409 && errorCode === 'IDEMPOTENCY_KEY_IN_FLIGHT') {
        this.logger.warn(
          `[WalletRefundClient] In-flight for intent ${intentId}: correlationId=${options.correlationId}`,
        );
        return { kind: 'in_flight', errorCode, errorMessage };
      }

      this.logger.error(
        `[WalletRefundClient] Wallet returned ${response.status} for intent ${intentId}: ${errorCode} ${errorMessage}`,
      );
      // 4xx = Wallet 이 확정적으로 미환불(determinate). 5xx = 불확정(환불 여부 불명).
      return { kind: 'failed', errorCode, errorMessage, determinate: response.status < 500 };
```

- [ ] **Step 5: 200-OK-FAILED 경로에 determinate 부여** — `:164-170` 의 hasFailed 분기 교체(Wallet 이 처리했고 refund status=FAILED = 확정 미환불).

```typescript
    if (hasFailed) {
      const failed = refunds.find((r) => r.status === 'FAILED');
      return {
        kind: 'failed',
        errorCode: failed?.reasonCode ?? 'REFUND_FAILED',
        errorMessage: failed?.reasonMessage ?? 'Wallet refund failed',
        determinate: true,
      };
    }
```

- [ ] **Step 6: 테스트 통과 확인 + 빌드**

Run: `npx jest --config apps/core/jest.config.ts wallet-refund.client.spec && npx nest build core`
Expected: 전체 PASS · build exit 0. (build 는 `store-sales-orders.service.ts` 의 `switch(outcome.kind)` 가 새 `in_flight` kind 미처리로 **exhaustiveness 경고/에러 없이 통과**해야 함 — 기존 switch 에 `default` 존재(`:793-795`)라 컴파일 OK. 동작 정합은 Task 6.)

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/wallet-refund.client.ts \
        apps/core/src/modules/sales-order/services/wallet-refund.client.spec.ts
git commit -m "feat(core): Wallet 환불 outcome 에 determinate/in_flight 분류 추가 (작업 14, P2-12 기반)"
```

---

### Task 4: 순수 분류기 `classifyRefundOutcome`

**Files:**
- Create: `apps/core/src/modules/sales-order/services/return-refund-classification.ts`
- Test: `apps/core/src/modules/sales-order/services/return-refund-classification.spec.ts`

**Interfaces:**
- Consumes: `WalletRefundOutcome`(Task 3)
- Produces: `classifyRefundOutcome(outcome): RefundAttemptDecision` — `'succeeded' | 'failed' | 'pending'`. Task 5 가 소비.

- [ ] **Step 1: 실패 테스트 작성** — `return-refund-classification.spec.ts`.

```typescript
import { classifyRefundOutcome } from './return-refund-classification';

describe('classifyRefundOutcome (규율 1·3)', () => {
  it('success → succeeded', () => {
    expect(classifyRefundOutcome({ kind: 'success', refunds: [] })).toBe('succeeded');
  });
  it('already_refunded → succeeded (2차 방어)', () => {
    expect(classifyRefundOutcome({ kind: 'already_refunded', errorCode: 'X', errorMessage: 'm' })).toBe('succeeded');
  });
  it('failed determinate=true → failed (다음 재시도 N+1)', () => {
    expect(classifyRefundOutcome({ kind: 'failed', errorCode: 'X', errorMessage: 'm', determinate: true })).toBe('failed');
  });
  it('failed determinate=false(5xx) → pending (같은 key 재생)', () => {
    expect(classifyRefundOutcome({ kind: 'failed', errorCode: 'X', errorMessage: 'm', determinate: false })).toBe('pending');
  });
  it('in_flight → pending (규율 3)', () => {
    expect(classifyRefundOutcome({ kind: 'in_flight', errorCode: 'X', errorMessage: 'm' })).toBe('pending');
  });
  it('wallet_unavailable → pending (불확정)', () => {
    expect(classifyRefundOutcome({ kind: 'wallet_unavailable', errorMessage: 'm' })).toBe('pending');
  });
  it('partial_pending → pending (진행중)', () => {
    expect(classifyRefundOutcome({ kind: 'partial_pending', refunds: [] })).toBe('pending');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest --config apps/core/jest.config.ts return-refund-classification.spec`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```typescript
import { WalletRefundOutcome } from './wallet-refund.client';

/**
 * Wallet 환불 결과 → attempt 행 전이 결정 (순수).
 * - succeeded: 확정 성공(success / already_refunded) → 반품 completed.
 * - failed:    확정 실패(determinate 4xx / 200-OK refund FAILED) → attempt failed, 다음 재시도가 N+1 새 key.
 * - pending:   불확정(5xx / in_flight / wallet_unavailable / partial_pending / no_intent_id)
 *              → attempt pending 유지, 같은 key 재생 (규율 1·3: N 증가 금지).
 */
export type RefundAttemptDecision = 'succeeded' | 'failed' | 'pending';

export function classifyRefundOutcome(outcome: WalletRefundOutcome): RefundAttemptDecision {
  switch (outcome.kind) {
    case 'success':
    case 'already_refunded':
      return 'succeeded';
    case 'failed':
      return outcome.determinate ? 'failed' : 'pending';
    case 'partial_pending':
    case 'in_flight':
    case 'wallet_unavailable':
    case 'no_intent_id':
      return 'pending';
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest --config apps/core/jest.config.ts return-refund-classification.spec`
Expected: PASS (all).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/return-refund-classification.ts \
        apps/core/src/modules/sales-order/services/return-refund-classification.spec.ts
git commit -m "feat(core): 환불 결과 순수 분류기 classifyRefundOutcome (작업 14, 규율 1·3)"
```

---

### Task 5: `attemptReturnRefund` 상태기계 + 초회/재시도 통합

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts` — imports(`:1-3`), `completeReturnRequest`(`:402-531`), `retryReturnRefund`(`:656-768`), `findReturnRequestOrThrow`(`:980-993`), 신규 private 헬퍼 3종
- Test: `apps/core/src/modules/sales-order/services/store-return-exchange.service.spec.ts`
- Create(deferred): `apps/core/src/modules/sales-order/services/store-return-exchange.refund.integration.spec.ts`

**Interfaces:**
- Consumes: `classifyRefundOutcome`(Task 4), `returnExchangeTables.returnRefundAttempts`(Task 2), `WalletRefundOutcome`(Task 3), `calculateReturnRefund`(Task 1)
- Produces:
  - `private async attemptReturnRefund(returnRequestId: string, adminId: string): Promise<ReturnRequest>`
  - `private async computeReturnRefundAmount(returnRequestId, salesOrder, tx): Promise<number>`
  - `private async insertRefundAuditLink(tx, returnRequestId, attempt, outcome): Promise<void>`
  - `findReturnRequestOrThrow(id, tx, opts?: { forUpdate?: boolean })` — forUpdate 옵션 추가
  - `completeReturnRequest`·`retryReturnRefund` 는 시그니처 불변, 내부만 `attemptReturnRefund` 위임.

**5.1 — import 및 findReturnRequestOrThrow forUpdate**

- [ ] **Step 1: import 보강** — `:3` 의 drizzle-orm import 에 `desc, max` 추가, `:2` 의 `randomUUID` import 제거(더 이상 안 씀 — Task 5 완료 후 grep 0 확인).

```typescript
import { and, desc, eq, inArray, max, sum } from 'drizzle-orm';
```

(`import { randomUUID } from 'crypto';` (`:2`) 는 retryReturnRefund 재작성 후 미사용 → 삭제. Step 5.4 이후 확인.)

- [ ] **Step 2: findReturnRequestOrThrow 에 forUpdate 옵션** — `:980-993` 교체. lock 절을 limit 앞에 둬 mock 호환.

```typescript
  private async findReturnRequestOrThrow(
    returnRequestId: string,
    tx: Parameters<Parameters<typeof this.db.db.transaction>[0]>[0],
    opts?: { forUpdate?: boolean },
  ): Promise<ReturnRequestRow> {
    const base = tx
      .select()
      .from(returnExchangeTables.returnRequests)
      .where(eq(returnExchangeTables.returnRequests.id, returnRequestId));
    const rr = await (opts?.forUpdate ? base.for('update') : base)
      .limit(1)
      .then((r) => r[0]);

    if (!rr) throw new NotFoundException(`반품 요청을 찾을 수 없습니다: ${returnRequestId}`);
    return rr;
  }
```

**5.2 — 헬퍼: computeReturnRefundAmount, insertRefundAuditLink**

- [ ] **Step 3: 금액 계산 헬퍼 추가** — `calculateReturnRefund`(`:1287`) 위에 추가. completeReturnRequest·attemptReturnRefund 공용(중복 제거).

```typescript
  /** 반품 환불 금액 계산 — 주문/라인/반품라인을 로드해 calculateReturnRefund 위임. tx 컨텍스트 전용. */
  private async computeReturnRefundAmount(
    returnRequestId: string,
    salesOrder: { id: string; totalAmount: number | null; shippingFee: number },
    tx: Parameters<Parameters<typeof this.db.db.transaction>[0]>[0],
  ): Promise<number> {
    const [allOrderLines, returnItems] = await Promise.all([
      tx
        .select({
          id: wmsTables.salesOrderLines.id,
          quantity: wmsTables.salesOrderLines.quantity,
          unitPrice: wmsTables.salesOrderLines.unitPrice,
          totalPrice: wmsTables.salesOrderLines.totalPrice,
        })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrder.id)),
      tx
        .select({
          salesOrderLineId: returnExchangeTables.returnRequestItems.salesOrderLineId,
          quantity: returnExchangeTables.returnRequestItems.quantity,
          unitPrice: wmsTables.salesOrderLines.unitPrice,
        })
        .from(returnExchangeTables.returnRequestItems)
        .leftJoin(wmsTables.salesOrderLines, eq(returnExchangeTables.returnRequestItems.salesOrderLineId, wmsTables.salesOrderLines.id))
        .where(eq(returnExchangeTables.returnRequestItems.returnRequestId, returnRequestId)),
    ]);
    return this.calculateReturnRefund(returnItems, allOrderLines, salesOrder.totalAmount ?? null, salesOrder.shippingFee ?? 0);
  }

  /** 환불 시도 감사 로그 (기존 return_linked_wallet_refund businessLink 연속 — 상태 SoT 는 attempt 행). */
  private async insertRefundAuditLink(
    tx: Parameters<Parameters<typeof this.db.db.transaction>[0]>[0],
    returnRequestId: string,
    attempt: { idempotencyKey: string; amount: number; attemptNumber: number },
    outcome: WalletRefundOutcome,
  ): Promise<void> {
    const refundId = outcome.kind === 'success' || outcome.kind === 'partial_pending' ? outcome.refunds?.[0]?.refundId : undefined;
    await tx.insert(wmsTables.businessLinks).values({
      sourceType: 'return_request',
      sourceId: returnRequestId,
      targetType: 'wallet_refund',
      targetExternalRef: refundId ? `wallet:refund:${refundId}` : `wallet:key:${attempt.idempotencyKey}`,
      relationName: 'return_linked_wallet_refund',
      metadata: { outcome: outcome.kind, amount: attempt.amount, correlationId: attempt.idempotencyKey, attemptN: attempt.attemptNumber },
    });
  }
```

(imports: `WalletRefundOutcome` 를 `:26` 의 wallet-refund.client import 에 추가 → `import { WalletRefundClient, WalletRefundOutcome } from './wallet-refund.client';`. `classifyRefundOutcome` import 추가 → `import { classifyRefundOutcome } from './return-refund-classification';`.)

**5.3 — attemptReturnRefund 3-phase 상태기계**

- [ ] **Step 4: attemptReturnRefund 추가** — `retryReturnRefund` 위(또는 completeReturnRequest 아래)에.

```typescript
  /**
   * refund_pending 반품을 Wallet 환불로 종결(성공)하거나 재시도 가능 상태로 유지한다.
   * intent-first attempt 행이 idempotency key·amount 의 SoT (규율 2). 초회·재시도 공용.
   *
   * Phase A(tx, FOR UPDATE): 행 잠금 + pending attempt 재사용 or 신규 attempt INSERT (Wallet 호출 전 durable)
   * Phase B(tx 밖): attempt 행의 key·amount 로 Wallet 호출
   * Phase C(tx, FOR UPDATE): classifyRefundOutcome 로 attempt 행 + 반품 상태 전이
   */
  private async attemptReturnRefund(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    // ── Phase A ──────────────────────────────────────────────────────────────
    const claim = await this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx, { forUpdate: true });
      if (rr.status === 'completed') return { done: rr as ReturnRequest, attempt: null, walletIntentId: null as string | null };
      if (rr.status !== 'refund_pending') {
        throw new ConflictException(`환불 시도는 'refund_pending' 상태에서만 가능합니다. 현재 상태: ${rr.status}`);
      }

      const salesOrder = await tx
        .select({
          id: wmsTables.salesOrders.id,
          walletIntentId: wmsTables.salesOrders.walletIntentId,
          totalAmount: wmsTables.salesOrders.totalAmount,
          shippingFee: wmsTables.salesOrders.shippingFee,
        })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, rr.salesOrderId))
        .limit(1)
        .then((r) => r[0]);

      if (!salesOrder?.walletIntentId) {
        throw new BadRequestException('walletIntentId가 없어 환불이 불가합니다. 수동 완료를 사용하세요.');
      }

      // pending attempt 재사용 (복구/in-flight) — 같은 key·amount (규율 2)
      const pending = await tx
        .select()
        .from(returnExchangeTables.returnRefundAttempts)
        .where(
          and(
            eq(returnExchangeTables.returnRefundAttempts.returnRequestId, returnRequestId),
            eq(returnExchangeTables.returnRefundAttempts.status, 'pending'),
          ),
        )
        .orderBy(desc(returnExchangeTables.returnRefundAttempts.attemptNumber))
        .limit(1)
        .then((r) => r[0]);

      if (pending) {
        return { done: null, attempt: pending, walletIntentId: salesOrder.walletIntentId };
      }

      // 신규 attempt (N = max+1) — 규율 1: pending 없을 때만(직전 확정 failed 또는 최초)
      const amount = await this.computeReturnRefundAmount(returnRequestId, salesOrder, tx);
      if (amount <= 0) {
        throw new BadRequestException('환불 금액이 0원 이하입니다. 수동 완료를 사용하세요.');
      }
      const maxRow = await tx
        .select({ maxN: max(returnExchangeTables.returnRefundAttempts.attemptNumber) })
        .from(returnExchangeTables.returnRefundAttempts)
        .where(eq(returnExchangeTables.returnRefundAttempts.returnRequestId, returnRequestId))
        .then((r) => r[0]);
      const attemptNumber = (maxRow?.maxN ?? 0) + 1;
      const idempotencyKey = `return:${returnRequestId}:refund:${attemptNumber}`;
      const [attempt] = await tx
        .insert(returnExchangeTables.returnRefundAttempts)
        .values({ returnRequestId, attemptNumber, idempotencyKey, amount, status: 'pending' })
        .returning();
      return { done: null, attempt, walletIntentId: salesOrder.walletIntentId };
    });

    if (claim.done) return claim.done;
    const attempt = claim.attempt!;

    // ── Phase B (tx 밖) ────────────────────────────────────────────────────────
    let outcome: WalletRefundOutcome;
    try {
      outcome = await this.walletRefundClient.refundByIntent(claim.walletIntentId!, attempt.amount, {
        reasonCode: 'RETURN_COMPLETED',
        correlationId: attempt.idempotencyKey,
      });
    } catch (err) {
      // 네트워크 예외 등 = 불확정. attempt pending 유지 → 같은 key 재생 (규율 1).
      this.logger.error(
        `[ReturnRefund] Wallet call threw for return ${returnRequestId} attempt ${attempt.attemptNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.db.db.transaction((tx) => this.findReturnRequestOrThrow(returnRequestId, tx)) as Promise<ReturnRequest>;
    }

    // ── Phase C ──────────────────────────────────────────────────────────────
    const decision = classifyRefundOutcome(outcome);
    return this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx, { forUpdate: true });
      await this.insertRefundAuditLink(tx, returnRequestId, attempt, outcome);

      const walletOutcomeMeta = { kind: outcome.kind, errorCode: 'errorCode' in outcome ? outcome.errorCode : undefined };

      if (decision === 'succeeded') {
        await tx
          .update(returnExchangeTables.returnRefundAttempts)
          .set({ status: 'succeeded', walletOutcome: walletOutcomeMeta, updatedAt: new Date() })
          .where(eq(returnExchangeTables.returnRefundAttempts.id, attempt.id));
        if (rr.status === 'completed') return rr as ReturnRequest; // 경합: 이미 완료
        const now = new Date();
        const [completed] = await tx
          .update(returnExchangeTables.returnRequests)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
          .returning();
        return completed as ReturnRequest;
      }

      if (decision === 'failed') {
        // 확정 실패 → attempt 닫음 (다음 재시도가 N+1). RR refund_pending 유지.
        await tx
          .update(returnExchangeTables.returnRefundAttempts)
          .set({ status: 'failed', walletOutcome: walletOutcomeMeta, updatedAt: new Date() })
          .where(eq(returnExchangeTables.returnRefundAttempts.id, attempt.id));
        this.logger.error(`[ReturnRefund] Determinate failure for return ${returnRequestId} attempt ${attempt.attemptNumber}: ${JSON.stringify(walletOutcomeMeta)}`);
        return rr as ReturnRequest;
      }

      // decision === 'pending' — 불확정. attempt pending 유지(같은 key 재생), RR refund_pending 유지.
      await tx
        .update(returnExchangeTables.returnRefundAttempts)
        .set({ walletOutcome: walletOutcomeMeta, updatedAt: new Date() })
        .where(eq(returnExchangeTables.returnRefundAttempts.id, attempt.id));
      this.logger.warn(`[ReturnRefund] Indeterminate outcome for return ${returnRequestId} attempt ${attempt.attemptNumber} (${outcome.kind}). Staying refund_pending; same key retries.`);
      return rr as ReturnRequest;
    });
  }
```

**5.4 — completeReturnRequest·retryReturnRefund 위임 재작성**

- [ ] **Step 5: completeReturnRequest Phase 2 를 attemptReturnRefund 위임으로 교체** — `:402-531` 을 교체. 금액 계산을 Phase 1 tx **안**으로 옮겨(tx 타입 통일) 별도 non-tx 읽기·타입 union 을 제거.

```typescript
  async completeReturnRequest(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    // Phase 1: inspected → refund_pending (or completed). 금액 계산도 tx 내에서.
    const phase1 = await this.db.db.transaction(async (tx) => {
      const rr = await this.findReturnRequestOrThrow(returnRequestId, tx, { forUpdate: true });
      if (rr.status !== 'inspected') {
        throw new ConflictException(`반품 요청 상태가 'inspected'가 아닙니다. 현재 상태: ${rr.status}`);
      }

      const salesOrder = await tx
        .select({
          id: wmsTables.salesOrders.id,
          walletIntentId: wmsTables.salesOrders.walletIntentId,
          totalAmount: wmsTables.salesOrders.totalAmount,
          shippingFee: wmsTables.salesOrders.shippingFee,
        })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, rr.salesOrderId))
        .limit(1)
        .then((r) => r[0]);

      const refundAmount = salesOrder ? await this.computeReturnRefundAmount(returnRequestId, salesOrder, tx) : 0;
      const immediateComplete = refundAmount <= 0;
      const needsRefund = !immediateComplete && !!salesOrder?.walletIntentId;

      const now = new Date();
      const nextStatus = immediateComplete ? 'completed' : 'refund_pending';
      const [result] = await tx
        .update(returnExchangeTables.returnRequests)
        .set({ status: nextStatus, ...(immediateComplete ? { completedAt: now } : {}), updatedAt: now })
        .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
        .returning();
      await this.insertBusinessLink(tx, 'return_request', returnRequestId, rr.salesOrderId, 'return_lifecycle_event', {
        event: immediateComplete ? 'return_completed' : 'return_refund_pending',
        adminId,
        timestamp: now.toISOString(),
      });

      if (!immediateComplete && salesOrder && !salesOrder.walletIntentId) {
        this.logger.warn(
          `[ReturnRefund] No walletIntentId for SO ${salesOrder.id}, return ${returnRequestId}. Manual refund required.`,
        );
      }
      return { updatedRequest: result, immediateComplete, needsRefund };
    });

    if (phase1.immediateComplete || !phase1.needsRefund) {
      return phase1.updatedRequest;
    }

    // Phase 2+: 통합 상태기계 (intent-first attempt 행 + 결정적 key)
    return this.attemptReturnRefund(returnRequestId, adminId);
  }
```

- [ ] **Step 6: retryReturnRefund 를 attemptReturnRefund 위임으로 교체** — `:656-768` 을 교체(링크-카운트·randomUUID 제거).

```typescript
  async retryReturnRefund(returnRequestId: string, adminId: string): Promise<ReturnRequest> {
    const rr = await this.db.db
      .select()
      .from(returnExchangeTables.returnRequests)
      .where(eq(returnExchangeTables.returnRequests.id, returnRequestId))
      .limit(1)
      .then((r) => r[0]);

    if (!rr) throw new NotFoundException(`반품 요청을 찾을 수 없습니다: ${returnRequestId}`);
    if (rr.status !== 'refund_pending') {
      throw new ConflictException(`환불 재시도는 'refund_pending' 상태에서만 가능합니다. 현재 상태: ${rr.status}`);
    }
    // walletIntentId·금액 가드는 attemptReturnRefund Phase A 가 수행(BadRequestException).
    return this.attemptReturnRefund(returnRequestId, adminId);
  }
```

- [ ] **Step 7: randomUUID import 잔존 확인 및 제거**

Run: `grep -n "randomUUID" apps/core/src/modules/sales-order/services/store-return-exchange.service.ts || echo "randomUUID 제거됨"`
Expected: `randomUUID 제거됨`. 남아있으면 `:2` import 삭제.

**5.5 — 유닛 테스트 (mock 확장 + 상태기계 회귀)**

- [ ] **Step 8: mock helper 확장** — `store-return-exchange.service.spec.ts` 의 `makeMockDb` 의 `terminal()`(`:75-87`)에 `for` 지원 추가.

```typescript
  function terminal(rows: unknown[]): Record<string, unknown> {
    const self: Record<string, unknown> = {
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
      offset: () => terminal(rows),
      orderBy: () => terminal(rows),
      where: () => terminal(rows),
      innerJoin: () => terminal(rows),
      leftJoin: () => terminal(rows),
      groupBy: () => terminal(rows),
      for: () => terminal(rows),
      then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return self;
  }
```

`makeInsert()`(`:107-112`)를 `.returning()` 이 삽입 행을 돌려주도록 확장(attempt 행 생성용):

```typescript
  const makeInsert = () =>
    jest.fn((/* table */) => ({
      values: jest.fn((vals: Record<string, unknown>) => ({
        returning: jest.fn().mockResolvedValue([{ id: 'attempt-generated', ...vals }]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      })),
    }));
```

- [ ] **Step 9: 상태기계 회귀 테스트 작성** — 기존 `retryReturnRefund` describe(`:793-842`)의 randomUUID 테스트(`:807-842`) **삭제**하고 아래로 교체. `completeReturnRequest` 테스트들(`:596-735`)의 `tx.select` 커스텀 목은 `for` 를 타므로 확장된 terminal 이 커버(별도 수정 불요 — 커스텀 목이 `where→{limit,then}` 형태면 `.for('update')` 호출 실패하므로, 아래 `makeTx` 헬퍼로 통일).

```typescript
// ── attemptReturnRefund state machine (작업 14) ──────────────────────────────
describe('StoreReturnExchangeService.attemptReturnRefund (상태기계)', () => {
  const INTENT = 'intent-123';
  const SO = { id: ORDER_ID, walletIntentId: INTENT, totalAmount: 5000, shippingFee: 0 };
  const RETURN_ITEMS = [{ salesOrderLineId: LINE_ID, quantity: 1, unitPrice: 5000 }];
  const ORDER_LINES = [{ id: LINE_ID, quantity: 1, unitPrice: 5000, totalPrice: 5000 }];

  // 반품/주문/라인/attempt 테이블별 행을 주입하는 tx 목 (Phase A·C 공용).
  function makeTx(opts: {
    rr: Record<string, unknown>;
    pendingAttempt?: Record<string, unknown> | null;
    maxN?: number;
    onUpdate?: (table: unknown, set: Record<string, unknown>) => void;
    completedRr?: Record<string, unknown>;
  }) {
    const insertedAttempts: Record<string, unknown>[] = [];
    let attemptSel = 0; // Phase A 의 attempts 조회 순서: 1=pending 조회, 2=max(N) 조회
    const rowsFor = (table: unknown): unknown[] => {
      if (table === returnExchangeTables.returnRequests) return [opts.rr];
      if (table === wmsTables.salesOrders) return [SO];
      if (table === wmsTables.salesOrderLines) return ORDER_LINES;
      if (table === returnExchangeTables.returnRequestItems) return RETURN_ITEMS;
      if (table === returnExchangeTables.returnRefundAttempts) {
        attemptSel++;
        if (opts.pendingAttempt) return [opts.pendingAttempt]; // pending 존재 → 재사용(max 조회 미도달)
        return attemptSel === 1 ? [] : [{ maxN: opts.maxN ?? 0 }]; // 1st=pending 없음, 2nd=max(N)
      }
      return [];
    };
    function terminal(rows: unknown[]): Record<string, unknown> {
      const self: Record<string, unknown> = {
        limit: (n: number) => Promise.resolve(rows.slice(0, n)),
        where: () => terminal(rows), orderBy: () => terminal(rows), innerJoin: () => terminal(rows),
        leftJoin: () => terminal(rows), for: () => terminal(rows),
        then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
      };
      return self;
    }
    return {
      select: jest.fn(() => ({ from: (t: unknown) => terminal(rowsFor(t)) })),
      insert: jest.fn((_t: unknown) => ({
        values: jest.fn((vals: Record<string, unknown>) => {
          const row = { id: `attempt-${insertedAttempts.length + 1}`, ...vals };
          insertedAttempts.push(row);
          return { returning: jest.fn().mockResolvedValue([row]), then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r) };
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          opts.onUpdate?.(table, set);
          return { where: () => ({ returning: jest.fn().mockResolvedValue([opts.completedRr ?? { ...opts.rr, ...set }]) }) };
        },
      })),
      _insertedAttempts: insertedAttempts,
    };
  }

  function makeDbFrom(tx: Record<string, unknown>) {
    // retryReturnRefund 초기 조회는 top-level this.db.db.select 를 씀 → tx.select 위임.
    return { db: { select: tx.select, transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) } };
  }

  it('신규 attempt: 결정적 key return:{id}:refund:1 로 Wallet 호출', async () => {
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }), pendingAttempt: null, maxN: 0 });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({ kind: 'failed', errorCode: 'X', errorMessage: 'm', determinate: true });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    await service.retryReturnRefund(RR_ID, 'admin-1');

    expect(wallet.refundByIntent).toHaveBeenCalledWith(INTENT, 5000, expect.objectContaining({ correlationId: `return:${RR_ID}:refund:1` }));
  });

  it('pending attempt 재사용(복구): 같은 key 재생, N 증가 없음', async () => {
    const pending = { id: 'att-1', returnRequestId: RR_ID, attemptNumber: 1, idempotencyKey: `return:${RR_ID}:refund:1`, amount: 5000, status: 'pending' };
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }), pendingAttempt: pending });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({ kind: 'success', refunds: [{ refundId: 'r1', status: 'SUCCEEDED' }] });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    const result = await service.retryReturnRefund(RR_ID, 'admin-1');

    // 재사용 → 같은 key, 저장된 amount(5000). 신규 INSERT 없음.
    expect(wallet.refundByIntent).toHaveBeenCalledWith(INTENT, 5000, expect.objectContaining({ correlationId: `return:${RR_ID}:refund:1` }));
    expect((tx as { _insertedAttempts: unknown[] })._insertedAttempts).toHaveLength(0);
    expect(result.status).toBe('completed');
  });

  it('already_refunded → completed (P1-8 2차 방어)', async () => {
    const pending = { id: 'att-1', returnRequestId: RR_ID, attemptNumber: 1, idempotencyKey: `return:${RR_ID}:refund:1`, amount: 5000, status: 'pending' };
    const completedRr = { ...makeReturnRequest({ status: 'completed' }) };
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }), pendingAttempt: pending, completedRr });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({ kind: 'already_refunded', errorCode: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE', errorMessage: 'm' });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    const result = await service.retryReturnRefund(RR_ID, 'admin-1');
    expect(result.status).toBe('completed');
  });

  it('in_flight(불확정) → refund_pending 유지, attempt pending 유지 (규율 3)', async () => {
    const pending = { id: 'att-1', returnRequestId: RR_ID, attemptNumber: 1, idempotencyKey: `return:${RR_ID}:refund:1`, amount: 5000, status: 'pending' };
    const setCalls: Record<string, unknown>[] = [];
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }), pendingAttempt: pending, onUpdate: (t, set) => { if (t === returnExchangeTables.returnRefundAttempts) setCalls.push(set); } });
    const wallet = makeWalletClient();
    (wallet.refundByIntent as jest.Mock).mockResolvedValue({ kind: 'in_flight', errorCode: 'IDEMPOTENCY_KEY_IN_FLIGHT', errorMessage: 'm' });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, wallet as never);

    const result = await service.retryReturnRefund(RR_ID, 'admin-1');
    expect(result.status).toBe('refund_pending');
    // attempt status 는 pending 유지 (set 에 status 미포함)
    expect(setCalls.every((s) => s.status === undefined)).toBe(true);
  });

  it('walletIntentId 없으면 BadRequestException', async () => {
    const tx = makeTx({ rr: makeReturnRequest({ status: 'refund_pending' }) });
    (tx.select as jest.Mock).mockImplementation(() => ({
      from: (t: unknown) => {
        const rows = t === wmsTables.salesOrders ? [{ id: ORDER_ID, walletIntentId: null }] : [makeReturnRequest({ status: 'refund_pending' })];
        const term = (r: unknown[]): Record<string, unknown> => ({ limit: (n: number) => Promise.resolve(r.slice(0, n)), where: () => term(r), for: () => term(r), orderBy: () => term(r), then: (res: (v: unknown[]) => unknown) => Promise.resolve(r).then(res) });
        return term(rows);
      },
    }));
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, makeWalletClient() as never);
    await expect(service.retryReturnRefund(RR_ID, 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('refund_pending 아니면 ConflictException', async () => {
    const tx = makeTx({ rr: makeReturnRequest({ status: 'inspected' }) });
    const service = new StoreReturnExchangeService(makeDbFrom(tx) as never, makeWalletClient() as never);
    await expect(service.retryReturnRefund(RR_ID, 'admin-1')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 10: 기존 completeReturnRequest 테스트 정합** — `:596-735` 의 3개 테스트가 새 흐름(FOR UPDATE + attemptReturnRefund)을 타므로, 각 테스트의 `tx.select`/`tx.update` 커스텀 목이 `for()`·attempt 테이블 조회·`returning()` 을 지원하도록 위 `makeTx` 패턴으로 재작성하거나 최소 확장한다. `partial_pending` 테스트는 결과 `refund_pending` 기대 유지(불확정), `wallet fails` 테스트는 `{kind:'failed', determinate:true}` 로 mock 갱신 후 `refund_pending` 기대 유지, `unitPrice×quantity` 테스트는 `refundByIntent` 호출 금액 단언 유지(신규 attempt 경로).

- [ ] **Step 11: 유닛 테스트 실행**

Run: `npx jest --config apps/core/jest.config.ts store-return-exchange.service.spec`
Expected: PASS (신규 상태기계 + 갱신된 기존 테스트).

- [ ] **Step 12: deferred 통합 spec 작성(⏸ dev DB)** — intent-first 커밋·FOR UPDATE 직렬화·마이그레이션 실행은 실 DB 필요. `store-return-exchange.refund.integration.spec.ts` 에 `describeIfDb`(DATABASE_URL 게이트) 스켈레톤 작성: (1) 크래시-후-복구(pending attempt 존재 → 재시도 같은 key → success → completed), (2) 확정 실패 → N+1 새 key, (3) 동시 재시도 직렬화(FOR UPDATE), (4) partial unique 위반 시 재사용. dev DB 부재로 auto-skip.

```typescript
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
describeIfDb('StoreReturnExchangeService refund state machine (integration)', () => {
  it.todo('크래시 후 재시도: 같은 key 재생 → completed');
  it.todo('확정 실패 → 다음 재시도 N+1 새 key');
  it.todo('동시 재시도 FOR UPDATE 직렬화 → 이중 attempt 없음');
});
```

- [ ] **Step 13: isolatedModules 타입체크(deferred spec)** — build/jest 가 spec 을 타입체크 안 하므로 별도 tsc(작업 10 판례). `it.todo` 만이면 생략 가능하나, 본문 채우면 실행.

Run: `npx tsc --noEmit --isolatedModules false apps/core/src/modules/sales-order/services/store-return-exchange.refund.integration.spec.ts 2>&1 | head || echo "todo-only, skip"`
Expected: 에러 0 또는 todo-only.

- [ ] **Step 14: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/store-return-exchange.service.ts \
        apps/core/src/modules/sales-order/services/store-return-exchange.service.spec.ts \
        apps/core/src/modules/sales-order/services/store-return-exchange.refund.integration.spec.ts
git commit -m "feat(core): 반품 환불 intent-first 상태기계 + already_refunded 매핑 (작업 14, P1-8·P1-9·P2-12)"
```

---

### Task 6: 취소 경로 `in_flight` case (net 동작 보존)

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:779-796` (`requestWalletRefundAfterCancel` switch)
- Test: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`

**Interfaces:**
- Consumes: `WalletRefundOutcome` 의 새 `in_flight` kind(Task 3)
- Produces: 취소 환불 switch 가 `in_flight` 를 명시 처리 → `manual_pending` 반환(기존 default 와 동일 안전값, 이중환불 없음).

**배경:** Task 3 이후 409 IN_FLIGHT 는 `failed` 대신 `in_flight` 로 온다. 취소 switch(`:715-797`)에 `in_flight` case 가 없으면 `default`(`:793-795`)로 흘러 `manual_pending` — 기존(409→failed→failed 기록) 대비 무손실·개선이나, 명시 case + 감사 링크로 관측성 확보.

- [ ] **Step 1: 실패 테스트 작성** — `store-sales-orders.service.spec.ts` 의 `cancelRequestByChannelOrder` describe(`:105`)에 추가. 기존 `makeContext({ walletOutcome })` 헬퍼(`:89-99`)와 `wallet_unavailable` 테스트(`:164-169`) 패턴을 그대로 따른다.

```typescript
    it('Wallet이 in_flight 반환 시 refundStatus=manual_pending (취소는 유지, 이중환불 없음)', async () => {
      const { service } = makeContext({
        walletOutcome: { kind: 'in_flight', errorCode: 'IDEMPOTENCY_KEY_IN_FLIGHT', errorMessage: 'in progress' },
      });
      const result = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(result.refundStatus).toBe('manual_pending');
    });
```

- [ ] **Step 2: 테스트 실패/우연통과 확인** — `in_flight` case 부재 시 `default`(`:793-795`)로 흘러 `manual_pending` 을 우연히 반환할 수 있다(=테스트 통과). 이 경우 감사 링크가 기록되지 않는 게 차이 → note 단언을 추가해 명시 case 를 강제.

Run: `npx jest --config apps/core/jest.config.ts store-sales-orders.service.spec -t "in_flight"`
Expected: FAIL(우연 통과 시 Step 3 후 감사 링크 존재로 재확인) — 명시 case 추가가 목적.

- [ ] **Step 3: switch 에 in_flight case 추가** — `:779` 의 `wallet_unavailable` case 아래(또는 `no_intent_id` 위)에.

```typescript
      case 'in_flight': {
        await this.recordWalletRefundLink(so.id, {
          refundStatus: 'manual_pending',
          intentId: so.walletIntentId,
          amount,
          note: `환불 처리 중(Idempotency in-flight): ${outcome.errorMessage}`,
          reasonCode: dto.reasonCode,
          attemptType,
          actor,
          correlationId,
          extraMetadata: options?.extraMetadata,
        });
        return 'manual_pending';
      }
```

- [ ] **Step 4: 테스트 통과 확인 + 빌드**

Run: `npx jest --config apps/core/jest.config.ts store-sales-orders.service.spec && npx nest build core`
Expected: PASS · build exit 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/store-sales-orders.service.ts \
        apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts
git commit -m "feat(core): 취소 환불 switch 에 in_flight case 추가 (작업 14, net 보존)"
```

---

## 최종 검증 (전 태스크 후)

- [ ] **빌드**: `npx nest build core` → exit 0
- [ ] **arch 경계**: `npx jest --config apps/core/jest.config.ts inventory-write-boundary.arch` → PASS (신규 테이블은 stockEvents 직접 INSERT 아님 — store 경계 무영향)
- [ ] **변경 모듈 유닛**: `npx jest --config apps/core/jest.config.ts sales-order` → GREEN
- [ ] **eslint(변경 파일 신규 error 0)**: `npx eslint apps/core/src/modules/sales-order/services/store-return-exchange.service.ts apps/core/src/modules/sales-order/services/wallet-refund.client.ts apps/core/src/modules/sales-order/services/return-refund-classification.ts apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` → develop 대비 신규 error 0 (repo 전역 debt 무관)
- [ ] **삭제 심볼 참조 0**: `grep -rn "randomUUID" apps/core/src/modules/sales-order/services/store-return-exchange.service.ts` → 0
- [ ] **admin-web 무변경 확인**: 재시도/완료 엔드포인트 시그니처 불변 → admin-web 손 안 댐
- [ ] **마이그레이션 ⏸**: 생성 SQL 커밋됨, `db:migrate` 미실행(dev DB 복구 시)

## 커밋 매핑 (spec 커버리지 자기검토)

| spec 요구 | Task |
|---|---|
| P1-10 비례식 통일(§3.5) | Task 1 |
| 신규 테이블 SoT(§3.2) | Task 2 |
| client determinate/in_flight(§3.3) | Task 3 |
| 순수 분류기 규율 1·3(§3.1·§3.4) | Task 4 |
| attemptReturnRefund 3-phase·intent-first·FOR UPDATE·already_refunded·재시도 통합(§3.1·§3.4, P1-8·P1-9·P2-12) | Task 5 |
| 취소 net 보존 in_flight(§3.3) | Task 6 |
