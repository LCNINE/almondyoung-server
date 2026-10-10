# 채널 취소 wallet 환불 거절 — 사유 표시·보류 유지 Implementation Plan (#1016 36번 행)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채널(Medusa) 주문 취소가 wallet 의 영구 환불 거절로 막히면, 출고 보류를 유지한 채 «환불 불가 / 장부 불일치» 사유를 정체 보드와 주문 상세에 보인다.

**Architecture:** Medusa almond-payment 가 wallet 400 을 분류해 `MedusaError(NOT_ALLOWED, …, 'wallet_refund_<kind>:<walletCode>')` 로 던진다 → channel-adapter 가 그 `code` 를 읽어 `ChannelOrderCancelRejected(REFUND_FAILED, refundFailure)` 또는 `ChannelOrderCancelStalled(refundFailure)` 를 낸다 → core 는 `REFUND_FAILED` 를 받아도 요청을 닫지 않고 `metadata.request.refundFailure` 만 적는다 → 정체 보드 판정 SQL 이 새 세부 상태 둘을 내고 admin-web 이 갈래별 문구를 보인다.

**Tech Stack:** NestJS · Drizzle · zod(`@packages/event-contracts`) · Medusa 2.13.4 · Next.js(admin-web) · Jest

**Spec:** `docs/superpowers/specs/2026-10-10-channel-cancel-refund-refusal-design.md` (상위: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` §7.2, ADR-0042)

## Global Constraints

- 갈래는 둘: `refused`(환불 불가) / `ledger_mismatch`(장부 불일치). 분류표는 스펙 §4.1 그대로 — `refused` = `REFUND_NOT_AUTOMATABLE`, `MEMBERSHIP_REFUND_NOT_ALLOWED` / `ledger_mismatch` = `REFUND_AMOUNT_EXCEEDS_TOTAL`, `REFUND_AMOUNT_EXCEEDS_AVAILABLE`, `REFUND_AMOUNT_EXCEEDS_CHARGE`, `CHARGE_NOT_REFUNDABLE`, `REFUNDABLE_CHARGE_NOT_FOUND` / 그 밖 = 분류 없음(재시도)
- 표지 형식: `wallet_refund_<kind>:<walletCode>` (예: `wallet_refund_ledger_mismatch:REFUND_AMOUNT_EXCEEDS_TOTAL`) — Medusa 와 channel-adapter 의 스펙이 이 예시 값을 그대로 쓴다
- 계약은 enum 을 늘리지 않는다 — `REFUND_FAILED` + optional `refundFailure: { kind, walletCode }`
- core 는 `REFUND_FAILED` 에 요청을 **닫지 않는다**(`requested` 유지 = 보류 유지)
- 보드 세부 상태 이름: `cancel_refund_refused`, `cancel_refund_mismatch` / 라벨: «취소 · 환불 불가», «취소 · 장부 불일치»
- 주문 상세 문구: 환불 불가 «환불 불가 · 다른 수단으로 환불 필요 · <message>» / 장부 불일치 «장부 불일치 · 다시 환불하지 마세요 · wallet 환불 내역 대조 · <message>»
- 마이그레이션 없음
- 머지 순서 PR 1(계약+core+admin-web) → PR 2(channel-adapter) → PR 3(Medusa). PR 2 는 PR 1 위에 쌓고, PR 3 은 develop 에서 따로 딴다
- 서비스는 `@app/shared` 도메인 예외만, `any`/`as` 금지(테스트의 `as never` 목 주입은 기존 관례), 코드 주석은 «왜»만 한국어로
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`

## Review Focus

1. **일시 실패가 영구 거절 사유를 지우면 안 된다** — 부분취소에서 영구 거절 뒤 재시도가 일시 실패(사유 없는 Stalled)를 내도 보드는 «장부 불일치»를 유지해야 한다. → Task 3 테스트 «사유 없는 정체 사실은 저장된 사유를 지우지 않는다»
2. **다시 보내기 뒤 같은 거절이 다시 오면 다시 붙어야 한다** — `resend` 가 사유를 지운 뒤 같은 `walletCode` 가 와도 «같은 값이라 무시»로 빠지면 보드가 영영 «처리 중»이다. → Task 3 테스트 «다시 보내기 — 사유를 지우고, 같은 거절이 다시 오면 다시 붙는다»
3. **모르는 갈래의 표지는 재시도 루프가 아니라 종결로 떨어져야 한다** — `wallet_refund_other:X` 는 `NOT_CANCELABLE` 로 닫힌다. → Task 8 테스트
4. **일시 실패는 계속 재시도여야 한다** — wallet 502, 본문 없는 404, 코드 없는 400 은 분류되지 않는다. → Task 11 분류 표 테스트 + Task 12 통합 «wallet 502 는 지금처럼 500»
5. **REFUND_FAILED 외의 거절은 지금처럼 닫혀야 한다** — 분기 추가가 `NOT_CANCELABLE`·`EXTERNAL_REFUND_UNRESOLVED` 경로를 바꾸면 안 된다. → 기존 Task 3 대상 스펙(`channel-cancel-request.facts.integration.spec.ts` 의 «거절 — rejected + 사유») 이 그대로 초록인지 Step 에서 확인

---

## 작업 위치

```bash
# PR 1·2 — 한 워크트리에서 브랜치를 쌓는다
git worktree add .claude/worktrees/feat-1016-36-refund-refusal -b feat/1016-36-refund-refusal-receive develop
# 워크트리엔 warehouse-app node_modules 링크가 필요하다(없으면 type-check 에러)
ln -s ../../../../native/warehouse-app/node_modules .claude/worktrees/feat-1016-36-refund-refusal/native/warehouse-app/node_modules
# PR 3 — develop 에서 따로
git worktree add .claude/worktrees/feat-1016-36-refund-refusal-medusa -b feat/1016-36-refund-refusal-medusa develop
```

core 통합 스펙은 워크트리에서 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>` 으로 돌린다(빠뜨리면 compose 가 워크트리명으로 두 번째 postgres 를 띄우려다 죽는다). 로컬 core DB 가 다른 브랜치 마이그 잔재로 migrate 에 실패하면 임시 DB 에 전체 마이그를 적용하고 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<임시DB> npx jest --runInBand --runTestsByPath <파일>` 로 돌린다.

---

# PR 1 — 계약 + core + admin-web (브랜치 `feat/1016-36-refund-refusal-receive`)

### Task 1: 계약 — `refundFailure` 필드와 `REFUND_FAILED` 제약

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts:594-648` (취소 결과 사실 절)
- Test: `packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`

**Interfaces:**
- Produces: `REFUND_FAILURE_KINDS = ['refused', 'ledger_mismatch'] as const`, `type RefundFailureKind`, `interface ChannelOrderCancelRefundFailure { kind: RefundFailureKind; walletCode: string }`, `ChannelOrderCancelRejectedPayload.refundFailure?`, `ChannelOrderCancelStalledPayload.refundFailure?` — 모두 `@packages/event-contracts/streams` 에서 export

- [ ] **Step 1: 실패하는 테스트로 바꾼다**

`channel-order-cancel-facts.spec.ts` 의 `ChannelOrderCancelRejected` describe 안 첫 `it.each` 를 다음으로 바꾸고, 그 아래에 두 개를 더한다. `ChannelOrderCancelStalled` describe 에도 하나 더한다.

```ts
    it.each(CHANNEL_ORDER_CANCEL_REJECTION_CODES.filter((code) => code !== 'REFUND_FAILED'))('%s 를 받는다', (reasonCode) => {
      const payload = { ...key, reasonCode, message: '사유' };
      expect(schema.parse(payload)).toEqual(payload);
    });

    it('REFUND_FAILED 는 갈래·wallet 코드(refundFailure)를 반드시 싣는다(#1016 36번)', () => {
      const payload = {
        ...key,
        reasonCode: 'REFUND_FAILED',
        message: '장부 불일치',
        refundFailure: { kind: 'ledger_mismatch', walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL' },
      };
      expect(schema.parse(payload)).toEqual(payload);
      expect(() => schema.parse({ ...payload, refundFailure: undefined })).toThrow();
      expect(() => schema.parse({ ...payload, refundFailure: { kind: 'other', walletCode: 'X' } })).toThrow();
      expect(() => schema.parse({ ...payload, refundFailure: { kind: 'refused', walletCode: '' } })).toThrow();
    });
```

`ChannelOrderCancelStalled` describe 에:

```ts
    it('분류된 환불 거절로 멈췄으면 refundFailure 를 싣는다(#1016 36번) — 없어도 된다', () => {
      const payload = {
        ...key,
        stage: 'edited',
        message: '환불 미완',
        refundFailure: { kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE' },
      };
      expect(schema.parse(payload)).toEqual(payload);
      expect(schema.parse({ ...key, stage: 'edited', message: '환불 미완' })).toEqual({ ...key, stage: 'edited', message: '환불 미완' });
    });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`
Expected: FAIL — `REFUND_FAILED 는 …` 이 `refundFailure: undefined` 를 통과시킨다(throw 기대 실패), Stalled 테스트는 `refundFailure` 가 벗겨져 `toEqual` 실패.

- [ ] **Step 3: 계약 구현**

`orders.stream.ts` 의 `// ===== 채널 주문 취소 결과 (#1016 35번 행, ADR-0042) =====` 절을 이렇게 고친다.

`REFUND_FAILED` 주석 줄을 바꾼다:

```ts
 * - `REFUND_FAILED`: wallet 이 환불을 영구히 거절해 채널의 취소가 롤백됐다(#1016 36번). `refundFailure` 가 반드시 실린다.
 *   **종결 사실의 예외** — core 는 요청을 닫지 않고 열어 둔 채 보류를 유지한다(닫으면 고객이 취소한 주문이 출고로 돌아간다).
```

`CHANNEL_ORDER_CANCEL_REJECTION_CODES` 정의 바로 아래에 더한다:

```ts
/**
 * wallet 환불 거절의 갈래(#1016 36번 스펙 §4.1). Medusa almond-payment 가 분류한다.
 * - `refused`: 돈은 있는데 자동으로 못 돌려준다 — 다른 수단으로 환불해야 한다
 * - `ledger_mismatch`: wallet 이 Medusa 생각보다 돌려줄 돈이 적다 — 이미 환불됐을 수 있어 다시 환불하면 안 된다
 */
export const REFUND_FAILURE_KINDS = ['refused', 'ledger_mismatch'] as const;
export type RefundFailureKind = (typeof REFUND_FAILURE_KINDS)[number];

export interface ChannelOrderCancelRefundFailure {
  kind: RefundFailureKind;
  /** wallet 의 error 코드 그대로 — 화면·대사용 */
  walletCode: string;
}

const RefundFailureSchema = z.object({
  kind: z.enum(REFUND_FAILURE_KINDS),
  walletCode: z.string().min(1),
});
```

`ChannelOrderCancelRejectedPayload` 끝에 필드를 더한다:

```ts
  /** REFUND_FAILED 일 때 반드시 — 갈래와 wallet 코드 */
  refundFailure?: ChannelOrderCancelRefundFailure;
```

`ChannelOrderCancelRejectedSchema` 를 바꾼다:

```ts
const ChannelOrderCancelRejectedSchema = z
  .object({
    requestId: z.string().min(1),
    salesChannel: z.string().min(1),
    externalOrderId: z.string().min(1),
    reasonCode: z.enum(CHANNEL_ORDER_CANCEL_REJECTION_CODES),
    message: z.string(),
    unresolvedRefundAmount: z.number().int().nonnegative().optional(),
    refundFailure: RefundFailureSchema.optional(),
  })
  .superRefine((payload, context) => {
    // core 는 REFUND_FAILED 를 갈래로 보드 상태를 정한다 — 갈래 없는 REFUND_FAILED 는 «환불 불가»로도 «장부 불일치»로도 못 보인다
    if (payload.reasonCode === 'REFUND_FAILED' && payload.refundFailure === undefined) {
      context.addIssue({ code: 'custom', path: ['refundFailure'], message: 'REFUND_FAILED 는 refundFailure 를 싣는다' });
    }
  });
```

`ChannelOrderCancelStalledPayload` 끝에 필드를 더한다:

```ts
  /** 분류된 환불 거절로 멈췄을 때만(#1016 36번) — 일시 실패면 없다 */
  refundFailure?: ChannelOrderCancelRefundFailure;
```

`ChannelOrderCancelStalledSchema` 에 `refundFailure: RefundFailureSchema.optional(),` 를 `message` 아래에 더한다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`
Expected: PASS

Run: `npm run type-check`
Expected: 에러 0 (stream-builder 의 `event<…, Payload>(name, schema)` 가 `ZodEffects` 도 받는다 — `channel-orders-command.stream.ts` 가 같은 모양)

- [ ] **Step 5: Commit**

```bash
git add packages/event-contracts/streams/orders.stream.ts packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts
git commit -m "feat(contracts): #1016 36번 — 취소 거절·정체 사실에 환불 거절 갈래

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 2: core 메타데이터·뷰에 `refundFailure`

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts`
- Test: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts`

**Interfaces:**
- Consumes: `REFUND_FAILURE_KINDS` (Task 1)
- Produces: `type CancelRequestRefundFailure = { kind: RefundFailureKind; walletCode: string; message: string; at: string }`, `CancelRequestMetadata['request']['refundFailure']?`, `CancelRequestView.refundFailure: CancelRequestRefundFailure | null`

- [ ] **Step 1: 실패하는 테스트**

`channel-cancel-request.types.spec.ts` 의 `'뷰 — 단계·거절·결과'` 기대값 객체에 `refundFailure: null,` 을 `outcome: null,` 위에 더하고, describe 끝에 둘을 더한다:

```ts
  it('환불 거절 사유는 읽기·쓰기 왕복에서 살아남는다 — 스키마에 없으면 다음 write 가 조용히 떨군다(#1016 36번)', () => {
    const refundFailure = { kind: 'ledger_mismatch', walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL', message: '장부 불일치', at: '2026-10-10T00:00:00.000Z' };
    const withFailure = { ...metadata, request: { ...metadata.request, refundFailure } };
    expect(readCancelRequestMetadata(withFailure)).toEqual(withFailure);
    expect(() =>
      readCancelRequestMetadata({ ...metadata, request: { ...metadata.request, refundFailure: { ...refundFailure, kind: 'other' } } }),
    ).toThrow();
  });

  it('뷰 — 열린 요청의 환불 거절 사유', () => {
    const refundFailure = { kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE', message: '환불 불가', at: '2026-10-10T00:00:00.000Z' };
    const view = toCancelRequestView({
      id: 'r1',
      status: 'requested',
      createdAt: new Date('2026-10-07T00:00:00.000Z'),
      metadata: { ...metadata, request: { ...metadata.request, refundFailure } },
    });
    expect(view.refundFailure).toEqual(refundFailure);
    expect(view.rejection).toBeNull();
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts`
Expected: FAIL — 왕복에서 `refundFailure` 가 벗겨지고, 뷰에 `refundFailure` 키가 없다.

- [ ] **Step 3: 구현**

`channel-cancel-request.types.ts` 상단 import 를 바꾼다:

```ts
import { REFUND_FAILURE_KINDS, type CancelChannelOrderPayload } from '@packages/event-contracts/streams';
```

`CancelRequestMetadataSchema` 위에 더한다:

```ts
/** 열린 요청에 붙는 wallet 환불 거절 사유(#1016 36번) — 요청은 닫지 않는다(보류 유지). 다시 보내기가 지운다 */
const RefundFailureRecordSchema = z.object({
  kind: z.enum(REFUND_FAILURE_KINDS),
  walletCode: z.string(),
  message: z.string(),
  at: z.string(),
});

export type CancelRequestRefundFailure = z.infer<typeof RefundFailureRecordSchema>;
```

`request: z.object({ … })` 안 `appliedAt` 아래에 더한다:

```ts
    /** wallet 이 환불을 영구히 거절했다 — 보드가 «환불 불가 / 장부 불일치»로 갈라 보인다 */
    refundFailure: RefundFailureRecordSchema.optional(),
```

`CancelRequestView` 에 `refundFailure: CancelRequestRefundFailure | null;` 를 `rejection` 위에 더하고, `toCancelRequestView` 반환에 `refundFailure: meta.request.refundFailure ?? null,` 를 `rejection` 위에 더한다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts`
Expected: PASS

Run: `npm run type-check`
Expected: 에러 0. `CancelRequestView` 를 손으로 만드는 곳이 있으면 여기서 에러가 난다 — 그 자리에 `refundFailure: null` 을 더한다.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts
git commit -m "feat(core): #1016 36번 — 취소 요청 메타데이터·뷰에 환불 거절 사유

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 3: core 매니저 — 환불 거절은 닫지 않고 적는다

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts:166-210` (`reject`·`markStalled`·`resend`)
- Test: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.facts.integration.spec.ts`

**Interfaces:**
- Consumes: `ChannelOrderCancelRefundFailure` (Task 1), `CancelRequestMetadata` (Task 2)
- Produces: `reject(fact: { requestId; reasonCode; message; unresolvedRefundAmount?; refundFailure?: ChannelOrderCancelRefundFailure }, tx?)`, `markStalled(fact: { requestId; message?: string; refundFailure?: ChannelOrderCancelRefundFailure }, tx?)`. 컨슈머(`order-events.consumer.ts:303-322`)는 payload 를 그대로 넘기므로 고치지 않는다.

- [ ] **Step 1: 실패하는 통합 테스트**

`channel-cancel-request.facts.integration.spec.ts` 의 `OPERATOR` 상수 아래에 더한다:

```ts
const LEDGER = { kind: 'ledger_mismatch' as const, walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL' };
const REFUSED = { kind: 'refused' as const, walletCode: 'REFUND_NOT_AUTOMATABLE' };
```

describe 안 끝에 더한다:

```ts
  it('36번 환불 거절 — 닫지 않고(보류 유지) 갈래·사유를 요청에 적는다, 같은 사유가 다시 와도 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '장부 불일치', refundFailure: LEDGER }, tx);
      const first = await rowOf(tx, id);
      expect(first.status).toBe('requested');
      expect(first.metadata).toMatchObject({ request: { refundFailure: { ...LEDGER, message: '장부 불일치' } } });
      expect(first.metadata).not.toHaveProperty('rejection');
      // 보류 = 열린 요청. 송장 발급·배치 시작·발송 사전검사가 이것을 본다
      expect((await w.reader.findOpen(seed.salesOrderId, tx))?.id).toBe(id);

      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '장부 불일치', refundFailure: LEDGER }, tx);
      expect((await rowOf(tx, id)).metadata).toEqual(first.metadata);

      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '환불 불가', refundFailure: REFUSED }, tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ request: { refundFailure: { ...REFUSED, message: '환불 불가' } } });
    });
  });

  it('36번 정체 — 분류된 거절이면 edited 와 사유를 함께, 사유 없는 정체 사실은 저장된 사유를 지우지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.markStalled({ requestId: id, message: 'PG down' }, tx);
      await w.manager.markStalled({ requestId: id, message: '장부 불일치', refundFailure: LEDGER }, tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('requested');
      expect(row.metadata).toMatchObject({ request: { stage: 'edited', refundFailure: { ...LEDGER, message: '장부 불일치' } } });

      await w.manager.markStalled({ requestId: id, message: 'PG down' }, tx);
      expect((await rowOf(tx, id)).metadata).toEqual(row.metadata);
    });
  });

  it('36번 다시 보내기 — 사유를 지우고, 같은 거절이 다시 오면 다시 붙는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '환불 불가', refundFailure: REFUSED }, tx);
      const view = await w.manager.resend(seed.salesOrderId, tx);
      expect(view.refundFailure).toBeNull();
      expect((await rowOf(tx, id)).metadata).not.toMatchObject({ request: { refundFailure: expect.anything() } });

      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: '환불 불가', refundFailure: REFUSED }, tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ request: { refundFailure: REFUSED } });
    });
  });

  it('36번 — 이미 닫힌 요청엔 환불 거절도 아무것도 안 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.withdraw(seed.salesOrderId, OPERATOR.actorId, tx);
      const closed = await rowOf(tx, id);
      await w.manager.reject({ requestId: id, reasonCode: 'REFUND_FAILED', message: 'x', refundFailure: LEDGER }, tx);
      expect(await rowOf(tx, id)).toEqual(closed);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- channel-cancel-request.facts`
Expected: 새 4건 FAIL(첫 건은 `status` 가 `rejected`), 기존 건 PASS.

- [ ] **Step 3: 구현**

`channel-cancel-request.manager.ts` import 에 `ChannelOrderCancelRefundFailure` 를 더한다:

```ts
import {
  CHANNEL_ORDERS_COMMAND_STREAM,
  CancelChannelOrderPayload,
  ChannelOrderCancelRefundFailure,
  channelOrderPartitionKey,
} from '@packages/event-contracts/streams';
```

파일 하단(클래스 밖)에 순수 함수를 더한다:

```ts
/** 열린 요청에 환불 거절 사유를 붙인다 — 상태는 그대로(보류 유지) */
function withRefundFailure(
  meta: CancelRequestMetadata,
  message: string,
  refundFailure: ChannelOrderCancelRefundFailure,
): CancelRequestMetadata {
  return {
    ...meta,
    request: { ...meta.request, refundFailure: { ...refundFailure, message, at: new Date().toISOString() } },
  };
}
```

`reject` 를 바꾼다(시그니처에 `refundFailure?` 를 더하고 맨 앞에 분기):

```ts
  async reject(
    fact: {
      requestId: string;
      reasonCode: string;
      message: string;
      unresolvedRefundAmount?: number;
      refundFailure?: ChannelOrderCancelRefundFailure;
    },
    tx?: DbTx,
  ): Promise<void> {
    // REFUND_FAILED 는 «취소 의사는 유효한데 자동으로 끝낼 수 없다»다. 닫으면 보류가 풀려 고객이 취소한 주문이
    // 출고로 돌아가고 보드에서도 사라진다 — 열어 둔 채 사유만 적는다(#1016 36번 스펙 §1.2·§6.1)
    if (fact.reasonCode === 'REFUND_FAILED' && fact.refundFailure) {
      return this.markRefundFailed(fact.requestId, fact.message, fact.refundFailure, tx);
    }
    await this.db.run(async (trx) => {
      // … 기존 본문 그대로 …
    }, tx);
  }

  private async markRefundFailed(
    requestId: string,
    message: string,
    refundFailure: ChannelOrderCancelRefundFailure,
    tx?: DbTx,
  ): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(requestId, trx, { lock: true });
      if (!row || row.status !== 'requested') {
        this.logger.log(`[CancelRequest] refund failure ignored: ${requestId} is ${row?.status ?? 'unknown'}`);
        return;
      }
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.refundFailure?.walletCode === refundFailure.walletCode) return;
      await this.write(row.id, 'requested', withRefundFailure(meta, message, refundFailure), trx);
    }, tx);
  }
