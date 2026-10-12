# 채널 주문 취소 PR-B (이벤트 계약 + channel-adapter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core 가 낼 `CancelChannelOrder` 명령을 channel-adapter 가 받아 Medusa 에 전체취소·부분취소를 요청하고, 정해진 실패는 `ChannelOrderCancelRejected`, 부분취소의 «수정됨 · 환불 미완»은 `ChannelOrderCancelStalled` 사실로 돌려준다 — 보내는 쪽(PR-C)이 아직 없어도 혼자 배포돼 안전한 상태로.

**Architecture:** 계약은 기존 명령 스트림 `channel-orders.commands.v1` 에 명령 하나, `orders.events.v1` 에 사실 둘을 더한다. channel-adapter 는 소비자(얇음) → `ChannelOrderCancelManager`(능력·매핑 확인, 결과 분류, 재수집) → `MedusaClient`(HTTP 응답을 «결과 값»으로 분류) / `ChannelOrderCancelRepository`(매핑 조회, 사실 아웃박스 적재) 로 나눈다. Medusa 응답 본문의 `type`·`code` 가 분류 근거라 SDK 대신 네이티브 fetch 로 부른다.

**Tech Stack:** NestJS, `@app/events`(StreamPublisher.enqueue 아웃박스), zod 4 이벤트 계약, drizzle, jest. Medusa 2.13.4 는 부르기만 한다 — **이 PR 은 `apps/medusa` 를 건드리지 않는다**(사용자 결정 2026-10-07).

**Spec:** `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` (§7.1~7.3 계약·channel-adapter, §9 경합, §10-5, §11 PR-B, §12 테스트). ADR-0042. 앞선 계획: `docs/superpowers/plans/2026-10-07-channel-order-cancel-pr-a-medusa.md`(PR #1024 머지).

## Global Constraints

- 명령: 토픽 `channel-orders.commands.v1`, 이벤트 이름 `CancelChannelOrder`, 파티션 키 `channelOrderPartitionKey(salesChannel, externalOrderId)` (보내는 쪽 = PR-C 의 일)
- 사실: 토픽 `orders.events.v1`, 이름 `ChannelOrderCancelRejected`·`ChannelOrderCancelStalled`. 파티션 키 = `salesChannel`(수집 사실 `OrderCreated`·`OrderModified`·`OrderCancelled` 와 같은 키 — 같은 채널 안 순서 유지)
- 거절 `reasonCode` 는 넷뿐: `NOT_SUPPORTED` · `ORDER_NOT_FOUND` · `NOT_CANCELABLE` · `REFUND_FAILED`. `OPERATOR_WITHDRAWN` 은 core 내부 값이라 계약에 넣지 않는다
- 성공 사실은 내지 않는다(D11) — 성공이면 `orderPoller.syncOrder(salesChannel, externalOrderId, { force: true })` 로 즉시 재수집
- 부분취소 라우트 계약(PR-A, 읽기만 한다): `POST /admin/orders/:id/partial-cancel` 본문 `{ requestId, items: [{ item_id, quantity }] }`(quantity = **취소할** 수량). 200 `{ requestId, refundAmount, shippingDelta, shippingNotAdjusted, stage }` · 400 `{ type: 'not_allowed', code: 'partial_cancel_rejected', message }` = 정해진 거절 · 400 `type: 'invalid_data'` = 본문 버그 · 502 `{ type: 'refund_pending', stage: 'edited', requestId, message }` = 수정됐고 환불 남음
- **정해진 부분취소 거절은 `code === 'partial_cancel_rejected'` 뿐이다.** 그 밖의 400(`type: 'not_allowed'` 포함 — Medusa 자신의 «다른 주문 수정이 열려 있음» 등)·404(롤링 중 옛 Medusa)·5xx·네트워크는 던진다(재시도·DLQ)
- 일시 실패는 던진다 — `@app/events` 기본 재시도(3회, 지수 1s~30s) 뒤 DLQ. 정해진 실패는 사실을 내고 정상 종료
- core 는 channel-adapter 를 직접 부르지 않는다 / channel-adapter 는 wallet 을 부르지 않는다
- 기존 `CoreOrderCancelled` 역투영(`inbox-worker.service.ts`)의 **결과 동작은 바꾸지 않는다** — 지우는 건 PR-D
- 전체취소에서 wallet 이 «환불 불가»로 거절해도 Medusa 는 500 으로 답한다 — **일시 실패로 던진다**(재시도 → DLQ → core 5분 정체 보드). 계약의 `REFUND_FAILED` 는 남기되 이 PR 은 내지 않는다
- 검증 게이트: 루트 `npm run type-check` 0 · `npx jest --maxWorkers=2` 0(무제한은 OOM)

## 계획 단계에서 스펙과 달라진 점 (마지막 태스크가 스펙에 반영)

1. **Medusa JS SDK 의 `FetchError` 는 응답 본문을 버린다** — `message`·`status`·`statusText` 만 남는다(`@medusajs/js-sdk/dist/client.js` `normalizeResponse`). 부분취소의 `code: 'partial_cancel_rejected'` 와 502 `type: 'refund_pending'` 을 SDK 로는 볼 수 없다. → 취소 두 호출은 네이티브 fetch(`refreshCustomerCartPrices` 와 같은 Basic 인증)로 부르고 상태로 던지지 않는다. ALB 가 Medusa 다운 때 내는 502(본문 없음)와 우리 라우트의 502 `refund_pending` 을 가르는 것도 이 덕이다.
2. **`REFUND_FAILED` 는 판별하지 않는다(사용자 결정 2026-10-07).** almond-payment 의 `walletFetch` 가 일반 `Error` 를 던지고, Medusa 오류 처리기(`@medusajs/framework/dist/http/middlewares/error-handler.js`)는 `MedusaError` 가 아닌 오류를 500 `{ type: 'unknown_error', message: 'An unknown error occurred.' }` 로 **가려서** 보낸다 — channel-adapter 는 wallet 거절과 Medusa 장애를 구분할 수 없다. 판별하려면 Medusa 를 고쳐야 해서(almond-payment 가 wallet «환불 불가» 400 을 `MedusaError(NOT_ALLOWED)` + 표지로 바꾸기) 이 PR 에서 뺐다. 그 경우는 일시 실패로 재시도 → DLQ → core 5분 정체 보드로 간다. 운영자는 사유 없이 «취소 요청 미반영»을 보고 [요청 접기]로 정리한다(사유는 DLQ·로그). wallet 은 돈을 움직이기 전에 거절하므로 재시도는 해가 없다. 흔했던 원인(Medusa 밖 wallet 환불, 무통장 이중 시도)은 PR-A 투영과 PR-C 가 없애므로 드물다고 본다(채널 주문의 실제 빈도는 미확인). **`REFUND_FAILED` 는 계약에 남긴다** — enum 값은 나중에 더하면 소비자 선배포가 필요하지만, 지금 넣어 두면 Medusa 쪽만 고쳐 켤 수 있다.
3. **전체취소는 `requestId` 를 Medusa 에 넘기지 않는다.** 코어 라우트 `POST /admin/orders/:id/cancel` 이 받지 않는다. 멱등은 «이미 취소됨 = 성공»(400 `invalid_data` `Order with id … has been canceled.` — `core-flows/dist/order/utils/order-validation.js` `throwIfOrderIsCancelled`)으로 선다. `requestId` 는 로그에만 남는다. 이 문구 판정은 Medusa 업그레이드가 문구를 바꾸면 «재전달된 명령이 거절로 닫히는» 쪽으로 틀어진다 — 그래도 수집이 오면 판단 10 대로 반영된다(§9-8). Medusa 를 올릴 때 이 문구를 확인한다.
4. **`cancelOrder` 는 결과 값(`MedusaCancelOutcome`)을 돌려준다.** 스펙 §7.3 «400 분류를 고친다»의 구현이다. 옛 역투영 호출부는 그 값을 받아 **지금과 같은 결과**를 낸다: 400·404 → 건너뜀(published), 5xx·네트워크 → 던짐(→ inbox 재시도 끝에 `failed`). 후자가 중요하다 — 스펙 §11 «PR-D 전 라이브 확인»이 그 `failed` 행을 센다.
5. **§10-5 답: 미등록 이벤트는 조용히 버려진다.** 전역 `SchemaValidationInterceptor` 가 `Event type not found in stream config` 경고만 남기고 통과시키고, `EventTypeGuard` 가 `of(undefined)` 로 정상 종료한다 — 오프셋이 넘어가 메시지는 사라진다(`libs/events/src/interceptors/schema-validation.interceptor.ts`, `libs/events/src/guards/event-type.guard.ts`). 스펙 §11 롤링 함정(«처리기가 없으면 `requested` 로 남아 5분 뒤 정체 보드»)의 전제가 맞다. **같은 일이 PR-C 롤링 중 반대 방향으로도 난다** — 옛 core 태스크가 `ChannelOrderCancelRejected`·`Stalled` 를 받으면 버린다. PR-C 계획에 옮길 것.
6. **매핑 확인은 `wms_order_mappings (sales_channel, channel_order_id)` 존재 여부다.** Medusa 주문의 `externalOrderId` 가 곧 Medusa 주문 id 이고(`medusa-order.source.ts`), 줄의 `channelOrderItemId` 가 곧 Medusa 줄 id 다(`medusa-order.source.ts:115`). 그래서 id 변환은 없고, 매핑은 «우리가 수집한 주문인가»만 본다.

## Review Focus

1. **옛 역투영이 Medusa 500 을 만났을 때** — `cancelOrder` 를 결과 값으로 바꾼 뒤에도 5xx 는 **던져야** 한다(건너뛰면 PR-D 전 대사 근거인 `failed` 행이 안 생긴다). 무통장 이중 시도가 바로 이 경우다. Task 3 테스트가 지킨다
2. **본문 없는 502(ALB·게이트웨이)** — 진행 사실(`Stalled`)을 내면 안 된다. `type === 'refund_pending'` 일 때만. Task 3 테스트
3. **같은 명령이 두 번 온다(최소 1회 전달)** — 전체는 두 번째가 «이미 취소됨»이라 거절 없이 재수집, 부분은 Medusa 가 같은 `requestId` 결과를 돌려준다. Task 4 테스트(`already_cancelled` → 재수집, 거절 없음)
4. **Medusa 는 성공했는데 재수집이 실패** — 거절 사실을 내지 말고 던져야 한다(재시도가 멱등 호출 → 재수집). Task 4 테스트
5. **잘못된 명령 모양** — `partial` 인데 줄 없음, `full` 인데 줄 있음, 같은 줄 두 번. 소비 검증에서 막혀 Medusa 에 닿지 않아야 한다. Task 1 테스트. (모르는 채널 문자열 `cafe24` 는 모양은 맞으므로 `NOT_SUPPORTED` 거절 — Task 4 테스트)

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `packages/event-contracts/streams/channel-orders-command.stream.ts` | `CancelChannelOrder` 명령 계약 (Task 1) |
| `packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts` | 명령 스키마 (Task 1) |
| `packages/event-contracts/streams/orders.stream.ts` | `ChannelOrderCancelRejected`·`ChannelOrderCancelStalled` 사실 계약 (Task 2) |
| `packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts` (신규) | 사실 스키마 (Task 2) |
| `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` | `cancelOrder` 결과 값, `partialCancelOrder`, `postAdmin` (Task 3) |
| `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts` | 분류 (Task 3) |
| `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts` | 옛 역투영이 결과 값을 받아 같은 동작 (Task 3) |
| `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts` | 옛 동작 유지 (Task 3) |
| `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts` (신규) | 매핑 존재, 사실 적재 (Task 4) |
| `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts` (신규) | 판정·라우팅·분류·재수집 (Task 4) |
| `apps/channel-adapter/src/services/order-cancel/*.spec.ts` (신규) | (Task 4) |
| `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts` | `CancelChannelOrder` 처리기 (Task 5) |
| `apps/channel-adapter/src/adapter.module.ts` | 매니저·리포지토리 등록 (Task 5) |
| `apps/channel-adapter/CLAUDE.md`, `libs/shared/src/streams/README.md`, 스펙 | 문서 (Task 6) |

---

### Task 1: 계약 — `CancelChannelOrder` 명령

**Files:**
- Modify: `packages/event-contracts/streams/channel-orders-command.stream.ts`
- Test: `packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts`

**Interfaces:**
- Produces: `CancelChannelOrderPayload`(아래 그대로), `CHANNEL_ORDERS_COMMAND_STREAM.events.CancelChannelOrder`. `EventPayloadOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'CancelChannelOrder'>` 가 `CancelChannelOrderPayload` 다

- [ ] **Step 1: 실패하는 테스트**

`channel-orders-command-stream.spec.ts` 의 `describe` 안, 파티션 키 테스트 앞에 더한다:

```ts
  describe('CancelChannelOrder (#1016 35번 행)', () => {
    const schema = CHANNEL_ORDERS_COMMAND_STREAM.events.CancelChannelOrder.schema!;
    const full = {
      requestId: '0192f0aa-0000-7000-8000-000000000001',
      salesChannel: 'medusa',
      externalOrderId: 'order_1',
      scope: 'full',
      requestedBy: 'operator',
      requestedAt: '2026-10-07T00:00:00.000Z',
    };
    const partial = { ...full, scope: 'partial', lines: [{ channelOrderItemId: 'ordli_1', quantity: 2 }] };

    it('전체취소는 줄 없이, 부분취소는 줄과 함께 통과한다', () => {
      expect(schema.parse(full)).toEqual(full);
      expect(schema.parse(partial)).toEqual(partial);
      expect(schema.parse({ ...full, reasonCode: 'CUSTOMER_REQUEST', requestedBy: 'wallet-refund-approval' })).toMatchObject({
        reasonCode: 'CUSTOMER_REQUEST',
      });
    });

    it('부분취소인데 줄이 없거나 비면 거절한다', () => {
      expect(() => schema.parse({ ...full, scope: 'partial' })).toThrow();
      expect(() => schema.parse({ ...partial, lines: [] })).toThrow();
    });

    it('전체취소에 줄을 실으면 거절한다 — 어느 쪽이 정본인지 갈린다', () => {
      expect(() => schema.parse({ ...full, lines: partial.lines })).toThrow();
    });

    it('같은 줄이 두 번 실리면 거절한다', () => {
      expect(() =>
        schema.parse({
          ...partial,
          lines: [
            { channelOrderItemId: 'ordli_1', quantity: 1 },
            { channelOrderItemId: 'ordli_1', quantity: 1 },
          ],
        }),
      ).toThrow();
    });

    it.each([
      ['수량 0', { lines: [{ channelOrderItemId: 'ordli_1', quantity: 0 }] }],
      ['소수 수량', { lines: [{ channelOrderItemId: 'ordli_1', quantity: 1.5 }] }],
      ['빈 줄 id', { lines: [{ channelOrderItemId: '', quantity: 1 }] }],
      ['빈 requestId', { requestId: '' }],
      ['모르는 scope', { scope: 'some' }],
      ['모르는 요청자', { requestedBy: 'robot' }],
      ['ISO 아닌 시각', { requestedAt: 'yesterday' }],
    ])('%s 는 거절한다', (_label, patch) => {
      expect(() => schema.parse({ ...partial, ...patch })).toThrow();
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'schema')`

- [ ] **Step 3: 구현**

`channel-orders-command.stream.ts` — 파일 머리 주석의 «(나중의 35번 행 취소 요청 포함)»을 «(35번 행 취소 요청 포함)»으로 고치고, `ResyncChannelOrderPayload` 아래에 더한다:

```ts
/**
 * 채널에 주문 취소·부분취소를 요청한다 (#1016 35번 행, ADR-0042). core 는 요청을 기록·보류한 뒤 이 명령을 내고,
 * 확정은 재수집된 `OrderCancelled`/`OrderModified` 로, 거절은 `ChannelOrderCancelRejected` 로 돌려받는다.
 * 환불은 채널이 한다 — core 도 channel-adapter 도 wallet 을 부르지 않는다.
 */
export interface CancelChannelOrderPayload {
  /** core `sales_order_amendments.id`. 같은 요청의 재전송은 같은 값이다 — 채널 쪽 멱등 키 */
  requestId: string;
  /** 'medusa' | 'naver' … — 문자열로 두고, 지원 여부는 소비자가 판정한다 */
  salesChannel: string;
  externalOrderId: string;
  scope: 'full' | 'partial';
  /** partial 일 때만. `quantity` 는 «취소할» 수량이다(남길 수량이 아니다) */
  lines?: Array<{ channelOrderItemId: string; quantity: number }>;
  reasonCode?: string;
  requestedBy: 'operator' | 'customer' | 'wallet-refund-approval';
  /** ISO 8601 */
  requestedAt: string;
}
```

Zod 스키마 자리(`ResyncChannelOrderSchema` 아래)에:

```ts
const CancelChannelOrderSchema = z
  .object({
    requestId: z.string().min(1),
    salesChannel: z.string().min(1),
    externalOrderId: z.string().min(1),
    scope: z.enum(['full', 'partial']),
    lines: z
      .array(z.object({ channelOrderItemId: z.string().min(1), quantity: z.number().int().positive() }))
      .optional(),
    reasonCode: z.string().min(1).optional(),
    requestedBy: z.enum(['operator', 'customer', 'wallet-refund-approval']),
    requestedAt: z.string().datetime(),
  })
  .superRefine((payload, context) => {
    if (payload.scope === 'partial' && (payload.lines === undefined || payload.lines.length === 0)) {
      context.addIssue({ code: 'custom', path: ['lines'], message: '부분취소는 취소할 줄이 필요하다' });
    }
    if (payload.scope === 'full' && payload.lines !== undefined) {
      context.addIssue({ code: 'custom', path: ['lines'], message: '전체취소는 줄을 싣지 않는다 — 실으면 어느 쪽이 정본인지 갈린다' });
    }
    const ids = (payload.lines ?? []).map((line) => line.channelOrderItemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['lines'], message: '같은 줄이 두 번 실렸다' });
    }
  });
```

`events` 에:

```ts
    CancelChannelOrder: event<'CancelChannelOrder', CancelChannelOrderPayload>('CancelChannelOrder', CancelChannelOrderSchema),
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts packages/event-contracts/streams/registry.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/event-contracts/streams/channel-orders-command.stream.ts packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts
git commit -m "feat(event-contracts): CancelChannelOrder 명령 (#1016 35번 PR-B)"
```

---

### Task 2: 계약 — 거절·정체 사실

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts`
- Create: `packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`

**Interfaces:**
- Produces:
  - `CHANNEL_ORDER_CANCEL_REJECTION_CODES = ['NOT_SUPPORTED', 'ORDER_NOT_FOUND', 'NOT_CANCELABLE', 'REFUND_FAILED'] as const`
  - `type ChannelOrderCancelRejectionCode = (typeof CHANNEL_ORDER_CANCEL_REJECTION_CODES)[number]`
  - `interface ChannelOrderCancelRejectedPayload { requestId: string; salesChannel: string; externalOrderId: string; reasonCode: ChannelOrderCancelRejectionCode; message: string }`
  - `interface ChannelOrderCancelStalledPayload { requestId: string; salesChannel: string; externalOrderId: string; stage: 'edited'; message: string }`
  - `ORDER_STREAM.events.ChannelOrderCancelRejected`, `ORDER_STREAM.events.ChannelOrderCancelStalled`
  - 셋 다 `@packages/event-contracts/streams` 에서 import 된다(`index.ts:14` 가 `orders.stream` 을 이미 re-export 한다)

- [ ] **Step 1: 실패하는 테스트**

```ts
// packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts
import { ORDER_STREAM, CHANNEL_ORDER_CANCEL_REJECTION_CODES } from '../orders.stream';

describe('채널 주문 취소 결과 사실 (#1016 35번 행)', () => {
  const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };

  describe('ChannelOrderCancelRejected', () => {
    const schema = ORDER_STREAM.events.ChannelOrderCancelRejected.schema!;

    it.each(CHANNEL_ORDER_CANCEL_REJECTION_CODES)('%s 를 받는다', (reasonCode) => {
      const payload = { ...key, reasonCode, message: '사유' };
      expect(schema.parse(payload)).toEqual(payload);
    });

    it('core 내부 값 OPERATOR_WITHDRAWN 은 사실이 아니다', () => {
      expect(() => schema.parse({ ...key, reasonCode: 'OPERATOR_WITHDRAWN', message: '접음' })).toThrow();
    });

    it('requestId 가 없으면 core 가 요청을 찾지 못하므로 거절한다', () => {
      expect(() => schema.parse({ ...key, requestId: '', reasonCode: 'NOT_CANCELABLE', message: 'x' })).toThrow();
    });
  });

  describe('ChannelOrderCancelStalled', () => {
    const schema = ORDER_STREAM.events.ChannelOrderCancelStalled.schema!;

    it('stage 는 edited 뿐이다', () => {
      const payload = { ...key, stage: 'edited', message: '환불 미완' };
      expect(schema.parse(payload)).toEqual(payload);
      expect(() => schema.parse({ ...payload, stage: 'refunded' })).toThrow();
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`
Expected: FAIL — `CHANNEL_ORDER_CANCEL_REJECTION_CODES` 가 없어 import 실패(또는 `schema` undefined)

- [ ] **Step 3: 구현**

`orders.stream.ts` — `// ===== Stream Config (타입 안전 버전) =====` 바로 위에 더한다:

```ts
// ===== 채널 주문 취소 결과 (#1016 35번 행, ADR-0042) =====

/**
 * core 의 `CancelChannelOrder` 명령을 채널이 받아들이지 않은 이유. core 내부 값(`OPERATOR_WITHDRAWN`)은 사실이 아니라 넣지 않는다.
 * - `NOT_SUPPORTED`: 자동 취소 불가 채널(방어선 — core 가 이미 거른다)
 * - `ORDER_NOT_FOUND`: 채널에 그 주문이 없다
 * - `NOT_CANCELABLE`: 채널이 상태상 거절했다
 * - `REFUND_FAILED`: wallet 이 «환불 불가»로 거절해 채널의 취소가 롤백됐다. **아직 아무도 내지 않는다** — Medusa 가 그 거절을
 *   500 으로 가려 판별할 수 없다(스펙 §7.2). 값을 미리 둔 이유: enum 값은 나중에 더하면 소비자를 먼저 배포해야 한다
 */
export const CHANNEL_ORDER_CANCEL_REJECTION_CODES = ['NOT_SUPPORTED', 'ORDER_NOT_FOUND', 'NOT_CANCELABLE', 'REFUND_FAILED'] as const;
export type ChannelOrderCancelRejectionCode = (typeof CHANNEL_ORDER_CANCEL_REJECTION_CODES)[number];

/** 종결 사실 — core 는 요청을 rejected 로 닫고 보류를 푼다. 성공은 사실로 내지 않는다(재수집된 변경이 곧 사실). */
export interface ChannelOrderCancelRejectedPayload {
  /** `CancelChannelOrderPayload.requestId` 그대로 */
  requestId: string;
  salesChannel: string;
  externalOrderId: string;
  reasonCode: ChannelOrderCancelRejectionCode;
  /** 운영자에게 보일 사유. 채널이 준 문구를 그대로 담는다 */
  message: string;
}

const ChannelOrderCancelRejectedSchema = z.object({
  requestId: z.string().min(1),
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  reasonCode: z.enum(CHANNEL_ORDER_CANCEL_REJECTION_CODES),
  message: z.string(),
});

/**
 * 진행 사실 — 종결이 아니다. 부분취소가 주문 수정까지 확정하고 환불에서 멈췄다(주문은 줄었는데 돈은 아직).
 * channel-adapter 는 이것을 낸 뒤 재시도하고, core 는 요청을 `requested` 로 둔 채 단계만 적는다(같은 값이라 여러 번 와도 멱등).
 */
export interface ChannelOrderCancelStalledPayload {
  requestId: string;
  salesChannel: string;
  externalOrderId: string;
  stage: 'edited';
  message: string;
}

const ChannelOrderCancelStalledSchema = z.object({
  requestId: z.string().min(1),
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  stage: z.literal('edited'),
  message: z.string(),
});
```

`ORDER_STREAM.events` 의 `OrderMerged` 아래에:

```ts
    ChannelOrderCancelRejected: event<'ChannelOrderCancelRejected', ChannelOrderCancelRejectedPayload>(
      'ChannelOrderCancelRejected',
      ChannelOrderCancelRejectedSchema,
    ),
    ChannelOrderCancelStalled: event<'ChannelOrderCancelStalled', ChannelOrderCancelStalledPayload>(
      'ChannelOrderCancelStalled',
      ChannelOrderCancelStalledSchema,
    ),
```

> 소비자 영향: `orders.events.v1` 을 구독하는 core·notification·ugc-service·analytics 는 이 두 이름에 처리기가 없다 — `EventTypeGuard` 가 조용히 넘긴다(위 «달라진 점» 5). 처리기는 PR-C(core)의 일이다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest packages/event-contracts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/event-contracts/streams/orders.stream.ts packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts
git commit -m "feat(event-contracts): ChannelOrderCancelRejected·Stalled 사실 (#1016 35번 PR-B)"
```

---

### Task 3: channel-adapter `MedusaClient` — 취소 응답을 결과 값으로

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (`cancelOrder` 1898-1917행 교체, 클래스 끝에 `partialCancelOrder`·`postAdmin`, 파일 위쪽에 타입·상수)
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts` (`CoreOrderCancelled` 분기 627행)
- Test: `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts`, `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`

**Interfaces:**
- Consumes: 코어 취소 라우트의 «이미 취소됨» 400(`Order with id … has been canceled.`), PR-A 부분취소 라우트 계약(Global Constraints)
- Produces (모두 `medusa.client.ts` 에서 export):
  ```ts
  export type MedusaCancelOutcome =
    | { kind: 'cancelled' }
    | { kind: 'already_cancelled' }
    | { kind: 'not_found'; message: string }
    | { kind: 'not_cancelable'; message: string };
  export type MedusaPartialCancelOutcome =
    | { kind: 'cancelled'; refundAmount: number | null; shippingDelta: number | null; shippingNotAdjusted: boolean }
    | { kind: 'rejected'; message: string }
    | { kind: 'refund_pending'; message: string };
  export class MedusaHttpError extends Error { readonly status: number }
  MedusaClient.cancelOrder(orderId: string): Promise<MedusaCancelOutcome>
  MedusaClient.partialCancelOrder(orderId: string, input: { requestId: string; items: Array<{ itemId: string; quantity: number }> }): Promise<MedusaPartialCancelOutcome>
  ```
  정해진 결과가 아닌 응답은 `MedusaHttpError`(status 를 실어 `isTransientMedusaError` 가 읽는다)를, 연결 실패는 원래 오류를 cause 로 단 `Error` 를 던진다.

- [ ] **Step 1: 실패하는 테스트 — MedusaClient**

`medusa.client.spec.ts` 끝에 더한다:

```ts
describe('MedusaClient 취소 (#1016 35번 PR-B)', () => {
  function makeClient() {
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).apiUrl = 'http://medusa.local';
    (client as any).apiKey = 'sk_test';
    (client as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return client;
  }
  const respond = (status: number, body?: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: body === undefined ? async () => { throw new SyntaxError('Unexpected end of JSON input'); } : async () => body,
    }) as any;

  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('cancelOrder', () => {
    it('코어 취소 라우트를 Basic 인증으로 POST 한다', async () => {
      global.fetch = respond(200, { order: { id: 'order_1' } });
      await expect(makeClient().cancelOrder('order_1')).resolves.toEqual({ kind: 'cancelled' });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://medusa.local/admin/orders/order_1/cancel',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('sk_test:').toString('base64')}` }),
        }),
      );
    });

    it('«이미 취소됨» 400 만 성공 쪽이다', async () => {
      global.fetch = respond(400, { type: 'invalid_data', message: 'Order with id order_1 has been canceled.' });
      await expect(makeClient().cancelOrder('order_1')).resolves.toEqual({ kind: 'already_cancelled' });
    });

    it('그 밖의 400 은 취소 불가다 — 옛 코드처럼 성공으로 삼키지 않는다', async () => {
      const message = 'All fulfillments must be canceled before canceling an order';
      global.fetch = respond(400, { type: 'not_allowed', message });
      await expect(makeClient().cancelOrder('order_1')).resolves.toEqual({ kind: 'not_cancelable', message });
    });

    it('404 는 주문 없음이다', async () => {
      global.fetch = respond(404, { type: 'not_found', message: 'Order id not found: order_1' });
      await expect(makeClient().cancelOrder('order_1')).resolves.toEqual({ kind: 'not_found', message: 'Order id not found: order_1' });
    });

    it('5xx 는 status 를 실어 던진다 — wallet «환불 불가»도 Medusa 가 500 으로 가리므로 여기다(일시 실패)', async () => {
      global.fetch = respond(500, { type: 'unknown_error', message: 'An unknown error occurred.' });
      const err = await makeClient().cancelOrder('order_1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MedusaHttpError);
      expect(isTransientMedusaError(err)).toBe(true);
    });

    it('연결 실패는 cause 를 단 채 던진다', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })) as any;
      const err = await makeClient().cancelOrder('order_1').catch((e: unknown) => e);
      expect(isTransientMedusaError(err)).toBe(true);
    });
  });

  describe('partialCancelOrder', () => {
    const input = { requestId: 'req-1', items: [{ itemId: 'ordli_1', quantity: 2 }] };

    it('부분취소 라우트에 item_id·취소할 수량을 보낸다', async () => {
      global.fetch = respond(200, { requestId: 'req-1', refundAmount: 27500, shippingDelta: -3000, shippingNotAdjusted: false, stage: 'refunded' });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({
        kind: 'cancelled',
        refundAmount: 27500,
        shippingDelta: -3000,
        shippingNotAdjusted: false,
      });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('http://medusa.local/admin/orders/order_1/partial-cancel');
      expect(JSON.parse(init.body)).toEqual({ requestId: 'req-1', items: [{ item_id: 'ordli_1', quantity: 2 }] });
    });

    it('code=partial_cancel_rejected 만 정해진 거절이다', async () => {
      global.fetch = respond(400, { type: 'not_allowed', code: 'partial_cancel_rejected', message: '수량이 남은 수량보다 많습니다' });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({ kind: 'rejected', message: '수량이 남은 수량보다 많습니다' });
    });

    it('Medusa 자신의 not_allowed(다른 주문 수정이 열려 있음)는 던진다 — 일시적이다', async () => {
      global.fetch = respond(400, { type: 'not_allowed', message: 'Order order_1 already has an existing active order change' });
      await expect(makeClient().partialCancelOrder('order_1', input)).rejects.toBeInstanceOf(MedusaHttpError);
    });

    it('invalid_data 는 던진다 — 우리 본문 버그다', async () => {
      global.fetch = respond(400, { type: 'invalid_data', message: 'items 가 비어 있습니다' });
      await expect(makeClient().partialCancelOrder('order_1', input)).rejects.toThrow(/invalid_data/);
    });

    it('404 는 던진다 — 롤링 중 옛 Medusa 에 라우트가 없다', async () => {
      global.fetch = respond(404, undefined);
      await expect(makeClient().partialCancelOrder('order_1', input)).rejects.toBeInstanceOf(MedusaHttpError);
    });

    it('502 refund_pending 은 환불 미완 결과다', async () => {
      global.fetch = respond(502, { type: 'refund_pending', stage: 'edited', requestId: 'req-1', message: '환불이 끝나지 않았습니다' });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({ kind: 'refund_pending', message: '환불이 끝나지 않았습니다' });
    });

    it('본문 없는 502(ALB)는 환불 미완이 아니다 — 던진다', async () => {
      global.fetch = respond(502, undefined);
      const err = await makeClient().partialCancelOrder('order_1', input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MedusaHttpError);
      expect(isTransientMedusaError(err)).toBe(true);
    });
  });
});
```

파일 머리 import 를 `import { MedusaClient, MedusaHttpError } from './medusa.client';` 로 바꾸고 `import { isTransientMedusaError } from './transient-error';` 를 더한다.

- [ ] **Step 2: 실패하는 테스트 — 옛 역투영의 동작 유지**

`inbox-worker.service.spec.ts` 의 `'looks up the mapping by channelOrderId, not wmsOrderId'` 에서 `cancelOrder: jest.fn(async () => undefined)` 를 `cancelOrder: jest.fn(async () => ({ kind: 'cancelled' }))` 로 바꾸고, 그 `it` 아래에 더한다(같은 생성자 인자 모양을 쓴다):

```ts
  function cancelService(cancelOrder: jest.Mock) {
    const queryResults = [[], [{ salesChannel: 'medusa', channelOrderId: 'order_01ABC' }]];
    const select = jest.fn(() => ({
      from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(async () => queryResults.shift() ?? []) })) })),
    }));
    const updateSet = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
    const update = jest.fn(() => ({ set: updateSet }));
    const medusaClient = { cancelOrder };
    const service = new (InboxWorkerService as any)(
      { db: { select, update } },
      {},
      {},
      {},
      {},
      medusaClient,
      {},
      {},
      { get: jest.fn() },
      { runWithChain: jest.fn() },
    );
    const handleFailure = jest.spyOn(service as any, 'handleFailure').mockResolvedValue(undefined);
    const event = {
      id: 'inbox-cancel',
      eventType: 'CoreOrderCancelled',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: { orderId: '11111111-1111-4111-8111-111111111111', channelOrderId: 'order_01ABC' },
      attempts: 1,
      createdAt: new Date('2026-10-07T00:00:00.000Z'),
      metadata: {},
    };
    return { service, handleFailure, updateSet, event };
  }

  it.each([
    { kind: 'already_cancelled' },
    { kind: 'not_found', message: 'gone' },
    { kind: 'not_cancelable', message: 'fulfilled' },
  ])('옛 역투영은 $kind 를 지금처럼 건너뛴다(published) — PR-D 까지 동작 불변', async (outcome) => {
    const { service, handleFailure, updateSet, event } = cancelService(jest.fn(async () => outcome));
    await service.doProcessInboxEvent(event);
    expect(handleFailure).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }));
  });

  it('옛 역투영은 Medusa 5xx 를 지금처럼 실패로 둔다 — PR-D 전 대사가 세는 failed 행이 남아야 한다', async () => {
    const error = new MedusaHttpError(500, 'Medusa cancelOrder failed (status=500): An unknown error occurred.');
    const { service, handleFailure, event } = cancelService(jest.fn().mockRejectedValue(error));
    await service.doProcessInboxEvent(event);
    expect(handleFailure).toHaveBeenCalledWith(event, error);
  });