```

`markStalled` 를 바꾼다:

```ts
  /** 진행 사실 — 요청을 연 채 «수정됨 · 환불 미완»과, 분류된 거절이면 그 사유를 적는다(스펙 §7.2, 36번 §6.1). */
  async markStalled(
    fact: { requestId: string; message?: string; refundFailure?: ChannelOrderCancelRefundFailure },
    tx?: DbTx,
  ): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(fact.requestId, trx, { lock: true });
      if (!row || row.status !== 'requested') return;
      const meta = readCancelRequestMetadata(row.metadata);
      const failure = fact.refundFailure;
      // 사유 없는 사실(일시 실패)은 저장된 사유를 지우지 않는다 — 한 번의 일시 실패가 영구 거절이 풀렸다는 증거는 아니다
      const sameFailure = !failure || meta.request.refundFailure?.walletCode === failure.walletCode;
      if (meta.request.stage === 'edited' && sameFailure) return;
      const staged: CancelRequestMetadata = { ...meta, request: { ...meta.request, stage: 'edited' } };
      await this.write(
        row.id,
        'requested',
        failure ? withRefundFailure(staged, fact.message ?? '', failure) : staged,
        trx,
      );
    }, tx);
  }
```

`resend` 의 본문을 바꾼다(명령 재발행은 그대로, 쓰는 메타데이터에서 사유를 지운다):

```ts
      const meta = readCancelRequestMetadata(row.metadata);
      await this.enqueue(meta.request.command, `cancel-request:${row.id}:resend:${Date.now()}`, trx);
      // 거절 사유는 이번 시도의 결과로 다시 받는다 — 남겨 두면 새 시도 중에도 보드가 «환불 불가»로 보인다.
      // undefined 키는 jsonb 직렬화에서 빠진다
      const next: CancelRequestMetadata = { ...meta, request: { ...meta.request, refundFailure: undefined } };
      // updated_at 을 밀어 정체 보드가 다시 판정하게 한다 — 단계 진입 시각(stage_entered_at)은 그대로라 체류 시간이 이어진다.
      await this.write(row.id, 'requested', next, trx);
      return toCancelRequestView({ ...row, metadata: next });
```

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- channel-cancel-request`
Expected: PASS — 새 4건 + 기존 «거절 — rejected + 사유»(Review Focus 5) 포함 전부.

Run: `npx jest apps/core/src/modules/sales-order` 와 `npm run type-check`
Expected: PASS · 에러 0

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.facts.integration.spec.ts
git commit -m "feat(core): #1016 36번 — 환불 거절은 요청을 닫지 않고 사유만 적는다

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 4: 정체 보드 — 새 세부 상태 둘

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts:157-163` (creq CTE)
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts:54`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts`
- (가드) `order-progress.thresholds.spec.ts` 의 «세부 상태는 판정 SQL 이 실제로 낼 수 있는 값이다»가 두 파일의 어긋남을 잡는다 — 고치지 않는다

**Interfaces:**
- Consumes: `metadata.request.refundFailure.kind` (Task 2 의 저장 모양)
- Produces: 세부 상태 `cancel_refund_refused`, `cancel_refund_mismatch` (stage `cancel_request`)

- [ ] **Step 1: 실패하는 테스트**

`order-progress.judge.integration.spec.ts` 의 `'수정됨 · 환불 미완 → …'` 테스트 아래에 더한다:

```ts
  it('환불 거절(#1016 36번) → cancel_refund_refused / cancel_refund_mismatch — 수정됨보다 먼저 본다', async () => {
    const stateOf = (request: Record<string, unknown>) =>
      one(async (tx) => {
        const o = await f.seedOrder(tx);
        await tx.insert(wmsTables.salesOrderAmendments).values({
          salesOrderId: o.salesOrderId,
          amendmentKind: 'commercial',
          reasonCode: 'CHANNEL_CANCEL_REQUEST',
          deltas: [],
          metadata: { request: { kind: 'cancel', ...request } },
          origin: 'operator',
          status: 'requested',
        });
        return o.salesOrderId;
      });
    expect(await stateOf({ refundFailure: { kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE' } })).toMatchObject({
      stage: 'cancel_request',
      state: 'cancel_refund_refused',
    });
    expect(
      await stateOf({ stage: 'edited', refundFailure: { kind: 'ledger_mismatch', walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL' } }),
    ).toMatchObject({ stage: 'cancel_request', state: 'cancel_refund_mismatch' });
  });
```

`order-progress.thresholds.spec.ts` 의 `'12번 규칙의 칸(fo/awaiting_matching)이 어휘에 있다'` 아래에 더한다:

```ts
  it('36번 환불 거절 칸이 취소 요청 어휘에 있다', () => {
    expect(ORDER_PROGRESS_STATES.cancel_request).toEqual(
      expect.arrayContaining(['cancel_refund_refused', 'cancel_refund_mismatch']),
    );
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`
Expected: FAIL — 새 테스트.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- order-progress.judge.integration`
Expected: FAIL — 상태가 `cancel_requested`/`cancel_edited`.

- [ ] **Step 3: 구현**

`order-progress.judge-sql.ts` creq CTE 의 `CASE` 줄을 바꾼다:

```sql
    -- 열린 채널 취소 요청(#1016 35번) — 출고 보류 중이라 다른 단계는 멈춰 있다. 한 주문에 하나(부분 유니크).
    -- 환불 거절(36번)을 수정됨보다 먼저 본다 — 부분취소의 거절은 늘 수정 뒤라, 운영자에게 필요한 건 거절 사유다
    creq AS (
      SELECT a.sales_order_id, a.created_at,
             CASE a.metadata->'request'->'refundFailure'->>'kind'
               WHEN 'refused' THEN 'cancel_refund_refused'
               WHEN 'ledger_mismatch' THEN 'cancel_refund_mismatch'
               ELSE CASE WHEN a.metadata->'request'->>'stage' = 'edited' THEN 'cancel_edited' ELSE 'cancel_requested' END
             END AS state
        FROM sales_order_amendments a
        JOIN so ON so.id = a.sales_order_id
       WHERE a.status = 'requested'
    ),
```

`order-progress.thresholds.ts:54`:

```ts
  cancel_request: ['cancel_requested', 'cancel_edited', 'cancel_refund_refused', 'cancel_refund_mismatch'],
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress`
Expected: PASS (가드 «판정 SQL 이 실제로 낼 수 있는 값» 포함)

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- order-progress`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts
git commit -m "feat(core): #1016 36번 — 정체 보드에 «환불 불가»·«장부 불일치» 상태

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 5: admin-web — 상태 라벨과 주문 상세 문구

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts:160-163` (`STATE_LABELS`)
- Modify: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts`
- Test: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.spec.ts`, `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.spec.ts`

**Interfaces:**
- Consumes: core 뷰의 `refundFailure: { kind; walletCode; message; at } | null` (Task 2), 변경 기록 행의 `metadata.request.refundFailure`
- Produces: admin-web `CancelRequestView.refundFailure`, `refundFailureLabel(f: CancelRequestRefundFailure): string`

- [ ] **Step 1: 실패하는 테스트**

`order-progress.shape.spec.ts` 의 `expect(stateLabel('cancel_edited'))…` 아래에:

```ts
    expect(stateLabel('cancel_refund_refused')).toBe('취소 · 환불 불가');
    expect(stateLabel('cancel_refund_mismatch')).toBe('취소 · 장부 불일치');
```

`cancel-request.shape.spec.ts`: import 에 `refundFailureLabel` 을 더하고, `view` 헬퍼 기본값에 `refundFailure: null,` 을 `rejection: null,` 위에 더한 뒤 describe 끝에 더한다:

```ts
  describe('36번 환불 거절', () => {
    const refused = { kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE', message: 'wallet 이 자동 환불 불가', at: 't' };
    const mismatch = { kind: 'ledger_mismatch', walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL', message: 'wallet 에 장부에 없는 환불', at: 't' };

    it('뷰 읽기 — 갈래를 모르면 null', () => {
      expect(toCancelRequestView(view({ refundFailure: refused }))?.refundFailure).toEqual(refused);
      expect(toCancelRequestView(view({ refundFailure: { ...refused, kind: 'other' } }))?.refundFailure).toBeNull();
      expect(toCancelRequestView(view({ refundFailure: undefined }))?.refundFailure).toBeNull();
    });

    it('변경 기록 행에서도 읽는다', () => {
      const row = {
        id: 'r1',
        reasonCode: 'CHANNEL_CANCEL_REQUEST',
        status: 'requested',
        occurredAt: '2026-10-10T00:00:00.000Z',
        metadata: { request: { scope: 'full', refundFailure: mismatch } },
      };
      expect(cancelRequestFromAmendment(row as never)?.refundFailure).toEqual(mismatch);
    });

    it('갈래별 문구 — 장부 불일치는 다시 환불하지 말라고 한다', () => {
      expect(refundFailureLabel(refused as never)).toBe('환불 불가 · 다른 수단으로 환불 필요 · wallet 이 자동 환불 불가');
      expect(refundFailureLabel(mismatch as never)).toBe(
        '장부 불일치 · 다시 환불하지 마세요 · wallet 환불 내역 대조 · wallet 에 장부에 없는 환불',
      );
    });

    it('요청 중 표시 — 사유가 수정됨보다 먼저', () => {
      const req = toCancelRequestView(view({ stage: 'edited', refundFailure: mismatch }));
      expect(cancelActionOf({ channel: 'medusa', orderStatus: 'confirmed', cancelRequest: req })).toEqual({
        kind: 'requested',
        label: refundFailureLabel(mismatch as never),
      });
      expect(cancelRequestLine(req!)).toBe(`부분취소 요청 · ${refundFailureLabel(mismatch as never)}`);
    });
  });
```

(`as never` 는 기존 스펙의 목 주입 관례 — 리터럴의 `kind: string` 을 유니온으로 좁히지 않기 위해서다.)

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- order-progress.shape cancel-request.shape`
Expected: FAIL — 라벨 없음, `refundFailureLabel` 없음.

- [ ] **Step 3: 구현**

`order-progress.shape.ts` `STATE_LABELS` 의 `cancel_edited` 아래에:

```ts
  cancel_refund_refused: '취소 · 환불 불가',
  cancel_refund_mismatch: '취소 · 장부 불일치',
```

`cancel-request.shape.ts`:

`CancelRequestView` 위에 더한다:

```ts
/** 열린 요청에 붙은 wallet 환불 거절 사유(#1016 36번). 요청은 열린 채 출고 보류가 유지된다 */
export interface CancelRequestRefundFailure {
  kind: 'refused' | 'ledger_mismatch';
  walletCode: string;
  message: string;
  at: string;
}
```

`CancelRequestView` 의 `rejection` 위에 `refundFailure: CancelRequestRefundFailure | null;` 를 더한다.

`REJECTION_LABELS` 아래에 더한다:

```ts
const REFUND_FAILURE_LABELS: Record<CancelRequestRefundFailure['kind'], string> = {
  refused: '환불 불가 · 다른 수단으로 환불 필요',
  // 이미 돈이 나갔을 수 있다 — «환불 불가»로 읽고 수동으로 또 환불하면 이중 환불이다
  ledger_mismatch: '장부 불일치 · 다시 환불하지 마세요 · wallet 환불 내역 대조',
};

export function refundFailureLabel(failure: CancelRequestRefundFailure): string {
  return `${REFUND_FAILURE_LABELS[failure.kind]} · ${failure.message}`;
}

function refundFailureOf(value: unknown): CancelRequestRefundFailure | null {
  if (!isRecord(value) || typeof value.walletCode !== 'string') return null;
  const { kind } = value;
  if (kind !== 'refused' && kind !== 'ledger_mismatch') return null;
  return {
    kind,
    walletCode: value.walletCode,
    message: typeof value.message === 'string' ? value.message : '',
    at: typeof value.at === 'string' ? value.at : '',
  };
}
```

`toCancelRequestView` 반환의 `rejection` 위에 `refundFailure: refundFailureOf(value.refundFailure),` 를 더한다.
`cancelRequestFromAmendment` 의 인자 객체 `rejection` 위에 `refundFailure: request.refundFailure,` 를 더한다.

`cancelActionOf` 의 requested 분기를 바꾼다:

```ts
  if (request?.status === 'requested') {
    const label = request.refundFailure
      ? refundFailureLabel(request.refundFailure)
      : request.stage === 'edited'
        ? '수정됨 · 환불 미완'
        : '취소 요청됨';
    return { kind: 'requested', label };
  }
```

`cancelRequestLine` 의 `case 'requested':` 를 바꾼다:

```ts
    case 'requested': {
      const state = view.refundFailure
        ? refundFailureLabel(view.refundFailure)
        : view.stage === 'edited'
          ? '수정됨 · 환불 미완'
          : '처리 중';
      return `${name} 요청 · ${state}`;
    }
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:admin-web -- order-progress.shape cancel-request.shape`
Expected: PASS

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0. `CancelRequestView` 를 손으로 만드는 곳이 있으면 `refundFailure: null` 을 더한다.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts apps/admin-web/src/lib/api/domains/orders/order-progress.shape.spec.ts apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.spec.ts
git commit -m "feat(admin-web): #1016 36번 — 환불 거절 갈래 문구(보드·주문 상세)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 6: PR 1 게이트와 PR

- [ ] **Step 1: 게이트**

```bash
npm run type-check                       # 0
npx jest --silent                        # 실패 0
(cd apps/admin-web && npx tsc --noEmit)  # 0
npm run test:admin-web                   # 실패 0
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "channel-cancel-request|order-progress"
```

- [ ] **Step 2: push + PR**

```bash
git push -u origin feat/1016-36-refund-refusal-receive
gh pr create --base develop --title "feat: #1016 36번 — 환불 거절 사유 받기 (1/3 계약·core·admin-web)" --body "$(cat <<'EOF'
## 무엇
채널 주문 취소가 wallet 영구 환불 거절로 막히면 요청을 닫지 않고(출고 보류 유지) «환불 불가 / 장부 불일치» 사유를 적고 보인다.
이 PR 만으로는 휴면 — 아무도 `REFUND_FAILED` 를 내지 않는다. 2/3(channel-adapter) → 3/3(Medusa) 순으로 머지.

- 스펙 `docs/superpowers/specs/2026-10-10-channel-cancel-refund-refusal-design.md`
- 계획 `docs/superpowers/plans/2026-10-10-channel-cancel-refund-refusal.md`
- 마이그레이션 없음

https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
EOF
)"
```

---

# PR 2 — channel-adapter (브랜치 `feat/1016-36-refund-refusal-adapter`, PR 1 위에)

```bash
git checkout -b feat/1016-36-refund-refusal-adapter
```

### Task 7: 표지 파서

**Files:**
- Create: `apps/channel-adapter/src/adapters/medusa/refund-failure.ts`
- Test: `apps/channel-adapter/src/adapters/medusa/refund-failure.spec.ts`

**Interfaces:**
- Consumes: `REFUND_FAILURE_KINDS`, `ChannelOrderCancelRefundFailure` (Task 1)
- Produces: `parseRefundFailureCode(code: unknown): ChannelOrderCancelRefundFailure | null`, `readRefundFailure(value: unknown): ChannelOrderCancelRefundFailure | null`

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/channel-adapter/src/adapters/medusa/refund-failure.spec.ts
import { parseRefundFailureCode, readRefundFailure } from './refund-failure';

describe('Medusa 환불 거절 표지 (#1016 36번)', () => {
  it('전체취소 400 의 code — 갈래와 wallet 코드를 읽는다', () => {
    expect(parseRefundFailureCode('wallet_refund_ledger_mismatch:REFUND_AMOUNT_EXCEEDS_TOTAL')).toEqual({
      kind: 'ledger_mismatch',
      walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL',
    });
    expect(parseRefundFailureCode('wallet_refund_refused:REFUND_NOT_AUTOMATABLE')).toEqual({
      kind: 'refused',
      walletCode: 'REFUND_NOT_AUTOMATABLE',
    });
  });

  it.each([undefined, null, 42, '', 'partial_cancel_rejected', 'wallet_refund_other:X', 'wallet_refund_refused:', 'wallet_refund_refused'])(
    '표지가 아니면 null — %p',
    (code) => {
      expect(parseRefundFailureCode(code)).toBeNull();
    },
  );

  it('부분취소 502 본문의 refundFailure 객체를 읽는다', () => {
    expect(readRefundFailure({ kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE' })).toEqual({
      kind: 'refused',
      walletCode: 'REFUND_NOT_AUTOMATABLE',
    });
    expect(readRefundFailure({ kind: 'other', walletCode: 'X' })).toBeNull();
    expect(readRefundFailure({ kind: 'refused', walletCode: '' })).toBeNull();
    expect(readRefundFailure(undefined)).toBeNull();
    expect(readRefundFailure('wallet_refund_refused:X')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/refund-failure.spec.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// apps/channel-adapter/src/adapters/medusa/refund-failure.ts
import {
  REFUND_FAILURE_KINDS,
  type ChannelOrderCancelRefundFailure,
  type RefundFailureKind,
} from '@packages/event-contracts/streams';

/**
 * Medusa almond-payment 가 wallet 의 영구 환불 거절에 다는 표지(#1016 36번 스펙 §4.3).
 * 짝: apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts — 공유 패키지로 묶지 않는다
 * (`@packages` 별칭이 medusa 런타임에서 풀리지 않는다). 양쪽 스펙이 같은 예시 값을 써서 어긋남을 잡는다.
 */
const REFUND_FAILURE_CODE = /^wallet_refund_([a-z_]+):(.+)$/;

function isKind(value: unknown): value is RefundFailureKind {
  return REFUND_FAILURE_KINDS.some((kind) => kind === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 전체취소 400 응답의 `code`. 갈래를 모르는 표지는 null — 호출자가 일반 거절로 닫는다(재시도 루프를 만들지 않는다) */
export function parseRefundFailureCode(code: unknown): ChannelOrderCancelRefundFailure | null {
  if (typeof code !== 'string') return null;
  const match = REFUND_FAILURE_CODE.exec(code);
  if (!match) return null;
  const [, kind, walletCode] = match;
  return isKind(kind) ? { kind, walletCode } : null;
}

/** 부분취소 502 `refund_pending` 본문의 `refundFailure` 객체 */
export function readRefundFailure(value: unknown): ChannelOrderCancelRefundFailure | null {
  if (!isRecord(value)) return null;
  const { kind, walletCode } = value;
  return isKind(kind) && typeof walletCode === 'string' && walletCode.length > 0 ? { kind, walletCode } : null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/refund-failure.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/channel-adapter/src/adapters/medusa/refund-failure.ts apps/channel-adapter/src/adapters/medusa/refund-failure.spec.ts
git commit -m "feat(channel-adapter): #1016 36번 — Medusa 환불 거절 표지 파서

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 8: MedusaClient — 취소 응답에서 표지를 읽는다

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts:240-255` (outcome 타입), `:1939-1955` (`cancelOrder`), `:2624` (`partialCancelOrder` 의 502)
- Test: `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts` (`MedusaClient 취소 (#1016 35번 PR-B)` describe)

**Interfaces:**
- Consumes: `parseRefundFailureCode`, `readRefundFailure` (Task 7)
- Produces: `MedusaCancelOutcome` 에 `{ kind: 'refund_refused'; message: string; refundFailure: ChannelOrderCancelRefundFailure }`, `MedusaPartialCancelOutcome` 의 `refund_pending` 에 `refundFailure?: ChannelOrderCancelRefundFailure`

- [ ] **Step 1: 실패하는 테스트**

`describe('cancelOrder', …)` 안 끝에 더한다:

```ts
    it('wallet 환불 거절 표지가 붙은 400 은 refund_refused — 이미 취소됨·not_cancelable 보다 먼저 본다(#1016 36번)', async () => {
      const message = 'wallet 에 Medusa 장부에 없는 환불이 있습니다 (wallet REFUND_AMOUNT_EXCEEDS_TOTAL: 3000)';
      global.fetch = respond(400, { type: 'not_allowed', code: 'wallet_refund_ledger_mismatch:REFUND_AMOUNT_EXCEEDS_TOTAL', message });
      await expect(makeClient().cancelOrder('order_1')).resolves.toEqual({
        kind: 'refund_refused',
        message,
        refundFailure: { kind: 'ledger_mismatch', walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL' },
      });
    });

    it('갈래를 모르는 표지는 일반 거절로 닫는다 — 재시도 루프를 만들지 않는다', async () => {
      global.fetch = respond(400, { type: 'not_allowed', code: 'wallet_refund_other:X', message: 'm' });
      await expect(makeClient().cancelOrder('order_1')).resolves.toEqual({ kind: 'not_cancelable', message: 'm' });
    });
```

`describe('partialCancelOrder', …)` 의 `'502 refund_pending 은 환불 미완 결과다'` 아래에 더한다:

```ts
    it('502 refund_pending 에 환불 거절 갈래가 실려 오면 함께 돌려준다(#1016 36번)', async () => {
      global.fetch = respond(502, {
        type: 'refund_pending',
        stage: 'edited',
        requestId: 'req-1',
        message: '환불 불가',
        refundFailure: { kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE' },
      });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({
        kind: 'refund_pending',
        message: '환불 불가',
        refundFailure: { kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE' },
      });
    });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts -t "취소"`
Expected: FAIL — 새 3건.

- [ ] **Step 3: 구현**

import 를 더한다(파일 상단 import 묶음):

```ts
import type { ChannelOrderCancelRefundFailure } from '@packages/event-contracts/streams';
import { parseRefundFailureCode, readRefundFailure } from './refund-failure';
```

outcome 타입:

```ts
/** Medusa 전체취소 결과. 정해진 결과만 값이고, 일시 실패(5xx·네트워크)는 던진다(#1016 35번 PR-B). */
export type MedusaCancelOutcome =
  | { kind: 'cancelled' }
  | { kind: 'already_cancelled' }
  | { kind: 'not_found'; message: string }
  | { kind: 'not_cancelable'; message: string }
  /** wallet 이 환불을 영구히 거절해 취소가 롤백됐다(#1016 36번) */
  | { kind: 'refund_refused'; message: string; refundFailure: ChannelOrderCancelRefundFailure };
```

`MedusaPartialCancelOutcome` 의 마지막 줄:

```ts
  | { kind: 'refund_pending'; message: string; refundFailure?: ChannelOrderCancelRefundFailure };
```

`cancelOrder` 의 400 분기:

```ts
    if (status === 400) {
      // 표지를 먼저 본다 — 같은 not_allowed 400 이라 아래 not_cancelable 로 떨어지면 «채널이 거절»로 보이고 사유 갈래를 잃는다
      const refundFailure = parseRefundFailureCode(body.code);
      if (refundFailure) return { kind: 'refund_refused', message, refundFailure };
      if (ALREADY_CANCELLED_MESSAGE.test(message)) return { kind: 'already_cancelled' };
      return { kind: 'not_cancelable', message };
    }
```

`partialCancelOrder` 의 502 줄:

```ts
    // 본문으로 가린다 — ALB 가 Medusa 다운 때 내는 502 에는 이 본문이 없다
    if (status === 502 && body.type === 'refund_pending') {
      const refundFailure = readRefundFailure(body.refundFailure);
      return refundFailure ? { kind: 'refund_pending', message, refundFailure } : { kind: 'refund_pending', message };
    }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts`
Expected: PASS. `npm run type-check` 는 Task 9 의 매니저 switch 가 새 kind 를 처리할 때까지 에러가 날 수 있다 — Task 9 끝에서 확인한다.

- [ ] **Step 5: Commit**

```bash
git add apps/channel-adapter/src/adapters/medusa/medusa.client.ts apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts
git commit -m "feat(channel-adapter): #1016 36번 — Medusa 취소 응답의 환불 거절 표지

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 9: 매니저·저장소 — `REFUND_FAILED` 와 정체 사유를 낸다

**Files:**
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts`
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts:37-39`
- Test: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`, `channel-order-cancel.repository.spec.ts`

**Interfaces:**
- Consumes: `MedusaCancelOutcome.refund_refused`, `MedusaPartialCancelOutcome.refund_pending.refundFailure` (Task 8)
- Produces: `ChannelOrderCancelRejected { reasonCode: 'REFUND_FAILED', refundFailure }`, `ChannelOrderCancelStalled { refundFailure? }`, 정체 사실 멱등 키 `cancel-stalled:<requestId>:<deliveryId>[:<walletCode>]`

- [ ] **Step 1: 실패하는 테스트**

`channel-order-cancel.manager.spec.ts` — 기존 `'Medusa 500 은 던진다 — wallet «환불 불가»도 여기로 온다(REFUND_FAILED 미판별). 거절 사실을 내지 않는다'` 의 이름을 `'Medusa 500 은 던진다 — 일시 실패라 거절 사실을 내지 않는다'` 로 바꾸고, 그 아래에 더한다:

```ts
    it('wallet 환불 거절은 REFUND_FAILED + 갈래로 거절한다 — 재수집하지 않는다(#1016 36번)', async () => {
      const { manager, repository, medusa, poller } = setup();
      const refundFailure = { kind: 'ledger_mismatch' as const, walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL' };
      medusa.cancelOrder.mockResolvedValue({ kind: 'refund_refused', message: '장부 불일치', refundFailure });
      await manager.execute(full, 'd1');
      expect(repository.recordRejected).toHaveBeenCalledWith(
        { ...key, reasonCode: 'REFUND_FAILED', message: '장부 불일치', refundFailure },
        'd1',
      );
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });
```

부분취소 쪽 `'환불 미완이면 정체 사실을 «먼저» 내고 던진다 …'` 아래에 더한다:

```ts
    it('환불 미완의 원인이 분류된 거절이면 정체 사실에 갈래를 싣고, 그래도 던진다(#1016 36번)', async () => {
      const { manager, repository, medusa } = setup();
      const refundFailure = { kind: 'refused' as const, walletCode: 'REFUND_NOT_AUTOMATABLE' };
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'refund_pending', message: '환불 불가', refundFailure });
      await expect(manager.execute(partial, 'd1')).rejects.toThrow(/req-1/);
      expect(repository.recordStalled).toHaveBeenCalledWith(
        { ...key, stage: 'edited', message: '환불 불가', refundFailure },
        'd1',
      );
      expect(repository.recordRejected).not.toHaveBeenCalled();
    });
```

`channel-order-cancel.repository.spec.ts` 끝(describe 안)에 더한다:

```ts
  it('정체 사실에 환불 거절 갈래가 있으면 멱등 키에 wallet 코드를 붙인다 — 같은 전달에서 일시 실패 뒤 영구 거절을 버리지 않게(#1016 36번)', async () => {
    const { repository, enqueue } = makeRepository();
    const plain = { ...key, stage: 'edited' as const, message: 'PG down' };
    const refused = { ...plain, message: '환불 불가', refundFailure: { kind: 'refused' as const, walletCode: 'REFUND_NOT_AUTOMATABLE' } };
    await repository.recordStalled(plain, 'd1');
    await repository.recordStalled(refused, 'd1');
    expect(enqueue.mock.calls.map(([event]) => event.idempotencyKey)).toEqual([
      'cancel-stalled:req-1:d1',
      'cancel-stalled:req-1:d1:REFUND_NOT_AUTOMATABLE',
    ]);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/services/order-cancel`
Expected: FAIL — 새 3건.

- [ ] **Step 3: 구현**

`channel-order-cancel.manager.ts`:

import 를 바꾼다:

```ts
import type {
  CancelChannelOrderPayload,
  ChannelOrderCancelRefundFailure,
  ChannelOrderCancelRejectionCode,
} from '@packages/event-contracts/streams';
```

`Rejection` 타입:

```ts
type Rejection = {
  reasonCode: ChannelOrderCancelRejectionCode;
  message: string;
  unresolvedRefundAmount?: number;
  refundFailure?: ChannelOrderCancelRefundFailure;
};
```

클래스 주석의 «정해진 실패는 …» 줄 아래에 한 줄 더한다:

```ts
 * wallet 의 영구 환불 거절(Medusa 가 표지를 단 400)은 `REFUND_FAILED` 로 낸다 — core 는 요청을 닫지 않고 보류를 유지한다(#1016 36번).
```

`cancelFull` 의 switch 에 case 를 더한다:

```ts
      case 'refund_refused':
        return { reasonCode: 'REFUND_FAILED', message: outcome.message, refundFailure: outcome.refundFailure };
```

`cancelPartial` 의 `case 'refund_pending':` 의 `recordStalled` 인자를 바꾼다:

```ts
        await this.repository.recordStalled(
          {
            requestId,
            salesChannel,
            externalOrderId,
            stage: 'edited',
            message: outcome.message,
            ...(outcome.refundFailure ? { refundFailure: outcome.refundFailure } : {}),
          },
          deliveryId,
        );
```

`channel-order-cancel.repository.ts` 의 `recordStalled`:

```ts
  async recordStalled(payload: ChannelOrderCancelStalledPayload, deliveryId: string): Promise<void> {
    // 같은 전달의 재시도가 일시 실패 뒤 영구 거절을 만나면 사유가 바뀐다 — 키에 wallet 코드를 붙여야 그 사실이 버려지지 않는다.
    // 사유 없는 사실의 키는 그대로 둔다(배포 전후 아웃박스 행과 겹치지 않게)
    const suffix = payload.refundFailure ? `:${payload.refundFailure.walletCode}` : '';
    await this.enqueueFact('ChannelOrderCancelStalled', `cancel-stalled:${payload.requestId}:${deliveryId}${suffix}`, payload);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter`
Expected: PASS

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 5: Commit**

```bash
git add apps/channel-adapter/src/services/order-cancel/
git commit -m "feat(channel-adapter): #1016 36번 — 환불 거절을 REFUND_FAILED·정체 사유로 낸다

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 10: PR 2 게이트와 PR

- [ ] **Step 1: 게이트**

```bash
npm run type-check     # 0
npx jest --silent      # 실패 0
```

- [ ] **Step 2: push + PR** (base 는 PR 1 브랜치 — PR 1 머지 뒤 GitHub 이 develop 으로 바꾼다)

```bash
git push -u origin feat/1016-36-refund-refusal-adapter
gh pr create --base feat/1016-36-refund-refusal-receive --title "feat: #1016 36번 — 환불 거절 사유 받기 (2/3 channel-adapter)" --body "$(cat <<'EOF'
## 무엇
Medusa 가 wallet 영구 환불 거절에 다는 표지(`code: wallet_refund_<kind>:<walletCode>`)를 읽어 전체취소는 `ChannelOrderCancelRejected(REFUND_FAILED, refundFailure)`, 부분취소는 `ChannelOrderCancelStalled(refundFailure)` 로 낸다.
Medusa(3/3) 전에는 휴면 — 표지가 오지 않는다. 1/3 머지 뒤에 머지.

- 스펙 `docs/superpowers/specs/2026-10-10-channel-cancel-refund-refusal-design.md` §5

https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
EOF
)"
```

---

# PR 3 — Medusa (브랜치 `feat/1016-36-refund-refusal-medusa`, develop 에서)

작업 위치: `.claude/worktrees/feat-1016-36-refund-refusal-medusa`. Medusa 명령은 `apps/medusa` 에서 돈다.

### Task 11: almond-payment — wallet 거절 분류와 표지

**Files:**
- Create: `apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts`
- Create: `apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-refusal.unit.spec.ts`
- Modify: `apps/medusa/src/modules/almond-payment/service.ts:60-82` (`walletFetch`), `:253-294` (`refundPayment`)
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts`

**Interfaces:**
- Produces: `class WalletHttpError extends Error { status: number; walletCode?: string; walletMessage: string }`, `classifyWalletRefundRefusal(code: string | undefined): WalletRefundRefusalKind | null`, `walletRefundRefusalError(kind, walletCode, walletMessage): MedusaError`, `readRefundFailureCode(error: unknown): { kind: WalletRefundRefusalKind; walletCode: string } | null`

- [ ] **Step 1: 실패하는 테스트 — 분류·표지**

```ts
// apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-refusal.unit.spec.ts
import { MedusaError } from '@medusajs/framework/utils';
import {
  WalletHttpError,
  classifyWalletRefundRefusal,
  readRefundFailureCode,
  walletRefundRefusalError,
} from '../wallet-refund-refusal';

describe('wallet 환불 거절 분류 (#1016 36번 스펙 §4.1)', () => {
  it.each([
    ['REFUND_NOT_AUTOMATABLE', 'refused'],
    ['MEMBERSHIP_REFUND_NOT_ALLOWED', 'refused'],
    ['REFUND_AMOUNT_EXCEEDS_TOTAL', 'ledger_mismatch'],
    ['REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'ledger_mismatch'],
    ['REFUND_AMOUNT_EXCEEDS_CHARGE', 'ledger_mismatch'],
    ['CHARGE_NOT_REFUNDABLE', 'ledger_mismatch'],
    ['REFUNDABLE_CHARGE_NOT_FOUND', 'ledger_mismatch'],
  ])('%s → %s', (code, kind) => {
    expect(classifyWalletRefundRefusal(code)).toBe(kind);
  });

  it.each([undefined, '', 'PG_UNAVAILABLE', 'VALIDATION_ERROR', 'INTENT_NOT_FOUND', 'NOT_FOUND', 'toString'])(
    '그 밖(%p)은 분류 없음 — 일시 실패로 재시도한다',
    (code) => {
      expect(classifyWalletRefundRefusal(code)).toBeNull();
    },
  );

  it('표지 오류 — NOT_ALLOWED, code 에 갈래·wallet 코드, 문장에 wallet 원문', () => {
    const err = walletRefundRefusalError('ledger_mismatch', 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'Refund amount (3000) exceeds remaining (0)');
    expect(err).toBeInstanceOf(MedusaError);
    expect(err.type).toBe(MedusaError.Types.NOT_ALLOWED);
    expect(err.code).toBe('wallet_refund_ledger_mismatch:REFUND_AMOUNT_EXCEEDS_TOTAL');
    expect(err.message).toContain('다시 환불하지 말고');
    expect(err.message).toContain('REFUND_AMOUNT_EXCEEDS_TOTAL: Refund amount (3000) exceeds remaining (0)');
    expect(walletRefundRefusalError('refused', 'REFUND_NOT_AUTOMATABLE', 'm').message).toContain('다른 수단으로 환불');
  });

  it('직렬화된 오류(평범한 객체)의 code 에서 표지를 다시 읽는다 — 부분취소가 쓴다', () => {
    expect(readRefundFailureCode({ message: 'x', code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE' })).toEqual({
      kind: 'refused',
      walletCode: 'REFUND_NOT_AUTOMATABLE',
    });
    expect(readRefundFailureCode(walletRefundRefusalError('ledger_mismatch', 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'm'))).toEqual({
      kind: 'ledger_mismatch',
      walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL',
    });
    expect(readRefundFailureCode({ code: 'wallet_refund_other:X' })).toBeNull();
    expect(readRefundFailureCode(new Error('PG down'))).toBeNull();
    expect(readRefundFailureCode(undefined)).toBeNull();
  });

  it('WalletHttpError 의 message 는 «코드: 문장» — 기존 includes 분기(INTENT_NOT_CANCELABLE 등)가 그대로 돈다', () => {
    expect(new WalletHttpError(400, 'INTENT_NOT_CANCELABLE', 'cannot be canceled').message).toBe('INTENT_NOT_CANCELABLE: cannot be canceled');
    expect(new WalletHttpError(500, undefined, 'Wallet API error 500: /x').message).toBe('Wallet API error 500: /x');
  });
});
```

`refund-payment.unit.spec.ts` — import 에 `WalletHttpError` 를 더하고(`import { WalletHttpError } from '../wallet-refund-refusal';`), describe 끝에 더한다:

```ts
  describe('wallet 의 영구 거절 (#1016 36번)', () => {
    const refund = (svc: AlmondPaymentProviderService) =>
      svc.refundPayment({ data: { intentId: 'i1' }, amount: 3000, context: { idempotency_key: 'ref_r1' } } as any);

    it.each([
      ['REFUND_NOT_AUTOMATABLE', 'refused'],
      ['REFUND_AMOUNT_EXCEEDS_TOTAL', 'ledger_mismatch'],
    ])('%s 는 NOT_ALLOWED + 표지 code 로 던진다', async (walletCode, kind) => {
      const svc = makeService();
      jest.spyOn(svc as any, 'walletFetch').mockRejectedValue(new WalletHttpError(400, walletCode, 'wallet said no'));
      await expect(refund(svc)).rejects.toMatchObject({ type: 'not_allowed', code: `wallet_refund_${kind}:${walletCode}` });
    });

    it('분류 없는 wallet 오류와 네트워크 오류는 그대로 던진다 — 재시도 대상', async () => {
      const svc = makeService();
      const transient = new WalletHttpError(502, 'PG_UNAVAILABLE', 'down');
      jest.spyOn(svc as any, 'walletFetch').mockRejectedValueOnce(transient).mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(refund(svc)).rejects.toBe(transient);
      await expect(refund(svc)).rejects.toBeInstanceOf(TypeError);
    });
  });

  it('walletFetch 는 wallet 오류 본문을 WalletHttpError 로 던진다', async () => {
    const svc = makeService();
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'REFUND_NOT_AUTOMATABLE', message: 'manual' }),
    }) as any;
    try {
      await expect((svc as any).walletFetch('/v1/payment-intents/i1/refund', { method: 'POST' })).rejects.toMatchObject({
        name: 'WalletHttpError',
        status: 400,
        walletCode: 'REFUND_NOT_AUTOMATABLE',
        walletMessage: 'manual',
        message: 'REFUND_NOT_AUTOMATABLE: manual',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && npm run test:unit -- src/modules/almond-payment`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현 — 분류 파일**

```ts
// apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts
import { MedusaError } from '@medusajs/framework/utils';

/**
 * wallet 의 영구 환불 거절을 갈래로 나눈다(#1016 36번 스펙 §4.1). 기준은 «wallet 이 돈을 어떻게 보는가»:
 * - refused: 돈은 있는데 자동으로 못 돌려준다 → 다른 수단으로 환불
 * - ledger_mismatch: wallet 이 Medusa 생각보다 돌려줄 돈이 적다 → 이미 나갔을 수 있다(응답 유실·일부 leg 만 나감·
 *   투영 안 된 외부 환불). «환불 불가»로 보이면 운영자가 또 환불한다
 * 그 밖은 분류하지 않는다 — 400 으로 바꾸면 channel-adapter 가 재시도 없이 닫는다.
 */
export type WalletRefundRefusalKind = 'refused' | 'ledger_mismatch';

const KIND_BY_WALLET_CODE = new Map<string, WalletRefundRefusalKind>([
  ['REFUND_NOT_AUTOMATABLE', 'refused'],
  ['MEMBERSHIP_REFUND_NOT_ALLOWED', 'refused'],
  ['REFUND_AMOUNT_EXCEEDS_TOTAL', 'ledger_mismatch'],
  ['REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'ledger_mismatch'],
  ['REFUND_AMOUNT_EXCEEDS_CHARGE', 'ledger_mismatch'],
  // intent 환불 경로에선 SUCCEEDED 결제분을 고른 뒤 누가 동시에 환불했을 때만 난다
  ['CHARGE_NOT_REFUNDABLE', 'ledger_mismatch'],
  // 404 지만 본문 코드로 가린다 — 환불할 결제분이 없는데 성공 환불 합도 모자라다
  ['REFUNDABLE_CHARGE_NOT_FOUND', 'ledger_mismatch'],
]);

export function classifyWalletRefundRefusal(walletCode: string | undefined): WalletRefundRefusalKind | null {
  return walletCode === undefined ? null : (KIND_BY_WALLET_CODE.get(walletCode) ?? null);
}

/** wallet 이 2xx 가 아닌 응답을 줬다. 속성 이름을 code 로 두지 않는다 — formatException 이 err.code 를 Postgres 코드로 읽는다 */
export class WalletHttpError extends Error {
  constructor(
    readonly status: number,
    readonly walletCode: string | undefined,
    readonly walletMessage: string,
  ) {
    // 에러 코드를 메시지 앞에 붙인다 — 호출부가 코드로 분기할 수 있어야 한다(INTENT_NOT_CANCELABLE 등)
    super(walletCode ? `${walletCode}: ${walletMessage}` : walletMessage);
    this.name = 'WalletHttpError';
  }
}

const SENTENCE: Record<WalletRefundRefusalKind, string> = {
  refused: 'wallet 이 이 결제를 자동으로 환불할 수 없습니다 — 다른 수단으로 환불해야 합니다',
  ledger_mismatch:
    'wallet 에 Medusa 장부에 없는 환불이 있습니다 — 이미 환불됐을 수 있으니 다시 환불하지 말고 wallet 환불 내역을 대조하세요',
};

/**
 * Medusa 에러 핸들러는 NOT_ALLOWED 를 400 으로, code 를 그대로 응답에 싣는다(그 밖의 오류는 500 unknown_error 로 가린다).
 * 표지 형식은 channel-adapter 가 읽는다 — 짝: apps/channel-adapter/src/adapters/medusa/refund-failure.ts
 */
export function walletRefundRefusalError(
  kind: WalletRefundRefusalKind,
  walletCode: string,
  walletMessage: string,
): MedusaError {
  return new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    `${SENTENCE[kind]} (wallet ${walletCode}: ${walletMessage})`,
    `wallet_refund_${kind}:${walletCode}`,
  );
}

const REFUND_FAILURE_CODE = /^wallet_refund_(refused|ledger_mismatch):(.+)$/;

/** 워크플로를 지나 직렬화된 오류(클래스가 아니라 평범한 객체)에서 표지를 다시 읽는다 — 부분취소 502 본문용 */
export function readRefundFailureCode(error: unknown): { kind: WalletRefundRefusalKind; walletCode: string } | null {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return null;
  const match = REFUND_FAILURE_CODE.exec(error.code);
  if (!match) return null;
  return { kind: match[1] === 'refused' ? 'refused' : 'ledger_mismatch', walletCode: match[2] };
}
```

- [ ] **Step 4: 구현 — service.ts**

import 를 더한다:

```ts
import { WalletHttpError, classifyWalletRefundRefusal, walletRefundRefusalError } from './wallet-refund-refusal';
```

`walletFetch` 의 `if (!res.ok) { … }` 를 바꾼다:

```ts
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const walletCode = typeof body?.error === 'string' ? body.error : undefined;
      const message = typeof body?.message === 'string' ? body.message : `Wallet API error ${res.status}: ${path}`;
      throw new WalletHttpError(res.status, walletCode, message);
    }
```

`refundPayment` 의 wallet 호출을 감싼다:

```ts
    let res: { refunds?: WalletRefundRow[] };
    try {
      res = await this.walletFetch<{ refunds?: WalletRefundRow[] }>(`/v1/payment-intents/${intentId}/refund`, {
        method: 'POST',
        ...(idempotencyKey ? { headers: { 'Idempotency-Key': `medusa-refund:${idempotencyKey}` } } : {}),
        body: JSON.stringify({ amount: refundAmount, reasonCode: 'MEDUSA_REFUND' }),
      });
    } catch (error) {
      // 영구 거절만 NOT_ALLOWED(400)로 바꾼다 — 일시 실패까지 바꾸면 channel-adapter 가 재시도 없이 닫는다(#1016 36번 스펙 §4.1)
      const walletCode = error instanceof WalletHttpError ? error.walletCode : undefined;
      const kind = classifyWalletRefundRefusal(walletCode);
      if (kind && walletCode && error instanceof WalletHttpError) {
        throw walletRefundRefusalError(kind, walletCode, error.walletMessage);
      }
      throw error;
    }
```

(바로 아래 `judgeWalletRefund(res?.refunds ?? [], …)` 이후는 그대로.)

- [ ] **Step 5: 통과 확인**

Run: `cd apps/medusa && npm run test:unit -- src/modules/almond-payment`
Expected: PASS — 기존 refund-payment·refund-data 스펙 포함.

- [ ] **Step 6: Commit**

```bash
git add apps/medusa/src/modules/almond-payment/
git commit -m "feat(medusa): #1016 36번 — wallet 영구 환불 거절을 NOT_ALLOWED 표지로

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 12: 부분취소 502 본문 + 통합 실증

**Files:**
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts:62-71` (`PartialCancelRefundPending`), `:114-116` (환불 catch)
- Modify: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/route.ts:43-46`
- Modify: `apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts` (`FakeWallet`)
- Create: `apps/medusa/integration-tests/http/cancel-refund-refusal.spec.ts`

**Interfaces:**
- Consumes: `readRefundFailureCode` (Task 11)
- Produces: `PartialCancelRefundPending.refundFailure?: { kind; walletCode }`, 502 본문 `refundFailure?` (channel-adapter Task 8 이 읽는다), `FakeWallet.rejectNextRefundWith: { status: number; error: string } | null`

- [ ] **Step 1: 스텁 확장**

`partial-cancel-fixture.ts` 의 `FakeWallet` 에 필드를 더한다(`failNextRefundAs200Failed` 아래):

```ts
  /** wallet 의 영구 거절(400 REFUND_NOT_AUTOMATABLE 등)을 흉내낸다(#1016 36번) */
  rejectNextRefundWith: { status: number; error: string } | null = null;
```

`reset()` 에 `this.rejectNextRefundWith = null;` 을 더하고, `route` 의 `/refund` 분기에서 `if (this.failNextRefund) {` 바로 위에 더한다:

```ts
      if (this.rejectNextRefundWith) {
        const { status, error } = this.rejectNextRefundWith;
        this.rejectNextRefundWith = null;
        return { status, payload: { error, message: 'injected' } };
      }
```

- [ ] **Step 2: 실패하는 통합 스펙**

```ts
// apps/medusa/integration-tests/http/cancel-refund-refusal.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();

/**
 * wallet 영구 환불 거절이 Medusa 를 지나 표지 붙은 400 이 되는지(#1016 36번 스펙 §4.3).
 * 결제 모듈 → 워크플로 엔진 serializeError → 에러 핸들러 경로를 소스로만 읽었다 — 이 스펙이 실증이다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const cancel = (orderId: string) =>
      api.post(`/admin/orders/${orderId}/cancel`, {}, c.adminHeaders).catch((e: any) => e.response);

    it.each([
      [400, 'REFUND_NOT_AUTOMATABLE', 'refused'],
      [400, 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'ledger_mismatch'],
      [404, 'REFUNDABLE_CHARGE_NOT_FOUND', 'ledger_mismatch'],
    ])('전체취소: wallet %s %s → 400 not_allowed + code wallet_refund_%s, 주문은 취소되지 않는다', async (status, walletCode, kind) => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      wallet.rejectNextRefundWith = { status, error: walletCode };
      const res = await cancel(orderId);
      expect(res.status).toBe(400);
      expect(res.data).toEqual(expect.objectContaining({ type: 'not_allowed', code: `wallet_refund_${kind}:${walletCode}` }));
      expect(res.data.message).toContain(walletCode);
      expect((await loadOrder(getContainer(), orderId)).status).not.toBe('canceled');
      expect(wallet.refunds).toHaveLength(0);
    });

    it('전체취소: wallet 502 는 지금처럼 500 unknown_error — 재시도 대상', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      wallet.failNextRefund = true;
      const res = await cancel(orderId);
      expect(res.status).toBe(500);
      expect(res.data.type).toBe('unknown_error');
      expect((await loadOrder(getContainer(), orderId)).status).not.toBe('canceled');
    });

    it('거절 뒤 원인이 풀리면 같은 취소가 끝난다 — 다시 보내기의 출구', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE' };
      expect((await cancel(orderId)).status).toBe(400);
      const ok = await cancel(orderId);
      expect(ok.status).toBe(200);
      expect((await loadOrder(getContainer(), orderId)).status).toBe('canceled');
      expect(wallet.refunds).toHaveLength(1);
    });

    it('부분취소 라우트: 영구 거절이면 502 refund_pending 에 refundFailure, 일시 실패면 없다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const item = (await loadOrder(getContainer(), orderId)).items[0].id;
      const post = (requestId: string) =>
        api
          .post(`/admin/orders/${orderId}/partial-cancel`, { requestId, items: [{ item_id: item, quantity: 1 }] }, c.adminHeaders)
          .catch((e: any) => e.response);

      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_AMOUNT_EXCEEDS_TOTAL' };
      const refused = await post('r-refusal-1');
      expect(refused.status).toBe(502);
      expect(refused.data).toEqual(
        expect.objectContaining({
          type: 'refund_pending',
          stage: 'edited',
          refundFailure: { kind: 'ledger_mismatch', walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL' },
        }),
      );

      wallet.failNextRefund = true;
      const transient = await post('r-refusal-1');
      expect(transient.status).toBe(502);
      expect(transient.data.refundFailure).toBeUndefined();
    });
  },
});
```

Run: `scripts/local/run-medusa-integration.sh --testPathPattern cancel-refund-refusal`
Expected: 전체취소 표지 3건은 Task 11 만으로 PASS 할 수 있다(그러면 Task 11 의 전파 가정이 실증된 것이다). 부분취소 건은 FAIL — `refundFailure` 없음. **전체취소 건이 FAIL 이면 멈추고 보고한다** — 스펙 §4.3 의 전파 가정이 틀린 것이고 설계를 다시 봐야 한다.

- [ ] **Step 3: 구현**

`partial-cancel-order.ts` import 에 더한다:

```ts
import { readRefundFailureCode, type WalletRefundRefusalKind } from '../../../modules/almond-payment/wallet-refund-refusal';
```

`PartialCancelRefundPending`:

```ts
/** 주문 수정은 확정됐는데 환불을 끝내지 못했다. 같은 requestId 로 다시 부르면 환불부터 이어 간다. */
export class PartialCancelRefundPending extends Error {
  constructor(
    readonly requestId: string,
    message: string,
    /** 원인이 wallet 의 영구 거절이면 그 갈래(#1016 36번) — 재시도 동작은 같고 표시만 다르다 */
    readonly refundFailure?: { kind: WalletRefundRefusalKind; walletCode: string },
  ) {
    super(message);
    this.name = 'PartialCancelRefundPending';
  }
}
```

`run` 의 catch:

```ts
  } catch (error) {
    throw new PartialCancelRefundPending(
      input.requestId,
      `부분취소 환불이 끝나지 않았습니다(${input.requestId}): ${describeError(error)}`,
      readRefundFailureCode(error) ?? undefined,
    );
  }
```

`route.ts` 의 refund_pending 분기:

```ts
    if (error instanceof PartialCancelRefundPending) {
      res.status(502).json({
        type: 'refund_pending',
        stage: 'edited',
        requestId: error.requestId,
        message: error.message,
        ...(error.refundFailure ? { refundFailure: error.refundFailure } : {}),
      });
      return;
    }
```

같은 파일 상단 주석의 «502 refund_pending = 수정은 됐고 환불이 남음(재시도).» 뒤에 한 문장을 더한다: «원인이 wallet 영구 거절이면 본문에 `refundFailure` 가 붙는다(#1016 36번).»

- [ ] **Step 4: 통과 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern "cancel-refund-refusal|partial-cancel|wallet-refund-projection"`
Expected: PASS — 기존 부분취소·환불 투영 스펙 포함.

Run: `cd apps/medusa && npm run test:unit && npx tsc --noEmit --project tsconfig.instrumentation.json`
Expected: PASS · 에러 0

- [ ] **Step 5: Commit**

```bash
git add apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts "apps/medusa/src/api/admin/orders/[id]/partial-cancel/route.ts" apps/medusa/integration-tests/http/
git commit -m "feat(medusa): #1016 36번 — 부분취소 502 에 환불 거절 갈래, 표지 전파 통합 실증

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 13: PR 3 게이트와 PR

- [ ] **Step 1: 게이트**

```bash
(cd apps/medusa && npm run test:unit)
scripts/local/run-medusa-integration.sh
npm run type-check && npx jest --silent   # 루트 게이트는 medusa 를 빼지만, 루트 트리가 깨지지 않았는지 확인
```

- [ ] **Step 2: push + PR**

```bash
git push -u origin feat/1016-36-refund-refusal-medusa
gh pr create --base develop --title "feat: #1016 36번 — wallet 영구 환불 거절 표지 (3/3 Medusa)" --body "$(cat <<'EOF'
## 무엇
almond-payment 가 wallet 영구 환불 거절(400)을 «환불 불가 / 장부 불일치»로 분류해 `MedusaError(NOT_ALLOWED)` + `code: wallet_refund_<kind>:<walletCode>` 로 던진다 — 지금은 500 unknown_error 로 가려졌다. 부분취소 502 본문에도 같은 갈래를 싣는다.
**이게 머지·배포되는 순간 켜진다 — 1/3, 2/3 이 먼저 머지돼 있어야 한다.**

곁효과: Medusa 관리자 환불도 읽을 수 있는 400 이 된다.

- 스펙 `docs/superpowers/specs/2026-10-10-channel-cancel-refund-refusal-design.md` §4

https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
EOF
)"
```

---

# 로컬 스모크 — 머지 전, 세 브랜치를 합친 로컬 스택에서

### Task 14: 로컬 E2E 스모크 S1~S3

**Files:** 없음(검증만). 결과는 PR 3 본문에 표로 남긴다.

- [ ] **Step 1: 합친 브랜치를 띄운다**

```bash
git checkout -b local/1016-36-smoke feat/1016-36-refund-refusal-adapter
git merge --no-edit feat/1016-36-refund-refusal-medusa
npm run bootstrap:e2e:local
npm run start:all:local
npm run preflight:e2e:local     # ✗ 가 있으면 그것부터
```

브라우저 로그인(admin-web·스토어프론트)은 사람이 한다.

- [ ] **Step 2: 준비 — 포인트 결제 주문 2건(S1·S2)과 품목 2개 이상 주문 1건(S3)**

스토어프론트에서 포인트로 결제한다. 각 주문의 wallet intent id 는 Medusa DB 에서:

```sql
-- medusa DB
SELECT o.id AS order_id, p.data->>'intentId' AS intent_id
  FROM "order" o
  JOIN order_payment_collection opc ON opc.order_id = o.id
  JOIN payment p ON p.payment_collection_id = opc.payment_collection_id
 ORDER BY o.created_at DESC LIMIT 5;
```

- [ ] **Step 3: S1 장부 불일치 · 전체취소**

Medusa 장부가 모르는 wallet 환불을 만든다(`MEDUSA_REFUND` 는 투영이 건너뛴다). 키는 `apps/medusa/.env` 의 `WALLET_API_KEY`, 주소는 같은 파일의 `WALLET_BASE_URL`:

```bash
set -a; . apps/medusa/.env; set +a
curl -sS -X POST "$WALLET_BASE_URL/v1/payment-intents/<S1 intent_id>/refund" \
  -H "Authorization: Bearer $WALLET_API_KEY" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: smoke-1016-36-s1" \
  -d '{"amount": 1000, "reasonCode": "MEDUSA_REFUND"}'
```

admin-web 주문 상세에서 S1 을 전체취소한다. 기대:
- 정체 보드 «취소 요청» 단계에 «취소 · 장부 불일치» (판정은 1분 크론이라 최대 1분)
- 주문 상세 «장부 불일치 · 다시 환불하지 마세요 · wallet 환불 내역 대조 · …»
- Medusa 주문 `status` ≠ `canceled`, core 요청 `requested`
- 보드 [요청 접기] → 보류 해제, 요청 `rejected(OPERATOR_WITHDRAWN)`

- [ ] **Step 4: S2 환불 불가 · 전체취소 → 다시 보내기 출구**

```sql
-- wallet DB — 그 intent 의 결제수단을 환불 기능 없는 CMS_BATCH 로. 원래 값을 적어 둔다
SELECT pm.id, pm.type FROM payment_methods pm JOIN charges c ON c.payment_method_id = pm.id WHERE c.intent_id = '<S2 intent_id>';
UPDATE payment_methods SET type = 'CMS_BATCH' WHERE id = '<위 id>';
```

S2 전체취소 → 보드 «취소 · 환불 불가», 주문 상세 «환불 불가 · 다른 수단으로 환불 필요 · …». 그다음:

```sql
UPDATE payment_methods SET type = '<원래 값>' WHERE id = '<위 id>';
```

보드 [다시 보내기] → Medusa 주문 `canceled`, wallet 환불 1건, core 요청 `applied`, 보드에서 사라짐.

- [ ] **Step 5: S3 장부 불일치 · 부분취소**

S1 처럼 `MEDUSA_REFUND` 환불을 넣고 품목 하나를 부분취소한다. 기대: Medusa 주문 수정 확정, 보드 «취소 · 장부 불일치»(«수정됨 · 환불 미완» 보다 우선), channel-adapter 가 재시도 끝에 DLQ 로 보내도 표시 유지. [요청 접기]는 409(수정됨·미반영) — 의도된 동작이다(스펙 E5).

- [ ] **Step 6: 정리**

로컬 스택 종료(start-all 의 trap 은 손자 서버를 남긴다 — pid 로 직접 kill), `git checkout develop && git branch -D local/1016-36-smoke`. 결과 표를 PR 3 본문에 붙인다.

---

# 머지·배포 뒤

### Task 15: 이슈·문서 마무리

- [ ] **Step 1:** 1/3 → 2/3 → 3/3 순서로 머지(squash). 배포 전 대기 마이그레이션 대조(이 작업은 없음 — 남이 머지한 것만 확인)
- [ ] **Step 2:** `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` §7.2 의 «`REFUND_FAILED` 는 지금은 내지 않는다» 문단 끝에 한 줄: «→ #1016 36번이 켰다: `docs/superpowers/specs/2026-10-10-channel-cancel-refund-refusal-design.md`. `REFUND_FAILED` 는 요청을 닫지 않는다.» develop 에 커밋
- [ ] **Step 3:** #1016 본문 36번 행 — 해결 칸에 세 squash 해시, 문서 칸에 스펙·계획 경로, 본문의 코드 목록을 스펙 §4.1 로 고친다(`CHARGE_NOT_REFUNDABLE` → 장부 불일치, `REFUND_NOT_AUTOMATABLE` 추가, 보류 유지). 코멘트 금지·본문 수정
- [ ] **Step 4:** #1016 아티팩트 재게시(메모리 `order-lifecycle-audit-2026-10-05` 의 동기화 절차)
- [ ] **Step 5:** 배포 뒤 정체 보드에 두 새 상태가 0건으로 뜨는지 확인(라이브 기능 실측은 하지 않는다 — 스펙 §9)