```

inbox-worker spec 머리에 `import { MedusaHttpError } from './medusa.client';` 를 더한다.

> `doProcessInboxEvent` 의 성공 처리가 `update(inboxEvents).set({ status: 'published', … })` 이고 실패는 `handleFailure(event, error)` 다(`inbox-worker.service.ts` 630-650행). 테스트 작성 전에 그 두 줄을 읽어 확인한다.

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`
Expected: FAIL — `MedusaHttpError` export 없음(두 spec 모두 import 단계에서 빨갛다), `partialCancelOrder is not a function`

- [ ] **Step 4: 구현 — MedusaClient**

`medusa.client.ts` 의 `export class MedusaClient` 바로 위에:

```ts
/** Medusa 전체취소 결과. 정해진 결과만 값이고, 일시 실패(5xx·네트워크)는 던진다(#1016 35번 PR-B). */
export type MedusaCancelOutcome =
  | { kind: 'cancelled' }
  | { kind: 'already_cancelled' }
  | { kind: 'not_found'; message: string }
  | { kind: 'not_cancelable'; message: string };

/** Medusa 부분취소 결과(PR-A 라우트 계약). `refund_pending` = 주문 수정은 확정됐고 환불이 남았다 — 같은 requestId 로 다시 부르면 이어 간다. */
export type MedusaPartialCancelOutcome =
  | { kind: 'cancelled'; refundAmount: number | null; shippingDelta: number | null; shippingNotAdjusted: boolean }
  | { kind: 'rejected'; message: string }
  | { kind: 'refund_pending'; message: string };

/** Medusa 가 정해진 결과가 아닌 상태로 답했다. status 를 실어 `isTransientMedusaError` 가 읽는다. */
export class MedusaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MedusaHttpError';
  }
}

/**
 * 코어 `throwIfOrderIsCancelled` 의 문구(`Order with id … has been canceled.`, `@medusajs/core-flows` 2.13.4).
 * Medusa 를 올릴 때 확인할 것 — 바뀌면 재전달된 전체취소 명령이 거절(NOT_CANCELABLE)로 닫힌다.
 */
const ALREADY_CANCELLED_MESSAGE = /has been canceled/;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

기존 `cancelOrder` 를 통째로 바꾼다:

```ts
  /**
   * 전체취소. 400 은 문구로 가른다 — «이미 취소됨»만 성공 쪽이고(멱등: 같은 명령의 재전달), 나머지 400 을 성공으로 삼키지 않는다.
   * 코어 라우트는 requestId 를 받지 않으므로 멱등은 «이미 취소됨»으로만 선다.
   * wallet 이 환불을 거절하면 Medusa 는 그 오류를 500 «An unknown error occurred.» 로 가린다 — 장애와 구분할 수 없어 던진다(일시 실패).
   */
  async cancelOrder(orderId: string): Promise<MedusaCancelOutcome> {
    const path = `/admin/orders/${encodeURIComponent(orderId)}/cancel`;
    const { status, body } = await this.postAdmin(path);
    const message = typeof body.message === 'string' ? body.message : `status ${status}`;
    if (status >= 200 && status < 300) {
      this.logger.log(`Cancelled Medusa order: ${orderId}`);
      return { kind: 'cancelled' };
    }
    if (status === 404) return { kind: 'not_found', message };
    if (status === 400) {
      if (ALREADY_CANCELLED_MESSAGE.test(message)) return { kind: 'already_cancelled' };
      return { kind: 'not_cancelable', message };
    }
    this.logger.error(`Failed to cancel Medusa order: ${orderId} (status=${status})`, message);
    throw new MedusaHttpError(status, `Medusa cancelOrder failed (status=${status}): ${message}`);
  }
```

클래스 끝(`refreshCustomerCartPrices` 아래)에:

```ts
  /**
   * 부분취소(PR-A 라우트). 정해진 거절은 `code === 'partial_cancel_rejected'` 뿐이다 — Medusa 자신의 not_allowed(다른 주문 수정이
   * 열려 있음 등)도 같은 400 type 이라 type 으로 가르면 일시 실패를 종결로 닫는다. 그 밖의 400·404(롤링 중 옛 Medusa)·5xx 는 던진다.
   */
  async partialCancelOrder(
    orderId: string,
    input: { requestId: string; items: Array<{ itemId: string; quantity: number }> },
  ): Promise<MedusaPartialCancelOutcome> {
    const path = `/admin/orders/${encodeURIComponent(orderId)}/partial-cancel`;
    const { status, body } = await this.postAdmin(path, {
      requestId: input.requestId,
      items: input.items.map((item) => ({ item_id: item.itemId, quantity: item.quantity })),
    });
    const message = typeof body.message === 'string' ? body.message : `status ${status}`;
    if (status >= 200 && status < 300) {
      return {
        kind: 'cancelled',
        refundAmount: typeof body.refundAmount === 'number' ? body.refundAmount : null,
        shippingDelta: typeof body.shippingDelta === 'number' ? body.shippingDelta : null,
        shippingNotAdjusted: body.shippingNotAdjusted === true,
      };
    }
    if (status === 400 && body.code === 'partial_cancel_rejected') return { kind: 'rejected', message };
    // 본문으로 가린다 — ALB 가 Medusa 다운 때 내는 502 에는 이 본문이 없다
    if (status === 502 && body.type === 'refund_pending') return { kind: 'refund_pending', message };
    this.logger.error(`Failed to partial-cancel Medusa order: ${orderId} (status=${status}, type=${String(body.type)})`, message);
    throw new MedusaHttpError(status, `Medusa partialCancelOrder failed (status=${status}, type=${String(body.type)}): ${message}`);
  }

  /**
   * 관리자 POST 를 네이티브 fetch 로 보낸다. SDK 의 FetchError 는 본문에서 message 만 남기고 type·code 를 버리는데, 취소 응답은
   * 그 둘로 갈린다. HTTP 상태로는 던지지 않는다(분류는 호출부의 일). 연결 실패는 원래 오류를 cause 로 달아 던진다.
   */
  private async postAdmin(path: string, body?: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const encodedKey = Buffer.from(`${this.apiKey}:`).toString('base64');
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${encodedKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
    } catch (error) {
      throw new Error(`Medusa POST ${path} 연결 실패: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const parsed: unknown = await res.json().catch(() => undefined);
    return { status: res.status, body: isJsonObject(parsed) ? parsed : {} };
  }
```

- [ ] **Step 5: 구현 — 옛 역투영**

`inbox-worker.service.ts` 의 `await this.medusaClient.cancelOrder(mapping.channelOrderId);` 를 바꾼다:

```ts
          const outcome = await this.medusaClient.cancelOrder(mapping.channelOrderId);
          // 옛 동작 유지(PR-D 가 이 분기를 지운다): 400·404 는 건너뛴다. 5xx 는 cancelOrder 가 던져 failed 로 남는다 —
          // 그 failed 행을 PR-D 전 대사가 센다(스펙 §11).
          if (outcome.kind !== 'cancelled') {
            this.logger.warn(`[CoreOrderCancelled] Medusa 취소 건너뜀(${outcome.kind}): medusaOrderId=${mapping.channelOrderId}`);
          }
```

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/medusa.client.ts apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts
git commit -m "feat(channel-adapter): Medusa 전체·부분취소 응답을 결과 값으로 — 400 을 성공으로 삼키지 않는다 (#1016 35번 PR-B)"
```

---

### Task 4: 취소 실행기 — 매니저와 리포지토리

**Files:**
- Create: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts`
- Create: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts`
- Create: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.spec.ts`
- Create: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`

**Interfaces:**
- Consumes: Task 1 `CancelChannelOrderPayload`, Task 2 `ChannelOrderCancelRejectedPayload`·`ChannelOrderCancelStalledPayload`·`ChannelOrderCancelRejectionCode`, Task 3 `MedusaClient.cancelOrder`·`partialCancelOrder`, 기존 `OrderPollerOrchestrator.syncOrder(channel: SalesChannel, externalOrderId: string, options?: { force?: boolean }): Promise<{ outcome: OrderSyncOutcome }>`, `getChannelFulfillmentCapabilities(channel: SalesChannel)`
- Produces:
  - `ChannelOrderCancelRepository.hasCollectedOrder(salesChannel: string, externalOrderId: string): Promise<boolean>`
  - `ChannelOrderCancelRepository.recordRejected(payload: ChannelOrderCancelRejectedPayload): Promise<void>`
  - `ChannelOrderCancelRepository.recordStalled(payload: ChannelOrderCancelStalledPayload): Promise<void>`
  - `ChannelOrderCancelManager.execute(command: CancelChannelOrderPayload): Promise<void>` — 정해진 실패면 거절 사실을 내고 정상 반환, 일시 실패면 던진다

- [ ] **Step 1: 실패하는 테스트 — 리포지토리**

```ts
// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.spec.ts
import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';

function makeRepository(rows: unknown[] = []) {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn(() => ({ limit }));
  const select = jest.fn(() => ({ from: jest.fn(() => ({ where })) }));
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx'));
  const repository = new ChannelOrderCancelRepository({ db: { select, transaction } } as never, { enqueue } as never);
  return { repository, enqueue, where };
}

describe('ChannelOrderCancelRepository (#1016 35번 PR-B)', () => {
  const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };

  it('수집 매핑이 있으면 true, 없으면 false', async () => {
    await expect(makeRepository([{ id: 'm1' }]).repository.hasCollectedOrder('medusa', 'order_1')).resolves.toBe(true);
    await expect(makeRepository([]).repository.hasCollectedOrder('medusa', 'order_1')).resolves.toBe(false);
  });

  it('매핑은 채널과 채널 주문 id 둘 다로 찾는다', async () => {
    const { repository, where } = makeRepository([]);
    await repository.hasCollectedOrder('medusa', 'order_1');
    const columns = ((where.mock.calls[0][0] as { queryChunks?: unknown[] }).queryChunks ?? [])
      .flatMap((chunk) => ((chunk as { queryChunks?: unknown[] })?.queryChunks ?? [chunk]))
      .map((chunk) => (chunk as { name?: string })?.name)
      .filter(Boolean);
    expect(columns).toEqual(expect.arrayContaining(['sales_channel', 'channel_order_id']));
  });

  it('거절 사실은 requestId 로 한 번만, 채널 단위 파티션으로 적재한다', async () => {
    const { repository, enqueue } = makeRepository();
    const payload = { ...key, reasonCode: 'NOT_CANCELABLE' as const, message: '출고됨' };
    await repository.recordRejected(payload);
    expect(enqueue).toHaveBeenCalledWith(
      {
        eventType: 'ChannelOrderCancelRejected',
        aggregateId: 'medusa:order_1',
        partitionKey: 'medusa',
        metadata: { partitionKey: 'medusa' },
        idempotencyKey: 'cancel-rejected:req-1',
        payload,
      },
      'tx',
    );
  });

  it('정체 사실도 requestId 로 한 번만 적재한다', async () => {
    const { repository, enqueue } = makeRepository();
    const payload = { ...key, stage: 'edited' as const, message: '환불 미완' };
    await repository.recordStalled(payload);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ChannelOrderCancelStalled', idempotencyKey: 'cancel-stalled:req-1', partitionKey: 'medusa', payload }),
      'tx',
    );
  });
});
```

> 컬럼 이름 단언은 `inbox-worker.service.spec.ts` 의 `queryChunks` 검사와 같은 방식이다. `and(eq(), eq())` 는 청크가 한 겹 더 중첩되므로 펼쳐서 본다. 펼친 결과가 비면 `console.log(JSON.stringify(where.mock.calls[0][0]))` 로 모양을 보고 단언을 맞춘다 — 목적은 «두 컬럼 다 조건에 있다»다.

- [ ] **Step 2: 실패하는 테스트 — 매니저**

```ts
// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { ChannelOrderCancelManager } from './channel-order-cancel.manager';

const full: CancelChannelOrderPayload = {
  requestId: 'req-1',
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  scope: 'full',
  requestedBy: 'operator',
  requestedAt: '2026-10-07T00:00:00.000Z',
};
const partial: CancelChannelOrderPayload = { ...full, scope: 'partial', lines: [{ channelOrderItemId: 'ordli_1', quantity: 2 }] };
const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };

function setup(opts: { mapped?: boolean } = {}) {
  const repository = {
    hasCollectedOrder: jest.fn().mockResolvedValue(opts.mapped ?? true),
    recordRejected: jest.fn().mockResolvedValue(undefined),
    recordStalled: jest.fn().mockResolvedValue(undefined),
  };
  const medusa = { cancelOrder: jest.fn(), partialCancelOrder: jest.fn() };
  const poller = { syncOrder: jest.fn().mockResolvedValue({ outcome: 'emitted' }) };
  const manager = new ChannelOrderCancelManager(repository as never, medusa as never, poller as never);
  return { manager, repository, medusa, poller };
}

describe('ChannelOrderCancelManager (#1016 35번 PR-B)', () => {
  it.each(['naver', 'coupang', '3pl', 'cafe24'])('자동 취소 불가 채널(%s)은 NOT_SUPPORTED — 채널을 부르지 않는다', async (salesChannel) => {
    const { manager, repository, medusa, poller } = setup();
    await manager.execute({ ...full, salesChannel });
    expect(repository.recordRejected).toHaveBeenCalledWith(expect.objectContaining({ salesChannel, reasonCode: 'NOT_SUPPORTED' }));
    expect(repository.hasCollectedOrder).not.toHaveBeenCalled();
    expect(medusa.cancelOrder).not.toHaveBeenCalled();
    expect(poller.syncOrder).not.toHaveBeenCalled();
  });

  it('수집한 적 없는 주문은 ORDER_NOT_FOUND', async () => {
    const { manager, repository, medusa } = setup({ mapped: false });
    await manager.execute(full);
    expect(repository.recordRejected).toHaveBeenCalledWith(expect.objectContaining({ ...key, reasonCode: 'ORDER_NOT_FOUND' }));
    expect(medusa.cancelOrder).not.toHaveBeenCalled();
  });

  describe('전체취소', () => {
    it.each([{ kind: 'cancelled' }, { kind: 'already_cancelled' }])('$kind 면 거절 없이 즉시 재수집한다', async (outcome) => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue(outcome);
      await manager.execute(full);
      expect(medusa.cancelOrder).toHaveBeenCalledWith('order_1');
      expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
      expect(repository.recordRejected).not.toHaveBeenCalled();
    });

    it.each([
      [{ kind: 'not_found', message: 'gone' }, 'ORDER_NOT_FOUND'],
      [{ kind: 'not_cancelable', message: 'fulfilled' }, 'NOT_CANCELABLE'],
    ])('%o 는 %s 거절이고 재수집하지 않는다', async (outcome, reasonCode) => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue(outcome);
      await manager.execute(full);
      expect(repository.recordRejected).toHaveBeenCalledWith({ ...key, reasonCode, message: (outcome as { message: string }).message });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('Medusa 500 은 던진다 — wallet «환불 불가»도 여기로 온다(REFUND_FAILED 미판별). 거절 사실을 내지 않는다', async () => {
      const { manager, repository, medusa } = setup();
      medusa.cancelOrder.mockRejectedValue(new Error('Medusa cancelOrder failed (status=500): An unknown error occurred.'));
      await expect(manager.execute(full)).rejects.toThrow('status=500');
      expect(repository.recordRejected).not.toHaveBeenCalled();
    });

    it('취소는 됐는데 재수집이 실패하면 던진다 — 재시도의 취소는 «이미 취소됨»이라 멱등이다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      poller.syncOrder.mockRejectedValue(new Error('Medusa retrieveOrder failed'));
      await expect(manager.execute(full)).rejects.toThrow('retrieveOrder');
      expect(repository.recordRejected).not.toHaveBeenCalled();
    });
  });

  describe('부분취소', () => {
    it('requestId 와 Medusa 줄 id·취소할 수량을 넘기고, 성공이면 재수집한다', async () => {
      const { manager, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'cancelled', refundAmount: 1000, shippingDelta: 0, shippingNotAdjusted: false });
      await manager.execute(partial);
      expect(medusa.partialCancelOrder).toHaveBeenCalledWith('order_1', { requestId: 'req-1', items: [{ itemId: 'ordli_1', quantity: 2 }] });
      expect(medusa.cancelOrder).not.toHaveBeenCalled();
      expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
    });

    it('정해진 거절은 NOT_CANCELABLE', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'rejected', message: '수량 초과' });
      await manager.execute(partial);
      expect(repository.recordRejected).toHaveBeenCalledWith({ ...key, reasonCode: 'NOT_CANCELABLE', message: '수량 초과' });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('환불 미완이면 정체 사실을 «먼저» 내고 던진다 — 거절도 재수집도 없다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'refund_pending', message: 'PG down' });
      await expect(manager.execute(partial)).rejects.toThrow(/req-1/);
      expect(repository.recordStalled).toHaveBeenCalledWith({ ...key, stage: 'edited', message: 'PG down' });
      expect(repository.recordRejected).not.toHaveBeenCalled();
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('줄 없는 부분취소가 스키마를 뚫고 오면 던진다 — 빈 요청을 Medusa 에 보내지 않는다', async () => {
      const { manager, medusa } = setup();
      await expect(manager.execute({ ...partial, lines: undefined })).rejects.toThrow();
      expect(medusa.partialCancelOrder).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/channel-adapter/src/services/order-cancel`
Expected: FAIL — `Cannot find module './channel-order-cancel.repository'`

- [ ] **Step 4: 구현 — 리포지토리**

```ts
// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import {
  ORDER_STREAM,
  channelOrderPartitionKey,
  type ChannelOrderCancelRejectedPayload,
  type ChannelOrderCancelStalledPayload,
} from '@packages/event-contracts/streams';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';

/** 채널 주문 취소 명령의 DB 쪽 — 수집 매핑 확인과 결과 사실의 아웃박스 적재 (#1016 35번 행). */
@Injectable()
export class ChannelOrderCancelRepository {
  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
    @InjectPublisher(ORDER_STREAM)
    private readonly orders: PublisherFor<typeof ORDER_STREAM>,
  ) {}

  /** 우리가 수집한 주문인가. 수집하지 않은 주문 id 로 채널을 건드리지 않는다. */
  async hasCollectedOrder(salesChannel: string, externalOrderId: string): Promise<boolean> {
    const [row] = await this.db.db
      .select({ id: wmsOrderMappings.id })
      .from(wmsOrderMappings)
      .where(and(eq(wmsOrderMappings.salesChannel, salesChannel), eq(wmsOrderMappings.channelOrderId, externalOrderId)))
      .limit(1);
    return row !== undefined;
  }

  async recordRejected(payload: ChannelOrderCancelRejectedPayload): Promise<void> {
    await this.db.db.transaction((tx) =>
      this.orders.enqueue(
        {
          eventType: 'ChannelOrderCancelRejected',
          aggregateId: channelOrderPartitionKey(payload.salesChannel, payload.externalOrderId),
          // 수집 사실(OrderCreated·OrderModified·OrderCancelled)과 같은 키 — 같은 채널 안에서 순서가 유지된다
          partitionKey: payload.salesChannel,
          metadata: { partitionKey: payload.salesChannel },
          // 같은 명령이 두 번 와도(최소 1회 전달) 사실은 한 번
          idempotencyKey: `cancel-rejected:${payload.requestId}`,
          payload,
        },
        tx,
      ),
    );
  }

  async recordStalled(payload: ChannelOrderCancelStalledPayload): Promise<void> {
    await this.db.db.transaction((tx) =>
      this.orders.enqueue(
        {
          eventType: 'ChannelOrderCancelStalled',
          aggregateId: channelOrderPartitionKey(payload.salesChannel, payload.externalOrderId),
          partitionKey: payload.salesChannel,
          metadata: { partitionKey: payload.salesChannel },
          // 재시도마다 다시 오지만 core 에겐 같은 값(stage=edited)이다
          idempotencyKey: `cancel-stalled:${payload.requestId}`,
          payload,
        },
        tx,
      ),
    );
  }
}
```

> `enqueue` 의 `tx` 타입은 `order-poller.orchestrator.ts` 가 `this.db.db.transaction(async (tx) => … enqueue(…, tx))` 로 이미 넘기는 것과 같다.

- [ ] **Step 5: 구현 — 매니저**

```ts
// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts
import { Injectable, Logger } from '@nestjs/common';
import type { CancelChannelOrderPayload, ChannelOrderCancelRejectionCode } from '@packages/event-contracts/streams';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { getChannelFulfillmentCapabilities } from '../channel-capabilities';
import { OrderPollerOrchestrator } from '../order-collection/order-poller.orchestrator';
import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';

type Rejection = { reasonCode: ChannelOrderCancelRejectionCode; message: string };

/**
 * core 의 `CancelChannelOrder` 를 채널에 실행한다 (#1016 35번 행, ADR-0042 · 스펙 §7.3).
 *
 * 정해진 실패는 `ChannelOrderCancelRejected` 를 내고 정상 종료한다 — 재시도해도 같다.
 * 일시 실패(채널 5xx·네트워크·재수집 실패)는 던져 재시도·DLQ 를 탄다. 채널 호출이 멱등이라 다시 해도 안전하다:
 * 전체는 «이미 취소됨»이 성공이고, 부분은 Medusa 가 같은 requestId 의 진행 단계부터 이어 간다.
 * 성공은 사실로 내지 않는다(D11) — 즉시 재수집한 `OrderCancelled`/`OrderModified` 가 곧 사실이다.
 */
@Injectable()
export class ChannelOrderCancelManager {
  private readonly logger = new Logger(ChannelOrderCancelManager.name);

  constructor(
    private readonly repository: ChannelOrderCancelRepository,
    private readonly medusaClient: MedusaClient,
    private readonly orderPoller: OrderPollerOrchestrator,
  ) {}

  async execute(command: CancelChannelOrderPayload): Promise<void> {
    const { requestId, salesChannel, externalOrderId } = command;
    // 실행기가 Medusa 하나뿐이라 채널 이름을 함께 본다 — 다른 채널이 능력을 켜면 여기에 실행기를 더해야 하고, 그 전엔 거절한다
    if (salesChannel !== 'medusa' || !getChannelFulfillmentCapabilities(salesChannel)?.automatedCancellation) {
      return this.reject(command, { reasonCode: 'NOT_SUPPORTED', message: `${salesChannel} 주문은 자동 취소를 지원하지 않습니다` });
    }
    if (!(await this.repository.hasCollectedOrder(salesChannel, externalOrderId))) {
      return this.reject(command, { reasonCode: 'ORDER_NOT_FOUND', message: `수집된 적 없는 주문입니다: ${salesChannel}:${externalOrderId}` });
    }

    const rejection = command.scope === 'full' ? await this.cancelFull(command) : await this.cancelPartial(command);
    if (rejection) return this.reject(command, rejection);

    const { outcome } = await this.orderPoller.syncOrder(salesChannel, externalOrderId, { force: true });
    this.logger.log(`[CANCEL] ${requestId} ${salesChannel}:${externalOrderId} ${command.scope} 완료 → 재수집 ${outcome}`);
  }

  private async cancelFull(command: CancelChannelOrderPayload): Promise<Rejection | undefined> {
    const outcome = await this.medusaClient.cancelOrder(command.externalOrderId);
    switch (outcome.kind) {
      case 'cancelled':
      case 'already_cancelled':
        return undefined;
      case 'not_found':
        return { reasonCode: 'ORDER_NOT_FOUND', message: outcome.message };
      case 'not_cancelable':
        return { reasonCode: 'NOT_CANCELABLE', message: outcome.message };
    }
  }

  private async cancelPartial(command: CancelChannelOrderPayload): Promise<Rejection | undefined> {
    const { requestId, salesChannel, externalOrderId } = command;
    if (!command.lines || command.lines.length === 0) {
      throw new Error(`부분취소 명령에 줄이 없습니다: ${requestId}`);
    }
    const outcome = await this.medusaClient.partialCancelOrder(externalOrderId, {
      requestId,
      items: command.lines.map((line) => ({ itemId: line.channelOrderItemId, quantity: line.quantity })),
    });
    switch (outcome.kind) {
      case 'cancelled':
        return undefined;
      case 'rejected':
        return { reasonCode: 'NOT_CANCELABLE', message: outcome.message };
      case 'refund_pending':
        // 주문은 줄었는데 돈은 아직 — core 가 정체 보드에서 이 상태를 따로 보이게 진행 사실을 먼저 내고, 던져서 재시도한다
        await this.repository.recordStalled({ requestId, salesChannel, externalOrderId, stage: 'edited', message: outcome.message });
        throw new Error(`부분취소 환불 미완(${requestId}): ${outcome.message}`);
    }
  }

  private async reject(command: CancelChannelOrderPayload, rejection: Rejection): Promise<void> {
    const { requestId, salesChannel, externalOrderId } = command;
    this.logger.warn(`[CANCEL] ${requestId} ${salesChannel}:${externalOrderId} 거절 ${rejection.reasonCode}: ${rejection.message}`);
    await this.repository.recordRejected({ requestId, salesChannel, externalOrderId, ...rejection });
  }
}
```

> `salesChannel !== 'medusa' ||` 뒤에서 `salesChannel` 은 `'medusa'` 로 좁혀지므로 `getChannelFulfillmentCapabilities(salesChannel)` 가 `SalesChannel` 인자를 받는다. `syncOrder` 의 첫 인자도 같다.

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/channel-adapter/src/services/order-cancel`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/channel-adapter/src/services/order-cancel
git commit -m "feat(channel-adapter): 채널 주문 취소 실행기 — 능력·매핑 확인, 결과 분류, 거절·정체 사실, 즉시 재수집 (#1016 35번 PR-B)"
```

---

### Task 5: 소비자 처리기와 모듈 등록

**Files:**
- Modify: `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts` (import + `MedusaClient` 가 있는 비데모 providers 블록)
- Test: `apps/channel-adapter/src/consumers/channel-orders-command.consumer.spec.ts`

**Interfaces:**
- Consumes: Task 4 `ChannelOrderCancelManager.execute(command: CancelChannelOrderPayload): Promise<void>`
- Produces: `ChannelOrdersCommandConsumer.handleCancel(payload, envelope): Promise<void>` — `@On(CHANNEL_ORDERS_COMMAND_STREAM, 'CancelChannelOrder')`

- [ ] **Step 1: 실패하는 테스트**

`channel-orders-command.consumer.spec.ts`:

1. import 에 `import type { ChannelOrderCancelManager } from '../services/order-cancel/channel-order-cancel.manager';` 를 더한다
2. `consumerWith` 를 바꾼다:

```ts
function consumerWith(syncOrder: jest.Mock, execute: jest.Mock = jest.fn()) {
  return new ChannelOrdersCommandConsumer(
    { syncOrder } as unknown as OrderPollerOrchestrator,
    { execute } as unknown as ChannelOrderCancelManager,
  );
}
```

3. 파일 끝에 더한다:

```ts
describe('ChannelOrdersCommandConsumer — CancelChannelOrder (#1016 35번 행)', () => {
  const command = {
    requestId: 'req-1',
    salesChannel: 'medusa',
    externalOrderId: 'order_1',
    scope: 'full' as const,
    requestedBy: 'operator' as const,
    requestedAt: '2026-10-07T00:00:00.000Z',
  };

  it('명령을 실행기에 그대로 넘긴다', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    await consumerWith(jest.fn(), execute).handleCancel(command, envelope);
    expect(execute).toHaveBeenCalledWith(command);
  });

  it('실행기의 예외는 삼키지 않는다 — 재시도·DLQ 를 탄다', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('Medusa cancelOrder failed (status=503)'));
    await expect(consumerWith(jest.fn(), execute).handleCancel(command, envelope)).rejects.toThrow('503');
  });

  it('실행기·리포지토리가 adapter.module providers 에 등록돼 있다 — 빠지면 부팅 DI 가 죽는다', () => {
    const source = readFileSync(join(__dirname, '..', 'adapter.module.ts'), 'utf8');
    const providers = source.slice(source.indexOf('providers: ['));
    expect(providers).toMatch(/\bChannelOrderCancelManager\b/);
    expect(providers).toMatch(/\bChannelOrderCancelRepository\b/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/consumers/channel-orders-command.consumer.spec.ts`
Expected: FAIL — `handleCancel is not a function`, providers 단언 실패

- [ ] **Step 3: 구현 — 소비자**

`channel-orders-command.consumer.ts`:

- import 에 `import { ChannelOrderCancelManager } from '../services/order-cancel/channel-order-cancel.manager';`
- 클래스 주석 끝에 한 줄: ` * «취소»(35번 행)는 `ChannelOrderCancelManager` 가 채널에 실행하고, 결과는 재수집 또는 `ChannelOrderCancelRejected` 로 돌아간다.`
- 생성자: `constructor(private readonly orderPoller: OrderPollerOrchestrator, private readonly cancelManager: ChannelOrderCancelManager) {}`
- `handleResync` 아래에:

```ts
  @On(CHANNEL_ORDERS_COMMAND_STREAM, 'CancelChannelOrder')
  async handleCancel(
    @EventPayload() payload: EventPayloadOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'CancelChannelOrder'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof CHANNEL_ORDERS_COMMAND_STREAM, 'CancelChannelOrder'>,
  ): Promise<void> {
    this.logger.log(`[CANCEL] ${payload.requestId} ${payload.salesChannel}:${payload.externalOrderId} ${payload.scope} 수신`, {
      correlationId: envelope.correlationId,
    });
    await this.cancelManager.execute(payload);
  }
```

- [ ] **Step 4: 구현 — 모듈 등록**

`adapter.module.ts`:
- import 두 줄: `import { ChannelOrderCancelManager } from './services/order-cancel/channel-order-cancel.manager';`, `import { ChannelOrderCancelRepository } from './services/order-cancel/channel-order-cancel.repository';`
- `MedusaClient` 가 든 `...(!IS_SAFE_DEMO_MODE ? [MedusaClient, …, InboxWorkerService] : [])` 블록의 `InboxWorkerService,` 아래에 `ChannelOrderCancelRepository,` `ChannelOrderCancelManager,` 를 더한다 (소비자도 비데모 controllers 에만 있으니 짝이 맞는다)

- [ ] **Step 5: 통과 확인 + 앱 빌드**

Run: `npx jest apps/channel-adapter/src/consumers && npx nest build channel-adapter`
Expected: PASS, 빌드 성공

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts apps/channel-adapter/src/consumers/channel-orders-command.consumer.spec.ts apps/channel-adapter/src/adapter.module.ts
git commit -m "feat(channel-adapter): CancelChannelOrder 명령 처리기 (#1016 35번 PR-B)"
```

---

### Task 6: 게이트와 문서

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md`
- Modify: `apps/channel-adapter/CLAUDE.md`
- Modify: `libs/shared/src/streams/README.md`

- [ ] **Step 1: 게이트**

Run (차례로):
```bash
npm run type-check
npx jest --maxWorkers=2
git diff --stat origin/develop -- apps/medusa
```
Expected: type-check 에러 0, jest 실패 0, 마지막 명령 출력 없음(`apps/medusa` 를 건드리지 않았다). 하나라도 빨가면 고치고 다시 돈다. 개수를 셀 땐 `tail` 로 자른 출력에서 세지 않는다.

- [ ] **Step 2: 스펙 반영**

`2026-10-07-channel-order-cancel-design.md` 에 아래를 반영한다(문장은 그 자리의 문체에 맞춘다):

- §7.2 표 `REFUND_FAILED` 행 뒤에: «**지금은 내지 않는다**(사용자 결정 2026-10-07). Medusa 가 MedusaError 아닌 오류를 500 `unknown_error` 로 가려, wallet 거절과 장애를 channel-adapter 가 구분할 수 없다. 일시 실패로 재시도 → DLQ → 5분 정체 보드(사유 없음, [요청 접기]로 정리). 값은 계약에 남긴다 — 켜려면 almond-payment 가 wallet «환불 불가» 400 을 `MedusaError(NOT_ALLOWED)` + 표지로 바꾸고 channel-adapter 가 그 표지를 읽는다(Medusa 만의 후속)»
- §2 성공 기준 4 끝에: «(전체취소의 wallet «환불 불가»는 사유 없이 정체 보드로만 보인다 — §7.2)»
- §7.3 «실패 분류» 끝에: «Medusa JS SDK 의 `FetchError` 는 본문의 `type`·`code` 를 버린다 — 두 취소 호출은 네이티브 fetch 로 부른다. 전체취소는 `requestId` 를 Medusa 에 넘기지 않는다(코어 라우트가 받지 않는다) — 멱등은 «이미 취소됨 = 성공»이다. 옛 역투영(`CoreOrderCancelled`)은 같은 결과 값을 받아 지금 동작(400·404 건너뜀, 5xx 는 실패)을 유지한다»
- §10-5 에 답: «**답(2026-10-07): 조용히 버린다.** 전역 `SchemaValidationInterceptor` 가 경고만 남기고 `EventTypeGuard` 가 정상 종료해 오프셋이 넘어간다. PR-C 롤링 중엔 반대로 옛 core 가 `ChannelOrderCancelRejected`·`Stalled` 를 버린다 — 둘 다 5분 정체 보드가 받는다»
- §11 표 B 행 «배포 직후»: «보내는 쪽 없음. `apps/medusa` 는 건드리지 않는다»

- [ ] **Step 3: `apps/channel-adapter/CLAUDE.md`**

3-5 절의 «core 는 이 앱을 직접 부르지 않는다 … (지금은 `ResyncChannelOrder` — #1016 6번 행)» 줄을 바꾼다:

```md
- core 는 이 앱을 직접 부르지 않는다. 채널 쪽 일을 원하면 `channel-orders.commands.v1` 에 명령을 낸다 — `ResyncChannelOrder`(#1016 6번 행), `CancelChannelOrder`(35번 행: 채널에 취소·부분취소를 요청하고 결과는 재수집 또는 `ChannelOrderCancelRejected`/`Stalled` 로 돌려준다, `services/order-cancel/`). 소비자는 `consumers/channel-orders-command.consumer.ts`.
```

- [ ] **Step 4: `libs/shared/src/streams/README.md`**

`OrderMerged` 행(199행 근처) 아래에 같은 표 형식으로 두 행:

```md
| `ChannelOrderCancelRejected` | 채널이 core 의 취소 요청을 거절 (#1016 35번) | `requestId`, `reasonCode`, `message` |
| `ChannelOrderCancelStalled` | 부분취소가 수정 뒤 환불에서 멈춤(진행 사실) | `requestId`, `stage` |
```

그 README 에 명령 스트림 표가 있으면 `CancelChannelOrder` 행도 같은 형식으로 더한다. 없으면 건너뛴다.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md apps/channel-adapter/CLAUDE.md libs/shared/src/streams/README.md
git commit -m "docs: PR-B 의 계획 단계 발견(SDK 본문 유실·REFUND_FAILED 미판별·§10-5 답)을 스펙에 반영 (#1016 35번 PR-B)"
```

---

## 배포 메모 (PR 설명에 옮길 것)

- **배포 직후 효과 없음** — `CancelChannelOrder` 를 보내는 쪽(PR-C core)이 없다. 마이그레이션 0
- `apps/medusa` 변경 없음. 옛 역투영(`CoreOrderCancelled`)의 동작도 같다(400·404 건너뜀, 5xx 실패)
- **PR-C 로 넘길 것:** core 가 `ChannelOrderCancelRejected`·`ChannelOrderCancelStalled` 처리기를 둔다. **두 처리기는 같은 `requestId` 의 반복을 무해하게 받아야 한다** — channel-adapter 는 사실을 «명령 전달 단위»(`${requestId}:${envelope.messageId}`)로 멱등 처리하므로, [다시 보내기]마다 같은 사실이 다시 올 수 있다(최종 리뷰 반영, 일부러 그렇게 했다: 첫 사실이 유실돼도 다시 보내기가 사유를 다시 낸다). PR-C 롤링 중 옛 core 태스크는 이 사실을 **조용히 버린다**(§10-5 답) — 요청이 `requested` 로 남아 5분 정체 보드가 받는다. 명령의 `lines[].channelOrderItemId` 는 Medusa 줄 id 여야 한다 — 수집 때 `OrderCreated.items[].orderItemId` 로 들어온 값(`medusa-order.source.ts:115`)을 core 가 어디에 들고 있는지 PR-C 계획에서 확인
