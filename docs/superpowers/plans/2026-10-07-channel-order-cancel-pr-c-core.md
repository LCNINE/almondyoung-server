# 채널 주문 취소 PR-C (core 문지기 + 화면 셋) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채널(Medusa) 주문의 운영자·고객·wallet 환불 승인 취소를 «core 가 판정 → 요청 기록 + 출고 보류 → `CancelChannelOrder` 명령 → 수집으로 확정»으로 바꾸고, core 가 채널 주문 취소에서 wallet 을 부르지 않게 한다. 거절·정체는 사유와 함께 운영자에게 보이고, 화면 셋(admin-web·스토어프론트·창고 앱)이 «처리 중 → 완료»를 그린다.

**Architecture:** 요청은 새 테이블 없이 `sales_order_amendments` 한 행(`status = 'requested'`, `reason_code = 'CHANNEL_CANCEL_REQUEST'`)이다. 행 id 가 명령의 `requestId` 다. core 의 새 폴더 `sales-order/channel-cancel-request/` 가 요청(manager)·확정(settler)·조회(reader)를 맡고, 기존 취소 코드에서 «계획»(부작용 없는 판정)을 떼어 요청 때 쓴다. 보류는 그 행의 존재가 곧 보류이고, 관문 셋이 `fulfillment/hold/` 의 한 함수로 묻는다. 부분취소의 «어디까지 처리됐나»는 channel-adapter 가 Medusa `metadata.partialCancels` 를 `OrderModified.snapshot.cancelRequests` 로 실어 core 에 알린다(사용자 결정 2026-10-07 — 아래 «계획 단계 발견» 1).

**Tech Stack:** NestJS, drizzle(postgres.js), `@app/events`(아웃박스 `enqueue`), zod 4 계약, jest(core·admin-web), vitest(스토어프론트·창고 앱), Next.js 15(admin-web·스토어프론트), Tauri+React(창고 앱).

**Spec:** `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` (§4~§5 core, §7.1~7.2 계약, §7.4 admin-web, §7.5 스토어프론트, §8~§9 경합, §11 PR-C, §12 테스트). ADR-0042. 앞선 계획: `…-pr-a-medusa.md`(PR #1024), `…-pr-b-channel-adapter.md`(PR #1025, 둘 다 develop 머지).

## Global Constraints

- 요청 행: `origin = 'operator'`, `amendment_kind = 'commercial'`, `reason_code = 'CHANNEL_CANCEL_REQUEST'`, `status ∈ requested | applied | rejected | superseded`. **행 id = 명령 `requestId`**
- 한 판매주문에 `status = 'requested'` 행은 **하나** — 부분 유니크 인덱스 `uq_sales_order_amendments_open_cancel_request`. 늦게 온 요청(같은 키든 다른 키든)은 열린 요청을 돌려받는다
- `metadata.request.requestedBy` = `admin:<actorId>` | `customer:<customerId>` | `wallet-refund-approval:<intentId>`. `sourceKey` = 운영자·고객은 `Idempotency-Key`, wallet 승인은 `wallet-refund-approval:<intentId>`
- 명령: 토픽 `channel-orders.commands.v1`, `eventType: 'CancelChannelOrder'`, `aggregateId = partitionKey = channelOrderPartitionKey(salesChannel, externalOrderId)`, 아웃박스 `idempotencyKey = cancel-request:<requestId>`(다시 보내기는 `cancel-request:<requestId>:resend:<epochMs>`)
- 명령을 보내는 채널은 `medusa` 하나. `naver`·`coupang` 은 요청을 거절한다(문구 `네이버 판매자센터에서 취소해 주세요.` / `쿠팡 판매자센터에서 취소해 주세요.`). 그 밖(`3pl`)은 지금 경로 그대로(core 취소 + 지금의 환불 기록)
- 보류 거절 사유 문자열은 `CANCEL_REQUESTED`, 문구 `취소 처리 중인 주문이 있습니다`. 관문 셋 = 송장 발급(`issueForShipment`·`issueBatch` 가 그 안에서 부름) · 배치 시작/합류 · 발송 사전검사(`assertDispatchable`)
- 정체 보드 단계 `cancel_request`, 기준 **5분**. 세부 상태 `cancel_requested`(«취소 요청 미반영») · `cancel_edited`(«수정됨 · 환불 미완»)
- 거절·정체 사실 처리기는 **같은 `requestId` 반복을 무해하게** 받는다(PR-B 가 사실을 «명령 전달 단위»로 멱등 처리해 [다시 보내기]마다 다시 올 수 있다). `requested` 가 아닌 행에 온 사실은 무시한다
- core 는 채널 주문 취소에서 `WalletRefundClient` 를 부르지 않고 channel-adapter 를 직접 부르지 않는다. `retryWalletRefund`·`adminManualRefundComplete`·`partial-cancellation-refund-calculator` 는 옛 기록·`3pl` 경로를 위해 남긴다
- Service 는 `@app/shared` 도메인 예외(`BadRequestError`·`ConflictError`·`NotFoundError`)를 던진다. 기존 `SalesOrdersService`·`StoreSalesOrdersService` 가 Nest 예외를 쓰는 곳은 그대로 둔다
- 마이그레이션은 additive(CHECK 값 추가 + 인덱스) — 배포는 **`migrate → deploy`**
- 검증 게이트: 루트 `npm run type-check` 0 · `npx jest --maxWorkers=2` 0 · `(cd apps/admin-web && npx tsc --noEmit)` 0 · `npm run test:admin-web` 0 · 스토어프론트 `npx tsc --noEmit -p web/almondyoung-storefront/tsconfig.json` 0 + `vitest run` 0 · `(cd native/warehouse-app && npx tsc -b && npx vitest run)` 0 · core 통합 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>` 초록

## 계획 단계에서 스펙과 달라진 점 (Task 16 이 스펙에 반영)

1. **부분취소 확정은 델타 일치만으로 판정하지 않는다(사용자 결정 2026-10-07).** Medusa 부분취소는 주문 수정을 먼저 확정하고 환불은 그 뒤다. 환불이 실패해도 주문의 수량·합계는 이미 줄어 있어 5분 폴링이 `OrderModified` 를 낸다(`channel-order.translator.ts` 의 `changes` 해시에 items·total 이 들어간다). 스펙 §5.4 대로 «델타가 같으면 `applied`» 면 core 가 환불 전에 요청을 닫고 보류를 풀어 «수정됨 · 환불 미완»이 정체 보드에서 사라진다. 환불이 나중에 성공해도 items·total 은 그대로라 `OrderModified` 가 다시 오지 않는다. → channel-adapter 가 Medusa `order.metadata.partialCancels[requestId]` 를 `OrderModified.snapshot.cancelRequests?` 로 싣고 «있을 때만» 해시 입력에도 넣는다. core 는 `edited` 면 물리 취소만 반영하고 요청을 연 채 `stage = 'edited'`, `refunded` 면 `applied` 로 닫고 `outcome`(환불액·배송비)을 채운다. 이 때문에 PR-C 가 **계약과 channel-adapter 를 조금 건드린다**(`apps/medusa` 는 건드리지 않는다). 스펙 §7.4 의 «환불 27,500원 · 배송비 −3,000원» 도 이 값으로만 채울 수 있었다 — 환불 note(`partial-cancel:<requestId>`)는 수집에서 버려진다
2. **델타가 요청과 어긋나면 요청을 `superseded` 로 닫는다**(스펙 §12 «안 맞음»의 결과가 비어 있었다). Medusa 가 그 `requestId` 를 처리했다고 말하는데 core 의 유효 수량과 델타가 다르면 누군가 그사이 core 쪽을 바꾼 것이다. 델타는 5번 규칙을 타 «반영 대기 변경»에 남고 운영자가 거기서 본다. `superseded_by_id` 는 비운다 — 채널 행이 같은 트랜잭션에서 나중에 들어가 FK 가 즉시 검사에 걸린다. 사유는 `metadata.supersededReason = 'CHANNEL_CHANGE_MISMATCH'`. 물리 취소가 도메인 거절되면 같은 처리에 `APPLY_REFUSED`
3. **부분 요청이 주문에 남는 수량을 0 으로 만들면 전체취소로 보낸다.** Medusa 부분취소로 줄을 다 빼면 «취소되지 않은 0줄 주문»이 남고, core 의 5번 diff 도 `ALL_LINES_REMOVED` 대기로 빠진다
4. **31번 전환과 거절 문구 외에 «채널 줄 번호가 없는 줄»의 부분 요청은 400 이다.** 명령의 `lines[].channelOrderItemId` 는 `sales_order_lines.channel_order_item_id`(수집 때 `OrderCreated.items[].orderItemId`, 곧 Medusa 줄 id)다 — PR-B 가 넘긴 질문의 답. 비어 있으면 채널에 줄을 지목할 길이 없다
5. **보류 관문은 `assertDispatchable` 한 곳에 걸고, 송장 발급만 따로 건다.** `assertDispatchable` 은 발송·배치 시작·합류·시작 전 추가·송장 라벨 렌더가 모두 거친다 — 보류 중엔 **라벨 렌더도 막힌다**(의도: 보류는 출고 전체를 멈춘다). 송장 발급은 `assertDispatchable` 을 안 거치므로 명령 트랜잭션 안에서 박스 행을 `FOR UPDATE` 로 잠근 뒤 묻는다. 원래 아무것도 잠그지 않았다 — 요청 트랜잭션과 직렬화하려면 같은 행을 잠가야 한다
6. **배치 시작·합류의 차단 사유에 `CANCEL_REQUESTED` 를 더한다**(`StartBlockReason`). `WAYBILL_NOT_READY` 에 섞으면 현장이 «송장 재발급 필요»로 읽는다. 창고 앱은 모르는 사유를 버리므로(`batchStart.ts` `isBlocker`) 앱도 함께 고친다 — 앱 배포 전에는 그 박스가 차단 목록에서 빠져 보인다
7. **전체취소 «성공»의 환불액은 기록하지 않는다.** Medusa 전체취소는 `partialCancels` 를 남기지 않는다. 고객 화면의 환불 요약은 수집된 환불(`order_lifecycle_refund_collected`)의 합으로 만든다(스펙 §7.5 그대로)
8. **wallet 환불 승인 경로(`cancel-by-intent`)는 31번 전환을 하지 않는다.** 돈은 이미 wallet 에서 다 나갔고 Medusa 장부에는 §6.4 투영으로 들어가 있다 — 전체취소 요청이 맞다. 출고된 몫이 있어 Medusa 가 거절하면 `NOT_CANCELABLE` 로 돌아온다
9. **스토어프론트 주문 상세의 합계(스펙 §7.5 마지막 항목) — 코드로는 판정 못 했다.** 상세는 Medusa `sdk.store.order.retrieve` 의 `item_total`·`discount_total`·`shipping_total`·`total` 을 그대로 그리고(`order-details-desktop.tsx` L404~462, 모바일 L245~299), 크레딧 라인 필드는 요청하지도 그리지도 않는다. 배송비 환불이 크레딧 라인으로 들어간 주문에서 `total` 이 그만큼 줄어드는지에 따라 «총 결제금액»이 설명 없는 숫자가 될 수 있다. 이 PR 은 화면을 바꾸지 않고 **수동 스모크 «조건부 무료배송 미달·그룹 통째 취소» 에서 상세 합계를 눈으로 확인**한다 — 어긋나면 후속 이슈
10. **§10-5 의 반대 방향:** PR-C 롤링 중 옛 core 태스크는 `ChannelOrderCancelRejected`·`Stalled` 를 조용히 버린다(PR-B 계획 «PR-C 로 넘길 것»). 요청은 `requested` 로 남아 5분 정체 보드가 받는다 — 코드로 막을 일이 아니라 배포 메모에 남긴다

## Review Focus

1. **같은 `Idempotency-Key` 가 요청이 닫힌 뒤 다시 온다**(브라우저 재전송·두 번 클릭) — 새 요청을 만들지 말고 그 키의 행을 돌려줘야 한다. 고객 경로는 «이미 취소된 주문입니다» 400 보다 먼저 돌려줘야 한다. Task 5·Task 6 테스트
2. **부분취소가 `edited` 로 먼저 오고 `refunded` 가 나중에 델타 0 으로 온다** — 물리 취소는 한 번만, 요청은 두 번째에 닫혀야 한다. 두 번째 `OrderModified` 는 델타가 없어도 처리돼야 한다. Task 8 테스트
3. **[다시 보내기]마다 같은 거절·정체 사실이 다시 온다** — 이미 `rejected`·`applied` 인 행을 바꾸면 안 되고, 정체는 두 번 와도 행이 같아야 한다. 사실의 `requestId` 가 uuid 가 아니어도 DLQ 로 가지 않고 무시한다. Task 9 테스트
4. **요청과 송장 발급·배치 시작이 동시에 온다** — 요청 트랜잭션이 박스 행을 잠그고 관문이 같은 행을 잠근 뒤 묻는다. 실 DB 두 커넥션으로 요청이 박스 행을 쥐고 있는 동안 관문 쪽 잠금이 기다리는지 본다. Task 7 테스트
5. **열린 요청이 있는데 채널이 주소만 바꾼 `OrderModified` 가 온다** — 요청 행이 «반영 대기 변경» 목록에 섞이거나 5번의 `superseded` 처리에 휩쓸리면 안 된다(그 처리는 `origin = 'channel'` 만 본다). Task 8 테스트

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `packages/event-contracts/streams/orders.stream.ts` | `OrderModifiedCancelRequest`, `snapshot.cancelRequests?` (Task 1) |
| `packages/event-contracts/streams/__tests__/order-modified-cancel-requests.spec.ts` (신규) | (Task 1) |
| `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts` | `ChannelOrderSnapshot.cancelRequests?` (Task 2) |
| `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts` | `OrderFetchItem.changes.cancelRequests?` (Task 2) |
| `apps/channel-adapter/src/services/order-collection/medusa-order.source.ts` | `metadata.partialCancels` → `cancelRequests` (Task 2) |
| `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts` | `modification`·`changes` 에 «있을 때만» (Task 2) |
| `apps/channel-adapter/src/services/order-collection/{medusa-order-collection,channel-order.translator}.spec.ts` | (Task 2) |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` · `apps/core/drizzle/<ts>_add-channel-cancel-request.sql` + `meta/` | 상태 두 값 + 열린 요청 유니크 (Task 3) |
| `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts` · `dto/list-sales-order-amendments.dto.ts` | 상태 타입 (Task 3) |
| `apps/core/src/modules/sales-order/services/sales-orders.service.ts` | `planCancellation`, `planV2Outstanding` 추출, `getOne().cancelRequest` (Task 4·5) |
| `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-route.ts` (+spec) | 채널 → 명령/판매자센터/core (Task 5) |
| `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts` (+spec) | 메타데이터 스키마·뷰 (Task 5) |
| `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.reader.ts` | 조회 (Task 5) |
| `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts` | 요청·거절·정체·다시 보내기·접기 (Task 5·9) |
| `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.service.ts` | 포트 (Task 5·9) |
| `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-match.ts` (+spec) | 요청 줄 ↔ 5번 델타 (Task 8) |
| `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settler.ts` | 확정 (Task 8) |
| `apps/core/src/modules/sales-order/channel-cancel-request/__support__/cancel-request.fixtures.ts` | 통합 스펙 배선·시드 (Task 5) |
| `apps/core/src/modules/sales-order/channel-cancel-request/*.integration.spec.ts` | (Task 5·7·8·9) |
| `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (+spec) · `dto/store-order-actions.dto.ts` | 요청자 셋, 액션 뷰 (Task 6·10) |
| `apps/core/src/modules/sales-order/controllers/sales-orders.controller.ts` | 다시 보내기·접기 (Task 9) |
| `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` (+spec) | 사실 처리기, 전체취소 확정 (Task 8·9) |
| `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts` (+integration spec) | 열린 요청이 먹은 델타를 뺀다 (Task 8) |
| `apps/core/src/modules/sales-order/sales-order.module.ts` | 등록 (Task 5·8) |
| `apps/core/src/modules/fulfillment/hold/cancel-request-hold.ts` (+integration spec) | 보류 판정 (Task 7) |
| `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts` (+spec) | 관문 (Task 7) |
| `apps/core/src/modules/fulfillment/picking/allocation/{allocation.types,allocation.locks}.ts` · `services/outbound-batch-orchestrator.service.ts` | `CANCEL_REQUESTED` 차단 사유 (Task 7) |
| `apps/core/src/modules/fulfillment/order-progress/{order-progress.thresholds,order-progress.judge-sql}.ts` (+specs) | 정체 단계 (Task 11) |
| `native/warehouse-app/src/domains/outbound/{batchStart,batchJoin}.ts` (+test) | 새 차단 사유 (Task 12) |
| `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts` (+spec) | 판정·문구 (Task 13) |
| `apps/admin-web/src/…` (client·mutations·use-order-rows·table·cancel modal) | 배선 (Task 13) |
| `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts` (+spec) · `features/order/stall-board/components/stage-orders.tsx` | 정체 단계·조치 (Task 14) |
| `web/almondyoung-storefront/src/lib/api/orders/store-orders.ts` · `src/lib/orders/cancel-outcome.ts` (+test) · 취소 화면 셋 · i18n 3벌 | (Task 15) |
| 스펙 · `apps/core/src/modules/sales-order/sales-order.module.ts` 주석 | 문서 (Task 16) |

---

### Task 1: 계약 — `OrderModified.snapshot.cancelRequests`

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts` (`OrderModifiedPayload` 근처 L105~130, `OrderModifiedSchema` L301~311)
- Create: `packages/event-contracts/streams/__tests__/order-modified-cancel-requests.spec.ts`

**Interfaces:**
- Produces: `export interface OrderModifiedCancelRequest { requestId: string; stage: 'edited' | 'refunded'; refundAmount: number; shippingCharge: number; shippingRefund: number; shippingNotAdjusted: boolean }`, `OrderModifiedPayload['snapshot']['cancelRequests']?: OrderModifiedCancelRequest[]`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { ORDER_STREAM } from '../orders.stream';

describe('OrderModified.snapshot.cancelRequests (#1016 35번 PR-C)', () => {
  const schema = ORDER_STREAM.events.OrderModified.schema!;
  const base = {
    orderId: 'wms-1',
    salesChannel: 'medusa',
    externalOrderId: 'order_1',
    modifiedAt: '2026-10-07T00:00:00.000Z',
    snapshot: {
      lines: [{ channelOrderItemId: 'item_1', channelProductId: 'v_1', quantity: 1, unitPrice: 1000, cancelled: false }],
      shippingAddress: { recipientName: '김', phone: '010', postalCode: '1', roadAddress: '서울', detailAddress: '1' },
    },
  };
  const record = {
    requestId: 'req-1',
    stage: 'refunded',
    refundAmount: 27500,
    shippingCharge: 3000,
    shippingRefund: 0,
    shippingNotAdjusted: false,
  };

  it('없으면 예전 모양 그대로 통과한다', () => {
    expect(schema.parse(base)).toEqual(base);
  });

  it('진행 기록을 그대로 싣는다', () => {
    const payload = { ...base, snapshot: { ...base.snapshot, cancelRequests: [record] } };
    expect(schema.parse(payload)).toEqual(payload);
  });

  it.each([
    ['모르는 단계', { stage: 'canceled' }],
    ['빈 requestId', { requestId: '' }],
    ['음수 환불액', { refundAmount: -1 }],
  ])('%s 는 거절한다', (_label, over) => {
    const payload = { ...base, snapshot: { ...base.snapshot, cancelRequests: [{ ...record, ...over }] } };
    expect(() => schema.parse(payload)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/order-modified-cancel-requests.spec.ts`
Expected: «진행 기록을 그대로 싣는다» FAIL(zod 가 모르는 키를 벗겨 `toEqual` 이 어긋난다), 거절 셋 FAIL

- [ ] **Step 3: 구현**

`OrderModifiedSnapshotLine` 인터페이스 바로 뒤에:

```ts
/**
 * 채널이 core 의 `CancelChannelOrder`(부분취소)를 어디까지 처리했는가 — requestId 별 (#1016 35번 PR-C).
 * Medusa 만 싣는다(`metadata.partialCancels`). 주문 수정이 확정된 뒤 환불이 실패해도 주문은 이미 줄어 있어
 * 이 변경 이벤트가 나간다 — core 는 `edited` 면 요청을 연 채 두고, `refunded` 에서 닫는다.
 */
export interface OrderModifiedCancelRequest {
  requestId: string;
  /** edited: 주문 수정은 확정됐고 환불이 남았다 / refunded: 환불까지 끝났다 */
  stage: 'edited' | 'refunded';
  /** 이번 부분취소로 돌려줄(돌려준) 총액 */
  refundAmount: number;
  /** 조건부 무료 미달 등으로 새로 받은 배송비 */
  shippingCharge: number;
  /** 그룹이 비어 돌려준 배송비 */
  shippingRefund: number;
  /** 스냅샷이 없거나 그룹이 어긋나 배송비를 건드리지 않았다 */
  shippingNotAdjusted: boolean;
}
```

`OrderModifiedPayload.snapshot` 에 `cancelRequests?: OrderModifiedCancelRequest[];` 를 더한다(주석: «없으면 진행 중인 부분취소가 없다. 키를 생략한다 — 빈 배열을 싣지 않는다»).

`OrderModifiedSchema` 위에:

```ts
const OrderModifiedCancelRequestSchema = z.object({
  requestId: z.string().min(1),
  stage: z.enum(['edited', 'refunded']),
  refundAmount: z.number().nonnegative(),
  shippingCharge: z.number().nonnegative(),
  shippingRefund: z.number().nonnegative(),
  shippingNotAdjusted: z.boolean(),
});
```

`snapshot: z.object({ … })` 에 `cancelRequests: z.array(OrderModifiedCancelRequestSchema).optional(),` 를 더한다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/order-modified-cancel-requests.spec.ts`
Expected: PASS 5

- [ ] **Step 5: 커밋**

```bash
git add packages/event-contracts/streams/orders.stream.ts packages/event-contracts/streams/__tests__/order-modified-cancel-requests.spec.ts
git commit -m "feat(event-contracts): OrderModified 가 부분취소 진행 기록을 싣는다 (#1016 35번 PR-C)"
```

---

### Task 2: channel-adapter — Medusa 수집이 `partialCancels` 를 싣는다

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts` (`ChannelOrderSnapshot`)
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts` (`OrderFetchItem.changes`)
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-order.source.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts` (L107~131)
- Test: `apps/channel-adapter/src/services/order-collection/medusa-order-collection.spec.ts`, `channel-order.translator.spec.ts`

**Interfaces:**
- Consumes: `OrderModifiedCancelRequest` (Task 1)
- Produces: `ChannelOrderSnapshot.cancelRequests?: OrderModifiedCancelRequest[]` (비면 키 없음), `OrderFetchItem.changes.cancelRequests?`, `OrderFetchItem.modification.cancelRequests?`

- [ ] **Step 1: 실패하는 테스트 — Medusa 수집**

`medusa-order-collection.spec.ts` 의 `describe` 끝에 더한다. 첫 테스트(L31~)의 주문 객체를 함수로 뽑지 말고 필요한 필드만 둔 최소 주문을 쓴다:

```ts
  describe('부분취소 진행 기록 (#1016 35번 PR-C)', () => {
    const order = (metadata: Record<string, unknown> | undefined) => ({
      id: 'order_pc_1',
      payment_status: 'captured',
      currency_code: 'KRW',
      total: 9000,
      subtotal: 9000,
      shipping_total: 0,
      discount_total: 0,
      created_at: '2026-10-07T00:00:00.000Z',
      updated_at: '2026-10-07T00:05:00.000Z',
      metadata,
      items: [
        {
          id: 'item_1',
          title: 'P',
          quantity: 1,
          unit_price: 9000,
          variant_id: 'variant_1',
          variant: {
            metadata: { pimVariantId: 'pim_variant_1' },
            product: { metadata: { pimMasterId: 'master_1', pimVersionId: 'version_1' } },
          },
        },
      ],
      shipping_address: { first_name: 'J', phone: '010', postal_code: '1', address_1: 'S', address_2: '1' },
    });
    const record = {
      requestHash: 'h',
      stage: 'edited',
      items: [{ item_id: 'item_1', quantity: 1 }],
      refundAmount: 27500,
      shippingCharge: 0,
      shippingRefund: 3000,
      shippingNotAdjusted: false,
      groupFees: {},
      at: '2026-10-07T00:04:00.000Z',
      orderVersion: 2,
    };

    it('metadata.partialCancels 를 requestId 순으로 modification·changes 에 싣는다', async () => {
      const provider = makeProvider({
        listOrders: jest.fn().mockResolvedValue([
          order({ partialCancels: { 'req-b': { ...record, stage: 'refunded' }, 'req-a': record } }),
        ]),
      });
      const [item] = (await provider.fetchOrders(null)).orders;
      const expected = [
        { requestId: 'req-a', stage: 'edited', refundAmount: 27500, shippingCharge: 0, shippingRefund: 3000, shippingNotAdjusted: false },
        { requestId: 'req-b', stage: 'refunded', refundAmount: 27500, shippingCharge: 0, shippingRefund: 3000, shippingNotAdjusted: false },
      ];
      expect(item.modification.cancelRequests).toEqual(expected);
      expect(item.changes.cancelRequests).toEqual(expected);
    });

    it('기록이 없으면 changes 에 키 자체가 없다 — 모든 Medusa 주문의 해시가 바이트 단위로 그대로다', async () => {
      const provider = makeProvider({ listOrders: jest.fn().mockResolvedValue([order(undefined)]) });
      const [item] = (await provider.fetchOrders(null)).orders;
      expect(Object.keys(item.changes).sort()).toEqual(['items', 'shippingAddress', 'totalAmount']);
      expect('cancelRequests' in item.modification).toBe(false);
    });

    it('지운 기록(null)·모르는 단계·숫자 아닌 금액은 버린다', async () => {
      const provider = makeProvider({
        listOrders: jest.fn().mockResolvedValue([
          order({
            partialCancels: {
              'req-null': null,
              'req-weird': { ...record, stage: 'canceled' },
              'req-nan': { ...record, refundAmount: 'x' },
            },
          }),
        ]),
      });
      const [item] = (await provider.fetchOrders(null)).orders;
      expect('cancelRequests' in item.changes).toBe(false);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/services/order-collection/medusa-order-collection.spec.ts -t "부분취소 진행 기록"`
Expected: 첫 테스트 FAIL(`cancelRequests` undefined). 나머지 둘은 지금도 통과할 수 있다 — 그대로 둔다(회귀 방지)

- [ ] **Step 3: 구현**

`channel-order-source.interface.ts` 의 `ChannelOrderSnapshot` 에 (`entrancePassword?` 다음):

```ts
  /**
   * 우리 부분취소 명령(`CancelChannelOrder`)의 채널 쪽 진행 기록 (#1016 35번 PR-C). Medusa 만 낸다.
   * **비면 키를 두지 않는다** — 이 값은 `changes`(해시 입력)에도 들어가는데 빈 배열·undefined 키도
   * `stableStringify` 결과를 바꿔 배포 직후 모든 Medusa 주문이 `OrderModified` 를 낸다.
   */
  cancelRequests?: OrderModifiedCancelRequest[];
```

(파일 상단 import 에 `OrderModifiedCancelRequest` 를 `@packages/event-contracts/streams` 에서 더한다.)

`channel-order-provider.interface.ts` 의 `OrderFetchItem.changes` 에 `cancelRequests?: OrderModifiedCancelRequest[];` 를 더하고 import 한다.

`medusa-order.source.ts`:
- `buildSnapshot` 의 반환 객체에서 `...(entrancePassword ? { entrancePassword } : {}),` 다음 줄에:

```ts
      ...(cancelRequests.length > 0 ? { cancelRequests } : {}),
```

  그리고 `const entrancePassword = …` 다음에 `const cancelRequests = this.readCancelRequests(order);`
- 클래스에 메서드를 더한다(`stringMetadata` 옆):

```ts
  /**
   * 부분취소 진행 기록(`apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts` 의 `PartialCancelRecord`).
   * Medusa metadata 는 병합 갱신이라 지운 기록이 null 로 남는다 — 객체가 아니거나 모양이 어긋난 기록은 버린다.
   * requestId 순으로 정렬해 해시를 안정시킨다.
   */
  private readCancelRequests(order: MedusaOrder): OrderModifiedCancelRequest[] {
    const raw = (order.metadata as Record<string, unknown> | null | undefined)?.partialCancels;
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw as Record<string, unknown>)
      .flatMap(([requestId, value]): OrderModifiedCancelRequest[] => {
        if (!value || typeof value !== 'object') return [];
        const r = value as Record<string, unknown>;
        const stage = r.stage === 'edited' || r.stage === 'refunded' ? r.stage : null;
        const amounts = [r.refundAmount, r.shippingCharge, r.shippingRefund];
        if (!stage || !amounts.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return [];
        return [
          {
            requestId,
            stage,
            refundAmount: r.refundAmount as number,
            shippingCharge: r.shippingCharge as number,
            shippingRefund: r.shippingRefund as number,
            shippingNotAdjusted: r.shippingNotAdjusted === true,
          },
        ];
      })
      .sort((a, b) => a.requestId.localeCompare(b.requestId));
  }
```

  (이 파일은 이미 `order.metadata as Record<string, unknown>` 관용을 쓴다 — 같은 꼴로 둔다. `as number` 셋은 바로 위 `every` 가 좁힌 값이다.) import 에 `OrderModifiedCancelRequest` 를 더한다.

`channel-order.translator.ts` 의 `changes`·`modification` 두 객체 끝에 각각:

```ts
        // 우리 부분취소의 진행 기록(#1016 35번 PR-C). 있을 때만 — 없는 주문의 해시 입력은 예전과 바이트 단위로 같다.
        ...(snapshot.cancelRequests?.length ? { cancelRequests: snapshot.cancelRequests } : {}),
```

(`modification` 쪽에는 주석 없이 한 줄만.)

- [ ] **Step 4: translator 스펙 보강**

`channel-order.translator.spec.ts` 의 «변경 해시 입력의 모양» describe 에 더한다:

```ts
  it('cancelRequests 는 있을 때만 changes·modification 에 실린다 (#1016 35번 PR-C)', async () => {
    const { translator } = makeTranslator(LISTING);
    const record = {
      requestId: 'req-1',
      stage: 'refunded' as const,
      refundAmount: 1000,
      shippingCharge: 0,
      shippingRefund: 0,
      shippingNotAdjusted: true,
    };

    const without = await translator.translate('naver', makeSnapshot());
    const withRecord = await translator.translate('naver', makeSnapshot({ cancelRequests: [record] }));
    if (without.outcome.kind !== 'order' || withRecord.outcome.kind !== 'order') throw new Error('unreachable');

    expect('cancelRequests' in without.outcome.order.changes).toBe(false);
    expect(withRecord.outcome.order.changes.cancelRequests).toEqual([record]);
    expect(withRecord.outcome.order.modification.cancelRequests).toEqual([record]);
  });
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/channel-adapter/src/services/order-collection`
Expected: PASS(기존 «세 개만 담는다» 포함)

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/services/order-collection packages/event-contracts
git commit -m "feat(channel-adapter): Medusa 부분취소 진행 기록을 OrderModified 에 싣는다 — 환불 미완 수정을 core 가 닫지 않게 (#1016 35번 PR-C)"
```

---

### Task 3: core 스키마 — 요청 상태 두 값 + 열린 요청 하나

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`salesOrderAmendments`, L1452~1511)
- Create (generate): `apps/core/drizzle/<timestamp>_add-channel-cancel-request.sql`, `apps/core/drizzle/meta/*`
- Modify: `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts` (L21 `AmendmentStatus`)
- Modify: `apps/core/src/modules/sales-order/dto/list-sales-order-amendments.dto.ts` (status `IsIn`)

**Interfaces:**
- Produces: `salesOrderAmendments.status` 타입 `'applied' | 'pending' | 'superseded' | 'dismissed' | 'requested' | 'rejected'`, 인덱스 `uq_sales_order_amendments_open_cancel_request`

> ⚠️ `db:generate` 는 서브에이전트가 못 돌린다(대화형 프롬프트) — 이 태스크의 Step 2 는 메인 세션이 돌린다.

- [ ] **Step 1: 스키마 수정**

`status` 컬럼:

```ts
    // requested·rejected: 채널 주문 취소 요청(#1016 35번, ADR-0042). requested 인 행이 곧 «출고 보류»다.
    status: varchar('status', { length: 16 })
      .$type<'applied' | 'pending' | 'superseded' | 'dismissed' | 'requested' | 'rejected'>()
      .notNull()
      .default('pending'),
```

테이블 옵션 끝의 `statusCheck` 를:

```ts
    statusCheck: check(
      'sales_order_amendments_status_check',
      sql`${t.status} IN ('applied', 'pending', 'superseded', 'dismissed', 'requested', 'rejected')`,
    ),
    // 한 주문에 열린 취소 요청은 하나(스펙 §5.1) — 늦게 온 요청은 열린 요청을 돌려받는다. 요청 트랜잭션이 판매주문을
    // 먼저 잠가 직렬화하므로 이 인덱스는 코드 밖 경로(손 SQL 등)에 대한 마지막 방어선이다.
    uqOpenCancelRequest: uniqueIndex('uq_sales_order_amendments_open_cancel_request')
      .on(t.salesOrderId)
      .where(sql`${t.status} = 'requested'`),
```

- [ ] **Step 2: 마이그레이션 생성(메인 세션)**

Run: `npm run db:generate:core -- --name add-channel-cancel-request`
Expected: 새 SQL 이 정확히 셋 — `DROP CONSTRAINT "sales_order_amendments_status_check"`, `CREATE UNIQUE INDEX "uq_sales_order_amendments_open_cancel_request" ON "sales_order_amendments" USING btree ("sales_order_id") WHERE "sales_order_amendments"."status" = 'requested'`, `ADD CONSTRAINT "sales_order_amendments_status_check" CHECK (… 6개 값)`. 다른 문장이 있으면 `git rm` 하고 스키마를 고친다(로컬 core DB 에 타 브랜치 마이그 잔재가 있어도 generate 는 스냅샷만 본다)

- [ ] **Step 3: 상태 타입 두 곳**

`sales-order-amendments.service.ts`:

```ts
export type AmendmentStatus = 'applied' | 'pending' | 'superseded' | 'dismissed' | 'requested' | 'rejected';
```

`dto/list-sales-order-amendments.dto.ts` 의 status `@IsIn([...])` 배열에 `'requested', 'rejected'` 를 더한다(목록 조회 필터 — 대기 목록 화면은 여전히 `status=pending&origin=channel` 만 보낸다).

- [ ] **Step 4: 적용·타입 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/services/sales-order-amendments.channel.integration.spec.ts` (러너가 마이그를 먼저 적용한다)
Expected: PASS. 이어서 `npm run type-check` → 0

- [ ] **Step 5: 커밋(스키마 + SQL + meta 한 커밋)**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts apps/core/src/modules/sales-order/dto/list-sales-order-amendments.dto.ts
git commit -m "feat(core): 변경 기록에 취소 요청 상태(requested·rejected)와 열린 요청 하나 (#1016 35번 PR-C)"
```

---

### Task 4: core — 취소의 «계획»을 «적용»에서 뗀다

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`cancelV2Outstanding` L1599~; 타입 L104~)
- Test: `apps/core/src/modules/sales-order/channel-cancel-request/cancellation-plan.integration.spec.ts` (신규)

**Interfaces:**
- Produces:

```ts
export interface CancellationPlan {
  /** 이 취소가 실제로 줄일 판매주문 줄과 수량(0 인 줄 없음). 전체취소면 줄마다 «안 나간·안 취소된» 몫 전부 */
  lines: Array<{ salesOrderLineId: string; quantity: number }>;
  /** 이미 출고된 몫이 있다 — 운영자 전체취소는 31번 전환 대상 */
  hasShippedQuantity: boolean;
  /** 이 취소 뒤 주문에 남는 수량이 0 이다 — 부분 요청이어도 주문 전체다 */
  leavesNothing: boolean;
}
// SalesOrdersService
async planCancellation(salesOrderId: string, lines: Array<{ salesOrderLineId: string; quantity: number }> | undefined, tx: DbTx): Promise<CancellationPlan>
```

부작용이 없다(쓰기·잠금 없음). 거절은 지금 취소 코드와 **같은 예외·같은 문구**다.

- [ ] **Step 1: 실패하는 테스트**

Task 5 의 픽스처를 먼저 만든다(이 태스크와 Task 5·7·8·9 가 같이 쓴다). `apps/core/src/modules/sales-order/channel-cancel-request/__support__/cancel-request.fixtures.ts`:

```ts
import { randomUUID } from 'crypto';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { CHANNEL_ORDERS_COMMAND_STREAM, CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  wireLogistics,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedMatching,
  receiveStock,
} from '../../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { PoliciesService } from '../../services/policies.service';
import { SalesOrdersService } from '../../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../../services/sales-order-amendments.service';
import { ChannelOrderChangeReader } from '../../channel-order-change/channel-order-change.reader';
import { ChannelOrderChangeManager } from '../../channel-order-change/channel-order-change.manager';
import { ChannelCancelRequestReader } from '../channel-cancel-request.reader';
import { ChannelCancelRequestManager } from '../channel-cancel-request.manager';
import { ChannelCancelSettler } from '../channel-cancel-settler';

export const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };

/** channel-order-change.integration.spec.ts 의 wire 와 같은 배선 + 취소 요청 셋. */
export function wireCancelRequest(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    new PoliciesService(dbService),
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  const amendments = new SalesOrderAmendmentsService(dbService);
  const reader = new ChannelCancelRequestReader();
  const manager = new ChannelCancelRequestManager(
    dbService,
    reader,
    salesOrders,
    outboxPublisherFor(CHANNEL_ORDERS_COMMAND_STREAM, dbService),
  );
  const settler = new ChannelCancelSettler(reader, salesOrders);
  const changes = new ChannelOrderChangeManager(
    new ChannelOrderChangeReader(salesOrders),
    salesOrders,
    amendments,
    { get: () => outbound.planning } as never,
    settler,
  );
  return { dbService, logistics, outbound, salesOrders, amendments, reader, manager, settler, changes };
}

export type CancelWiring = ReturnType<typeof wireCancelRequest>;

/** 판매주문(채널 라인 2개 — 수량 2·1) → 선택적으로 FO(→ draft 박스). channel-order-change 스펙의 seedOrder 와 같은 모양. */
export async function seedChannelOrder(
  tx: DbTx,
  w: CancelWiring,
  opts: { withFo: boolean; salesChannel?: 'medusa' | 'naver' | 'coupang' | '3pl'; noChannelItemIds?: boolean },
) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const lines = [
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 2 },
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 1 },
  ];
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `ext-${randomUUID().slice(0, 8)}`,
      salesChannel: opts.salesChannel ?? 'medusa',
      status: 'confirmed',
      shippingAddress: ADDRESS,
      orderDate: new Date(),
    })
    .returning();
  const lineIds: string[] = [];
  for (const line of lines) {
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
    const variantId = randomUUID();
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    const [row] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: so.id,
        variantId,
        productName: 'IT',
        quantity: line.qty,
        unitPrice: 1000,
        channelOrderItemId: opts.noChannelItemIds ? null : line.item,
        channelProductId: `cp-${line.item}`,
      })
      .returning();
    lineIds.push(row.id);
  }
  if (opts.withFo) await w.logistics.fulfillments.create({ salesOrderId: so.id, warehouseId }, tx);
  return { salesOrderId: so.id, externalOrderId: so.channelOrderId, lines, lineIds, warehouseId };
}

export type SeededOrder = Awaited<ReturnType<typeof seedChannelOrder>>;

/** 수집된 변경. 기본은 «아무것도 안 바뀜». */
export function modifiedPayload(
  seed: SeededOrder,
  over: { quantities?: number[]; cancelRequests?: OrderModifiedPayload['snapshot']['cancelRequests']; address?: typeof ADDRESS } = {},
): OrderModifiedPayload {
  return {
    orderId: randomUUID(),
    salesChannel: 'medusa',
    externalOrderId: seed.externalOrderId,
    modifiedAt: new Date().toISOString(),
    snapshot: {
      shippingAddress: over.address ?? ADDRESS,
      lines: seed.lines.map((line, i) => ({
        channelOrderItemId: line.item,
        channelProductId: `cp-${line.item}`,
        quantity: over.quantities?.[i] ?? line.qty,
        unitPrice: 1000,
        cancelled: false,
      })),
      ...(over.cancelRequests ? { cancelRequests: over.cancelRequests } : {}),
    },
  };
}

/** 줄의 출고 수량을 찍는다(31번·남은 몫 0 시나리오). FOI 비율 1 이라 판매 수량 = 물리 수량. */
export async function markLineShipped(tx: DbTx, salesOrderLineId: string, shippedQty: number): Promise<void> {
  await tx
    .update(wmsTables.fulfillmentOrderItems)
    .set({ shippedQty })
    .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId));
}
```

(import 줄에 `import { eq } from 'drizzle-orm';` 를 더한다. Task 5 의 `ChannelCancelRequestReader`·`Manager`, Task 8 의 `ChannelCancelSettler`·`ChannelOrderChangeManager` 5번째 인자는 아직 없다 — 이 태스크에서는 해당 줄을 주석 처리하지 말고 **Task 5·8 이 끝날 때 컴파일된다**. 그래서 이 태스크의 테스트는 픽스처를 쓰지 않고 아래처럼 `salesOrders` 만 직접 배선한다.)

`cancellation-plan.integration.spec.ts`:

```ts
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, wireLogistics } from '../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { PoliciesService } from '../services/policies.service';
import { SalesOrdersService } from '../services/sales-orders.service';
import { markLineShipped, seedChannelOrder } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function wireSalesOrders(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    new PoliciesService(dbService),
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  return { logistics, salesOrders };
}

describeIfDb('SalesOrdersService.planCancellation (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('V2 전체 — 줄마다 남은 몫, 출고 없음, 남는 것 없음. 아무것도 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w as never, { withFo: true });
      const plan = await w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx);
      expect(plan).toEqual({
        lines: [
          { salesOrderLineId: seed.lineIds[0], quantity: 2 },
          { salesOrderLineId: seed.lineIds[1], quantity: 1 },
        ],
        hasShippedQuantity: false,
        leavesNothing: true,
      });
      const cancellations = await tx
        .select({ id: wmsTables.salesOrderCancellations.id })
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toHaveLength(0);
    });
  });

  it('V2 전체 — 한 줄이 다 나갔으면 남은 줄만, hasShippedQuantity', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w as never, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      const plan = await w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx);
      expect(plan.lines).toEqual([{ salesOrderLineId: seed.lineIds[1], quantity: 1 }]);
      expect(plan.hasShippedQuantity).toBe(true);
      expect(plan.leavesNothing).toBe(false);
    });
  });

  it('V2 전체 — 다 나갔으면 지금 취소 코드와 같은 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w as never, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      await markLineShipped(tx, seed.lineIds[1], 1);
      await expect(w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx)).rejects.toThrow(
        'Sales order has no outstanding physical quantity to cancel',
      );
    });
  });

  it('V2 부분 — 요청 줄 그대로, 다른 줄이 남으면 leavesNothing=false · 남은 수량 초과는 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w as never, { withFo: true });
      const plan = await w.salesOrders.planCancellation(
        seed.salesOrderId,
        [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
        tx,
      );
      expect(plan).toEqual({
        lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
        hasShippedQuantity: false,
        leavesNothing: false,
      });
      await expect(
        w.salesOrders.planCancellation(seed.salesOrderId, [{ salesOrderLineId: seed.lineIds[1], quantity: 2 }], tx),
      ).rejects.toThrow('exceeds remaining');
    });
  });

  it('V2 부분 — 남은 수량을 전부 요청하면 leavesNothing', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w as never, { withFo: true });
      const plan = await w.salesOrders.planCancellation(
        seed.salesOrderId,
        [
          { salesOrderLineId: seed.lineIds[0], quantity: 2 },
          { salesOrderLineId: seed.lineIds[1], quantity: 1 },
        ],
        tx,
      );
      expect(plan.leavesNothing).toBe(true);
    });
  });

  it('박스 이력 없음(FO 전) — 전체는 줄마다 남은 수량, 부분은 남은 수량 검사', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w as never, { withFo: false });
      const full = await w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx);
      expect(full.lines).toEqual([
        { salesOrderLineId: seed.lineIds[0], quantity: 2 },
        { salesOrderLineId: seed.lineIds[1], quantity: 1 },
      ]);
      expect(full.leavesNothing).toBe(true);
      await expect(
        w.salesOrders.planCancellation(seed.salesOrderId, [{ salesOrderLineId: seed.lineIds[1], quantity: 5 }], tx),
      ).rejects.toThrow('exceeds remaining');
    });
  });
});
```

> `seedChannelOrder` 는 `w.logistics` 만 쓴다 — `wireSalesOrders` 의 반환에 `logistics` 가 있어 `as never` 로 넘긴다(테스트 한정). 픽스처의 나머지 import 가 아직 없으므로 **이 태스크에서는 픽스처에서 `wireCancelRequest` 와 그 import 넷(Reader·Manager·Settler·ChannelOrderChange*)을 빼고 만든 뒤**, Task 5·8 이 각자 그 부분을 더한다.

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request/cancellation-plan`
Expected: FAIL — `planCancellation is not a function`

- [ ] **Step 3: 구현 — `planV2Outstanding` 추출**

`sales-orders.service.ts` 의 타입 블록(`type PriorPartialCancellationContext` 다음)에:

```ts
type V2OutstandingPlan = {
  salesOrderLines: Array<typeof wmsTables.salesOrderLines.$inferSelect>;
  salesLineById: Map<string, typeof wmsTables.salesOrderLines.$inferSelect>;
  fulfillmentItems: Array<{ id: string; qty: number; shippedQty: number; canceledQty: number; salesOrderLineId: string | null }>;
  prior: PriorPartialCancellationContext;
  requestedSalesLines: PartialCancellationLine[];
  cancellationByShipment: Map<
    string,
    { manifestVersion: number; lines: Array<{ shipmentLineId: string; expectedLineVersion: number; qty: number }> }
  >;
};

export interface CancellationPlan {
  lines: PartialCancellationLine[];
  hasShippedQuantity: boolean;
  leavesNothing: boolean;
}
```

(`fulfillmentItems` 의 원소 타입은 지금 select 결과와 같게 — `salesOrderLineId` 가 schema 에서 nullable 이 아니면 `string` 으로 둔다. tsc 가 정한다.)

`cancelV2Outstanding` 안에서 `const salesOrderLines = await tx` 부터 `for (const request of requestedSalesLines.filter((line) => line.quantity > 0)) { … }` 루프의 닫는 `}` 까지를 **그대로 잘라** 새 private 메서드 본문으로 옮긴다:

```ts
  /**
   * V2 취소의 계획 — 요청 줄 → 박스 줄 배분과 거절 사유. 읽기만 한다(스펙 §5.2). 거절 문구는 옮기기 전과 같다.
   * `cancelV2Outstanding`(적용)과 `planCancellation`(요청 때 판정)이 함께 쓴다.
   */
  private async planV2Outstanding(
    salesOrderId: string,
    options: CancelSalesOrderOptions,
    isFullCancel: boolean,
    tx: DbTx,
  ): Promise<V2OutstandingPlan> {
    // ↓ 잘라 온 코드(salesOrderLines … cancellationByShipment 배분 루프)
    return { salesOrderLines, salesLineById, fulfillmentItems, prior, requestedSalesLines, cancellationByShipment };
  }
```

`cancelV2Outstanding` 의 그 자리에는:

```ts
    const { fulfillmentItems, requestedSalesLines, salesLineById, cancellationByShipment } =
      await this.planV2Outstanding(salesOrderId, options, isFullCancel, tx);
```

(`planning` 변수와 «full 이면 기존 full 취소 행이 있으면 getOne» 블록은 `cancelV2Outstanding` 에 남긴다. 잘라 낸 코드가 `planning` 을 쓰지 않는지 확인 — 쓰지 않는다.)

- [ ] **Step 4: 구현 — `planCancellation`**

`getCancelledQuantityByLine` 위에:

```ts
  /**
   * 취소 «계획» — 부작용 없이 지금 취소가 받는 범위를 판정한다(#1016 35번, 스펙 §5.2). 채널 주문 취소 요청이
   * 요청 때 이것만 부르고, 적용은 확정 때 `cancel` 이 한다. 거절은 `cancel` 과 같은 예외·같은 문구다.
   * 잠그지 않는다 — 부르는 쪽이 판매주문·박스를 잠근 트랜잭션 안에서 부른다.
   */
  async planCancellation(
    salesOrderId: string,
    lines: PartialCancellationLine[] | undefined,
    tx: DbTx,
  ): Promise<CancellationPlan> {
    const options: CancelSalesOrderOptions = lines ? { lines } : {};
    const isFullCancel = !lines;
    if (Array.isArray(lines) && lines.length === 0) {
      throw new BadRequestException('Partial cancellation lines cannot be empty; omit lines for full cancellation');
    }
    if (await this.hasV2FulfillmentHistory(salesOrderId, tx)) {
      const plan = await this.planV2Outstanding(salesOrderId, options, isFullCancel, tx);
      const requested = plan.requestedSalesLines.filter((line) => line.quantity > 0);
      return {
        lines: requested,
        hasShippedQuantity: plan.fulfillmentItems.some((item) => item.shippedQty > 0),
        leavesNothing: this.leavesNothing(plan.salesOrderLines, plan.prior, requested),
      };
    }
    const [salesOrder] = await tx
      .select({ status: wmsTables.salesOrders.status })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .limit(1);
    if (!salesOrder) throw new NotFoundException(`Sales order ${salesOrderId} not found`);
    const salesOrderLines = await tx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
    const prior = await this.loadPriorPartialCancellationContext(salesOrderId, tx);
    const remainingOf = (line: { id: string; quantity: number }) =>
      line.quantity - (prior.cancelledByLine.get(line.id) ?? 0);
    if (isFullCancel) {
      if (salesOrder.status === 'shipped' || salesOrder.status === 'delivered') {
        throw new BadRequestException(
          '이미 출고/배송 완료된 주문은 전체 취소를 할 수 없습니다. 부분 취소로 진행해 주세요.',
        );
      }
      const requested = salesOrderLines
        .map((line) => ({ salesOrderLineId: line.id, quantity: remainingOf(line) }))
        .filter((line) => line.quantity > 0);
      if (requested.length === 0) throw new BadRequestException('Sales order has no outstanding physical quantity to cancel');
      return { lines: requested, hasShippedQuantity: false, leavesNothing: true };
    }
    const requested = this.normalizePartialCancellationLines(lines);
    const byId = new Map(salesOrderLines.map((line) => [line.id, line]));
    for (const request of requested) {
      const line = byId.get(request.salesOrderLineId);
      if (!line) {
        throw new BadRequestException(`Sales order line ${request.salesOrderLineId} does not belong to ${salesOrderId}`);
      }
      const remaining = remainingOf(line);
      if (request.quantity > remaining) {
        throw new BadRequestException(`Cancellation quantity ${request.quantity} exceeds remaining ${remaining}`);
      }
    }
    return { lines: requested, hasShippedQuantity: false, leavesNothing: this.leavesNothing(salesOrderLines, prior, requested) };
  }

  /** 이 취소 뒤 남는 수량(줄 수량 − 이미 취소 − 이번 취소)이 모든 줄에서 0 인가. 디지털 줄도 센다. */
  private leavesNothing(
    salesOrderLines: Array<{ id: string; quantity: number }>,
    prior: PriorPartialCancellationContext,
    requested: PartialCancellationLine[],
  ): boolean {
    const now = new Map(requested.map((line) => [line.salesOrderLineId, line.quantity]));
    return salesOrderLines.every(
      (line) => line.quantity - (prior.cancelledByLine.get(line.id) ?? 0) - (now.get(line.id) ?? 0) <= 0,
    );
  }
```

(`lines` 가 `undefined` 가 아닌 분기에서 `this.normalizePartialCancellationLines(lines)` — 위의 `isFullCancel` 반환 뒤라 TS 가 좁힌다. 좁히지 못하면 `if (!lines)` 로 분기를 바꾼다. `as` 쓰지 않는다.)

- [ ] **Step 5: 통과 확인 + 회귀**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order`
Expected: 새 스펙 PASS 6, 기존 sales-order 통합(채널 변경 포함) 그대로 PASS. 이어서 `npm run type-check` 0, `npx jest apps/core/src/modules/sales-order --maxWorkers=2` 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/sales-orders.service.ts apps/core/src/modules/sales-order/channel-cancel-request
git commit -m "refactor(core): 판매주문 취소의 계획(판정)을 적용에서 뗀다 — planCancellation (#1016 35번 PR-C)"
```

---

### Task 5: core — 취소 요청(판정 → 기록 + 명령)

**Files:**
- Create: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-route.ts`, `channel-cancel-route.spec.ts`
- Create: `…/channel-cancel-request.types.ts`, `channel-cancel-request.types.spec.ts`
- Create: `…/channel-cancel-request.reader.ts`, `…/channel-cancel-request.manager.ts`, `…/channel-cancel-request.service.ts`
- Create: `…/channel-cancel-request.integration.spec.ts`
- Modify: `…/__support__/cancel-request.fixtures.ts` (`wireCancelRequest` 의 reader·manager 부분)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`getOne`)
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts`

**Interfaces:**
- Consumes: `SalesOrdersService.planCancellation`, `CancellationPlan` (Task 4)
- Produces:

```ts
// channel-cancel-route.ts
export type ChannelCancelRoute = 'command' | 'seller_center' | 'core';
export function channelCancelRoute(salesChannel: string): ChannelCancelRoute;
export function sellerCenterMessage(salesChannel: string): string;

// channel-cancel-request.types.ts
export const CHANNEL_CANCEL_REQUEST_REASON = 'CHANNEL_CANCEL_REQUEST';
export type CancelRequestStatus = 'requested' | 'applied' | 'rejected' | 'superseded';
export type CancelRequester =
  | { kind: 'operator'; actorId: string }
  | { kind: 'customer'; customerId: string }
  | { kind: 'wallet-refund-approval'; intentId: string };
export interface CancelRequestLine { type: 'cancel_line'; salesOrderLineId: string; channelOrderItemId: string | null; quantity: number }
export type CancelRequestMetadata = z.infer<typeof CancelRequestMetadataSchema>;
export function readCancelRequestMetadata(metadata: unknown): CancelRequestMetadata;
export function readCancelRequestLines(deltas: unknown): CancelRequestLine[];
export interface CancelRequestView {
  id: string; status: CancelRequestStatus; scope: 'full' | 'partial'; stage: 'edited' | null;
  convertedFromFull: boolean; requestedAt: string;
  rejection: { reasonCode: string; message: string; at: string } | null;
  outcome: { refundAmount: number; shippingCharge: number; shippingRefund: number; shippingNotAdjusted: boolean } | null;
}
export function toCancelRequestView(row: SalesOrderAmendmentRow): CancelRequestView;

// reader
findBySourceKey(salesOrderId: string, sourceKey: string, tx: DbTx): Promise<AmendmentRow | null>
findOpen(salesOrderId: string, tx: DbTx, opts?: { lock?: boolean }): Promise<AmendmentRow | null>
findById(id: string, tx: DbTx, opts?: { lock?: boolean }): Promise<AmendmentRow | null>
latestFor(salesOrderId: string, tx: DbTx | Db): Promise<AmendmentRow | null>

// manager
interface CancelRequestInput {
  salesOrderId: string;
  lines?: Array<{ salesOrderLineId: string; quantity: number }>;
  requester: CancelRequester;
  sourceKey: string;
  reasonCode?: string;
  reasonDetail?: string;
}
request(input: CancelRequestInput, tx?: DbTx): Promise<CancelRequestView>

// service (포트)
request(input): Promise<CancelRequestView>
findBySourceKey(salesOrderId, sourceKey): Promise<CancelRequestView | null>
latestFor(salesOrderId): Promise<CancelRequestView | null>
```

- `SalesOrdersService.getOne(id)` 반환에 `cancelRequest: CancelRequestView | null` (그 주문의 가장 최근 요청 행)

- [ ] **Step 1: 실패하는 단위 테스트 — 경로·메타데이터**

`channel-cancel-route.spec.ts`:

```ts
import { channelCancelRoute, sellerCenterMessage } from './channel-cancel-route';

describe('channelCancelRoute (#1016 35번, 스펙 §5.2)', () => {
  it.each([
    ['medusa', 'command'],
    ['naver', 'seller_center'],
    ['coupang', 'seller_center'],
    ['3pl', 'core'],
    ['cafe24', 'core'],
  ])('%s → %s', (channel, route) => expect(channelCancelRoute(channel)).toBe(route));

  it('판매자센터 문구', () => {
    expect(sellerCenterMessage('naver')).toBe('네이버 판매자센터에서 취소해 주세요.');
    expect(sellerCenterMessage('coupang')).toBe('쿠팡 판매자센터에서 취소해 주세요.');
  });
});
```

`channel-cancel-request.types.spec.ts`:

```ts
import { readCancelRequestLines, readCancelRequestMetadata, toCancelRequestView } from './channel-cancel-request.types';

const command = {
  requestId: 'r1',
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  scope: 'partial',
  lines: [{ channelOrderItemId: 'item_1', quantity: 1 }],
  requestedBy: 'operator',
  requestedAt: '2026-10-07T00:00:00.000Z',
};
const metadata = {
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  request: { kind: 'cancel', scope: 'partial', requestedBy: 'admin:u1', sourceKey: 'k1', command },
};

describe('취소 요청 메타데이터', () => {
  it('읽기 — 모르는 키는 벗기고 필요한 키는 지킨다', () => {
    expect(readCancelRequestMetadata({ ...metadata, junk: 1 })).toEqual(metadata);
    expect(() => readCancelRequestMetadata({ ...metadata, request: { ...metadata.request, kind: 'edit' } })).toThrow();
  });

  it('줄 읽기 — cancel_line 만', () => {
    const line = { type: 'cancel_line', salesOrderLineId: 'l1', channelOrderItemId: 'item_1', quantity: 1 };
    expect(readCancelRequestLines([line])).toEqual([line]);
    expect(() => readCancelRequestLines([{ type: 'quantity_correction' }])).toThrow();
  });

  it('뷰 — 단계·거절·결과', () => {
    const view = toCancelRequestView({
      id: 'r1',
      status: 'rejected',
      createdAt: new Date('2026-10-07T00:00:00.000Z'),
      metadata: {
        ...metadata,
        request: { ...metadata.request, stage: 'edited', convertedFromFull: true },
        rejection: { reasonCode: 'NOT_CANCELABLE', message: '거절', at: '2026-10-07T00:01:00.000Z' },
      },
    });
    expect(view).toEqual({
      id: 'r1',
      status: 'rejected',
      scope: 'partial',
      stage: 'edited',
      convertedFromFull: true,
      requestedAt: '2026-10-07T00:00:00.000Z',
      rejection: { reasonCode: 'NOT_CANCELABLE', message: '거절', at: '2026-10-07T00:01:00.000Z' },
      outcome: null,
    });
  });
});
```

Run: `npx jest apps/core/src/modules/sales-order/channel-cancel-request --maxWorkers=2`
Expected: FAIL — 모듈 없음

- [ ] **Step 2: 구현 — 경로·타입**

`channel-cancel-route.ts`:

```ts
export type ChannelCancelRoute = 'command' | 'seller_center' | 'core';

/**
 * core 가 `CancelChannelOrder` 를 보낼 수 있는 채널(스펙 §5.2, D10). channel-adapter 능력 벡터
 * (`channel-capabilities.ts` 의 `automatedCancellation`)의 core 쪽 사본이다 — 채널 어휘가 아니라 «명령을 보낼 수 있는가»
 * 목록. 한쪽을 켜면 다른 쪽도 켠다.
 */
const COMMAND_CHANNELS: ReadonlySet<string> = new Set(['medusa']);

/** 자동 취소가 안 되는 마켓. core 는 요청을 거절하고 그 채널의 취소는 수집으로만 받는다. */
const SELLER_CENTER_LABELS: Readonly<Record<string, string>> = { naver: '네이버', coupang: '쿠팡' };

export function channelCancelRoute(salesChannel: string): ChannelCancelRoute {
  if (COMMAND_CHANNELS.has(salesChannel)) return 'command';
  if (salesChannel in SELLER_CENTER_LABELS) return 'seller_center';
  return 'core';
}

export function sellerCenterMessage(salesChannel: string): string {
  return `${SELLER_CENTER_LABELS[salesChannel] ?? salesChannel} 판매자센터에서 취소해 주세요.`;
}
```

`channel-cancel-request.types.ts`:

```ts
import { z } from 'zod';
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { wmsTables } from '../../inventory/schema/inventory.schema';

/** 요청 행의 reason_code — 이 값으로 변경 기록 안의 취소 요청을 가린다. */
export const CHANNEL_CANCEL_REQUEST_REASON = 'CHANNEL_CANCEL_REQUEST';

export type CancelRequestStatus = 'requested' | 'applied' | 'rejected' | 'superseded';

export type CancelRequester =
  | { kind: 'operator'; actorId: string }
  | { kind: 'customer'; customerId: string }
  | { kind: 'wallet-refund-approval'; intentId: string };

/** 요청 행 `deltas` 의 원소. 전체취소는 «그때 남은 몫»을 기록용으로 담는다. */
export interface CancelRequestLine {
  type: 'cancel_line';
  salesOrderLineId: string;
  channelOrderItemId: string | null;
  quantity: number;
}

const CancelRequestLineSchema = z.object({
  type: z.literal('cancel_line'),
  salesOrderLineId: z.string().min(1),
  channelOrderItemId: z.string().min(1).nullable(),
  quantity: z.number().int().positive(),
});

const CancelRequestMetadataSchema = z.object({
  // channel-amendment-actions 의 channelKeyOf 와 같은 자리 — 채널 키는 행 메타데이터 최상위에 둔다.
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  request: z.object({
    kind: z.literal('cancel'),
    scope: z.enum(['full', 'partial']),
    requestedBy: z.string().min(1),
    sourceKey: z.string().min(1),
    convertedFromFull: z.boolean().optional(),
    /** ChannelOrderCancelStalled 또는 수집된 진행 기록이 «수정됨 · 환불 미완»이라고 알렸다 */
    stage: z.literal('edited').optional(),
    /** 부분취소의 물리 취소를 반영한 시각 — 환불보다 먼저 올 수 있다 */
    appliedAt: z.string().optional(),
    /** 처음 낸 명령 그대로. [다시 보내기]가 같은 값을 다시 낸다 */
    command: z.custom<CancelChannelOrderPayload>((value) => typeof value === 'object' && value !== null),
  }),
  rejection: z.object({ reasonCode: z.string(), message: z.string(), at: z.string() }).optional(),
  outcome: z
    .object({
      refundAmount: z.number(),
      shippingCharge: z.number(),
      shippingRefund: z.number(),
      shippingNotAdjusted: z.boolean(),
    })
    .optional(),
  supersededReason: z.string().optional(),
});

export type CancelRequestMetadata = z.infer<typeof CancelRequestMetadataSchema>;

/** jsonb 는 쓰는 쪽(이 폴더의 manager·settler)만 채운다 — 모양이 어긋나면 버그라 던진다. */
export function readCancelRequestMetadata(metadata: unknown): CancelRequestMetadata {
  return CancelRequestMetadataSchema.parse(metadata);
}

export function readCancelRequestLines(deltas: unknown): CancelRequestLine[] {
  return z.array(CancelRequestLineSchema).parse(deltas);
}

export interface CancelRequestView {
  id: string;
  status: CancelRequestStatus;
  scope: 'full' | 'partial';
  stage: 'edited' | null;
  convertedFromFull: boolean;
  requestedAt: string;
  rejection: { reasonCode: string; message: string; at: string } | null;
  outcome: { refundAmount: number; shippingCharge: number; shippingRefund: number; shippingNotAdjusted: boolean } | null;
}

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;

const VIEW_STATUSES: ReadonlySet<string> = new Set(['requested', 'applied', 'rejected', 'superseded']);

function isViewStatus(value: string): value is CancelRequestStatus {
  return VIEW_STATUSES.has(value);
}

export function toCancelRequestView(row: Pick<AmendmentRow, 'id' | 'status' | 'createdAt' | 'metadata'>): CancelRequestView {
  if (!isViewStatus(row.status)) throw new Error(`Cancel request ${row.id} has status ${row.status}`);
  const meta = readCancelRequestMetadata(row.metadata);
  return {
    id: row.id,
    status: row.status,
    scope: meta.request.scope,
    stage: meta.request.stage ?? null,
    convertedFromFull: meta.request.convertedFromFull ?? false,
    requestedAt: row.createdAt.toISOString(),
    rejection: meta.rejection ?? null,
    outcome: meta.outcome ?? null,
  };
}
```

Run Step 1 의 두 스펙 → PASS

- [ ] **Step 3: 실패하는 통합 테스트 — 요청**

픽스처의 `wireCancelRequest` 에 reader·manager 를 넣는다(Task 4 에서 뺀 import 둘 + 생성 줄 둘. settler·changes 는 Task 8).

`channel-cancel-request.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import { BadRequestError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { CHANNEL_CANCEL_REQUEST_REASON } from './channel-cancel-request.types';
import { markLineShipped, seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };

async function requestsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderAmendments)
    .where(
      and(
        eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId),
        eq(wmsTables.salesOrderAmendments.reasonCode, CHANNEL_CANCEL_REQUEST_REASON),
      ),
    );
}

async function commandsOf(tx: DbTx, externalOrderId: string) {
  return tx.execute<{ event_type: string; payload: { payload: Record<string, unknown> } }>(
    drizzleSql`SELECT event_type, payload FROM event.outbox_events WHERE aggregate_id = ${`medusa:${externalOrderId}`} ORDER BY created_at`,
  );
}

describeIfDb('채널 취소 요청 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('전체 — requested 행 하나, 같은 트랜잭션에 CancelChannelOrder 하나, 박스·취소 기록은 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      expect(view).toMatchObject({ status: 'requested', scope: 'full', stage: null, convertedFromFull: false });

      const [row] = await requestsOf(tx, seed.salesOrderId);
      expect(row).toMatchObject({ id: view.id, origin: 'operator', status: 'requested', amendmentKind: 'commercial' });
      expect(row.deltas).toEqual([
        { type: 'cancel_line', salesOrderLineId: seed.lineIds[0], channelOrderItemId: seed.lines[0].item, quantity: 2 },
        { type: 'cancel_line', salesOrderLineId: seed.lineIds[1], channelOrderItemId: seed.lines[1].item, quantity: 1 },
      ]);

      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands).toHaveLength(1);
      expect(commands[0].event_type).toBe('CancelChannelOrder');
      expect(commands[0].payload.payload).toMatchObject({
        requestId: view.id,
        salesChannel: 'medusa',
        externalOrderId: seed.externalOrderId,
        scope: 'full',
        requestedBy: 'operator',
      });
      expect('lines' in commands[0].payload.payload).toBe(false);

      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toHaveLength(0);
      const so = await w.salesOrders.getOne(seed.salesOrderId, tx);
      expect(so?.status).toBe('confirmed');
      expect(so?.cancelRequest).toMatchObject({ id: view.id, status: 'requested' });
    });
  });

  it('같은 키 재요청은 같은 행 — 명령도 하나', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const first = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      const again = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      expect(again.id).toBe(first.id);
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(1);
      expect(await commandsOf(tx, seed.externalOrderId)).toHaveLength(1);
    });
  });

  it('다른 키라도 열린 요청이 있으면 그것을 돌려받는다(고객·운영자 동시)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const first = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      const other = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: { kind: 'customer', customerId: randomUUID() }, sourceKey: 'k2' },
        tx,
      );
      expect(other.id).toBe(first.id);
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('닫힌 요청의 키로 다시 오면 그 행(새 요청을 만들지 않는다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const first = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await tx
        .update(wmsTables.salesOrderAmendments)
        .set({ status: 'rejected' })
        .where(eq(wmsTables.salesOrderAmendments.id, first.id));
      const replay = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      expect(replay).toMatchObject({ id: first.id, status: 'rejected' });
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('부분 — 명령 줄은 채널 줄 번호와 «취소할» 수량', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request(
        { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      expect(view.scope).toBe('partial');
      const [command] = await commandsOf(tx, seed.externalOrderId);
      expect(command.payload.payload).toMatchObject({
        scope: 'partial',
        lines: [{ channelOrderItemId: seed.lines[0].item, quantity: 1 }],
      });
    });
  });

  it('부분 요청이 남는 수량을 0 으로 만들면 전체로 보낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request(
        {
          salesOrderId: seed.salesOrderId,
          lines: [
            { salesOrderLineId: seed.lineIds[0], quantity: 2 },
            { salesOrderLineId: seed.lineIds[1], quantity: 1 },
          ],
          requester: OPERATOR,
          sourceKey: 'k1',
        },
        tx,
      );
      expect(view.scope).toBe('full');
    });
  });

  it('31번 — 운영자 전체취소인데 나간 몫이 있으면 안 나간 몫의 부분취소로 바꾼다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      expect(view).toMatchObject({ scope: 'partial', convertedFromFull: true });
      const [command] = await commandsOf(tx, seed.externalOrderId);
      expect(command.payload.payload).toMatchObject({ scope: 'partial', lines: [{ channelOrderItemId: seed.lines[1].item, quantity: 1 }] });
    });
  });

  it('남은 몫이 0 이면 지금처럼 거절 — 행도 명령도 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      await markLineShipped(tx, seed.lineIds[1], 1);
      await expect(
        w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx),
      ).rejects.toThrow('no outstanding physical quantity');
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(0);
    });
  });

  it.each([
    ['naver', '네이버 판매자센터에서 취소해 주세요.'],
    ['coupang', '쿠팡 판매자센터에서 취소해 주세요.'],
  ] as const)('%s 주문은 판매자센터 문구로 거절', async (salesChannel, message) => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true, salesChannel });
      const attempt = w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await expect(attempt).rejects.toBeInstanceOf(BadRequestError);
      await expect(
        w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k2' }, tx),
      ).rejects.toThrow(message);
    });
  });

  it('채널 줄 번호가 없는 줄의 부분 요청은 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true, noChannelItemIds: true });
      await expect(
        w.manager.request(
          { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  it('취소된 주문은 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: false });
      await tx.update(wmsTables.salesOrders).set({ status: 'cancelled' }).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      await expect(
        w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx),
      ).rejects.toThrow('이미 취소된 주문입니다.');
    });
  });

  it('DB 도 열린 요청을 하나만 받는다(코드 밖 경로의 방어선)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: false });
      await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await expect(
        tx.transaction((sp) =>
          sp.insert(wmsTables.salesOrderAmendments).values({
            salesOrderId: seed.salesOrderId,
            amendmentKind: 'commercial',
            reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
            deltas: [],
            origin: 'operator',
            status: 'requested',
          }),
        ),
      ).rejects.toThrow();
    });
  });
});
```

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.integration`
Expected: FAIL — reader/manager 없음

- [ ] **Step 4: 구현 — reader**

`channel-cancel-request.reader.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { CHANNEL_CANCEL_REQUEST_REASON } from './channel-cancel-request.types';

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;
const t = wmsTables.salesOrderAmendments;
const isCancelRequest = eq(t.reasonCode, CHANNEL_CANCEL_REQUEST_REASON);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 취소 요청 행(`reason_code = 'CHANNEL_CANCEL_REQUEST'`) 조회. 상태 없음 — 모든 메서드가 트랜잭션을 받는다. */
@Injectable()
export class ChannelCancelRequestReader {
  async findBySourceKey(salesOrderId: string, sourceKey: string, tx: DbTx): Promise<AmendmentRow | null> {
    const [row] = await tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest, sql`${t.metadata}->'request'->>'sourceKey' = ${sourceKey}`))
      .limit(1);
    return row ?? null;
  }

  async findOpen(salesOrderId: string, tx: DbTx, opts: { lock?: boolean } = {}): Promise<AmendmentRow | null> {
    const query = tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest, eq(t.status, 'requested')))
      .limit(1);
    const [row] = opts.lock ? await query.for('update') : await query;
    return row ?? null;
  }

  /** 사실의 requestId 는 밖에서 온 값이다 — uuid 가 아니면 조회하지 않는다(uuid 캐스트 오류로 DLQ 에 가지 않게). */
  async findById(id: string, tx: DbTx, opts: { lock?: boolean } = {}): Promise<AmendmentRow | null> {
    if (!UUID.test(id)) return null;
    const query = tx.select().from(t).where(and(eq(t.id, id), isCancelRequest)).limit(1);
    const [row] = opts.lock ? await query.for('update') : await query;
    return row ?? null;
  }

  async latestFor(salesOrderId: string, tx: DbTx): Promise<AmendmentRow | null> {
    const [row] = await tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(1);
    return row ?? null;
  }
}
```

(`.for('update')` 가 `limit` 뒤에 체이닝되지 않으면 `.for('update')` 를 `where` 와 `limit` 사이로 옮긴다 — drizzle 0.44 의 select 빌더 순서에 맞춘다.)

- [ ] **Step 5: 구현 — manager.request**

`channel-cancel-request.manager.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, PublisherFor } from '@app/events';
import { BadRequestError, NotFoundError } from '@app/shared';
import {
  CHANNEL_ORDERS_COMMAND_STREAM,
  CancelChannelOrderPayload,
  channelOrderPartitionKey,
} from '@packages/event-contracts/streams';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../services/sales-orders.service';
import { channelCancelRoute, sellerCenterMessage } from './channel-cancel-route';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import {
  CHANNEL_CANCEL_REQUEST_REASON,
  CancelRequestLine,
  CancelRequestMetadata,
  CancelRequestView,
  CancelRequester,
  toCancelRequestView,
} from './channel-cancel-request.types';

export interface CancelRequestInput {
  salesOrderId: string;
  /** 없으면 전체취소 */
  lines?: Array<{ salesOrderLineId: string; quantity: number }>;
  requester: CancelRequester;
  /** 운영자·고객은 Idempotency-Key, wallet 승인은 `wallet-refund-approval:<intentId>` */
  sourceKey: string;
  reasonCode?: string;
  reasonDetail?: string;
}

/** 보류가 거는 박스 — 아직 떠나지 않은 상자(취소 코드가 빼는 대상과 같다) */
const OPEN_SHIPMENT_STATUSES = ['draft', 'planned', 'recovery_required'] as const;

/**
 * 채널 주문 취소 요청 (#1016 35번, ADR-0042 원칙 2). core 는 문지기다 — 판정하고, 요청을 기록해 출고를 보류한 뒤
 * `CancelChannelOrder` 를 낸다. 확정은 수집(`ChannelCancelSettler`), 거절은 `ChannelOrderCancelRejected` 로 받는다.
 * 환불은 채널이 한다 — 여기는 wallet 을 부르지 않는다.
 */
@Injectable()
export class ChannelCancelRequestManager {
  private readonly logger = new Logger(ChannelCancelRequestManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly reader: ChannelCancelRequestReader,
    private readonly salesOrders: SalesOrdersService,
    @InjectPublisher(CHANNEL_ORDERS_COMMAND_STREAM)
    private readonly commands: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  ) {}

  async request(input: CancelRequestInput, tx?: DbTx): Promise<CancelRequestView> {
    return this.db.run(async (trx) => {
      const so = await this.lockSalesOrder(input.salesOrderId, trx);
      // 같은 키는 닫힌 요청이어도 그 행이다(재전송). 그다음이 열린 요청(동시 요청은 먼저 온 것을 받는다, 스펙 §9-2).
      const replay = await this.reader.findBySourceKey(so.id, input.sourceKey, trx);
      if (replay) return toCancelRequestView(replay);
      const open = await this.reader.findOpen(so.id, trx);
      if (open) return toCancelRequestView(open);

      const route = channelCancelRoute(so.salesChannel);
      if (route === 'seller_center') throw new BadRequestError(sellerCenterMessage(so.salesChannel));
      if (route === 'core') throw new Error(`Sales channel ${so.salesChannel} does not take cancel commands`);
      if (so.status === 'cancelled') throw new BadRequestError('이미 취소된 주문입니다.');
      if (so.status === 'timeout') throw new BadRequestError('타임아웃된 주문은 취소할 수 없습니다.');

      // 관문(송장 발급·배치 시작·발송)도 같은 박스 행을 잠근 뒤 보류를 묻는다 — 둘이 직렬화된다(스펙 §5.3).
      await this.lockOpenShipments(so.id, trx);
      const plan = await this.salesOrders.planCancellation(so.id, input.lines, trx);
      const convertedFromFull = !input.lines && plan.hasShippedQuantity && input.requester.kind === 'operator';
      const scope: 'full' | 'partial' = convertedFromFull ? 'partial' : !input.lines || plan.leavesNothing ? 'full' : 'partial';

      const channelItems = await this.channelItemIds(so.id, trx);
      const lines: CancelRequestLine[] = plan.lines.map((line) => ({
        type: 'cancel_line',
        salesOrderLineId: line.salesOrderLineId,
        channelOrderItemId: channelItems.get(line.salesOrderLineId) ?? null,
        quantity: line.quantity,
      }));
      if (scope === 'partial') {
        const missing = lines.find((line) => !line.channelOrderItemId);
        if (missing) {
          throw new BadRequestError(`채널 줄 번호가 없는 줄은 채널에 취소를 요청할 수 없습니다: ${missing.salesOrderLineId}`);
        }
      }

      const id = randomUUID();
      const requestedAt = new Date();
      const command: CancelChannelOrderPayload = {
        requestId: id,
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        scope,
        ...(scope === 'partial'
          ? { lines: lines.map((line) => ({ channelOrderItemId: line.channelOrderItemId ?? '', quantity: line.quantity })) }
          : {}),
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
        requestedBy: input.requester.kind,
        requestedAt: requestedAt.toISOString(),
      };
      const metadata: CancelRequestMetadata = {
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        request: {
          kind: 'cancel',
          scope,
          requestedBy: requesterLabel(input.requester),
          sourceKey: input.sourceKey,
          ...(convertedFromFull ? { convertedFromFull: true } : {}),
          command,
        },
      };
      const [row] = await trx
        .insert(wmsTables.salesOrderAmendments)
        .values({
          id,
          salesOrderId: so.id,
          amendmentKind: 'commercial',
          reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
          note: input.reasonDetail ?? null,
          deltas: lines,
          metadata,
          origin: 'operator',
          status: 'requested',
          occurredAt: requestedAt,
        })
        .returning();
      await this.enqueue(command, `cancel-request:${id}`, trx);
      this.logger.log(`[CancelRequest] ${id} ${scope} so=${so.id} by=${metadata.request.requestedBy}`);
      return toCancelRequestView(row);
    }, tx);
  }

  protected async enqueue(command: CancelChannelOrderPayload, idempotencyKey: string, trx: DbTx): Promise<void> {
    const key = channelOrderPartitionKey(command.salesChannel, command.externalOrderId);
    await this.commands.enqueue(
      { idempotencyKey, eventType: 'CancelChannelOrder', aggregateId: key, partitionKey: key, payload: command },
      trx,
    );
  }

  private async lockSalesOrder(salesOrderId: string, trx: DbTx) {
    const [so] = await trx
      .select()
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .for('update');
    if (!so) throw new NotFoundError(`Sales order ${salesOrderId} not found`);
    return so;
  }

  private async lockOpenShipments(salesOrderId: string, trx: DbTx): Promise<void> {
    const shipmentIds = trx
      .select({ id: wmsTables.shipmentLines.shipmentId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    await trx
      .select({ id: wmsTables.shipments.id })
      .from(wmsTables.shipments)
      .where(and(inArray(wmsTables.shipments.id, shipmentIds), inArray(wmsTables.shipments.status, [...OPEN_SHIPMENT_STATUSES])))
      .orderBy(asc(wmsTables.shipments.id))
      .for('update');
  }

  private async channelItemIds(salesOrderId: string, trx: DbTx): Promise<Map<string, string>> {
    const rows = await trx
      .select({ id: wmsTables.salesOrderLines.id, item: wmsTables.salesOrderLines.channelOrderItemId })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
    return new Map(rows.flatMap((row) => (row.item ? [[row.id, row.item] as const] : [])));
  }
}

function requesterLabel(requester: CancelRequester): string {
  switch (requester.kind) {
    case 'operator':
      return `admin:${requester.actorId}`;
    case 'customer':
      return `customer:${requester.customerId}`;
    case 'wallet-refund-approval':
      return `wallet-refund-approval:${requester.intentId}`;
  }
}
```

(`channelOrderItemId ?? ''` 는 바로 위 `missing` 검사로 부분취소에선 도달하지 않는다 — 타입을 좁히려면 `lines.flatMap` 으로 null 을 거르는 형태로 바꿔도 된다. `as const` 는 튜플 리터럴 표기이지 타입 단언이 아니다.)

- [ ] **Step 6: 구현 — 포트·getOne·모듈**

`channel-cancel-request.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { CancelRequestInput, ChannelCancelRequestManager } from './channel-cancel-request.manager';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import { CancelRequestView, toCancelRequestView } from './channel-cancel-request.types';

@Injectable()
export class ChannelCancelRequestService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly manager: ChannelCancelRequestManager,
    private readonly reader: ChannelCancelRequestReader,
  ) {}

  request(input: CancelRequestInput): Promise<CancelRequestView> {
    return this.manager.request(input);
  }

  findBySourceKey(salesOrderId: string, sourceKey: string): Promise<CancelRequestView | null> {
    return this.db.run(async (tx) => {
      const row = await this.reader.findBySourceKey(salesOrderId, sourceKey, tx);
      return row ? toCancelRequestView(row) : null;
    });
  }

  latestFor(salesOrderId: string): Promise<CancelRequestView | null> {
    return this.db.run(async (tx) => {
      const row = await this.reader.latestFor(salesOrderId, tx);
      return row ? toCancelRequestView(row) : null;
    });
  }
}
```

`sales-orders.service.ts` `getOne` — `businessTimeline` 다음에 요청 뷰를 더한다(reader 를 생성자에 넣지 않는다 — 통합 스펙들이 이 서비스를 위치 인자로 만든다):

```ts
    const [cancelRequestRow] = await db
      .select()
      .from(wmsTables.salesOrderAmendments)
      .where(
        and(
          eq(wmsTables.salesOrderAmendments.salesOrderId, id),
          eq(wmsTables.salesOrderAmendments.reasonCode, CHANNEL_CANCEL_REQUEST_REASON),
        ),
      )
      .orderBy(desc(wmsTables.salesOrderAmendments.createdAt), desc(wmsTables.salesOrderAmendments.id))
      .limit(1);
    return {
      ...order,
      lines,
      businessTimeline: this.toBusinessTimeline(context, businessLinks),
      // 채널 주문 취소 요청(#1016 35번) — admin-web 이 «취소 요청됨»·«취소 실패»를 그린다
      cancelRequest: cancelRequestRow ? toCancelRequestView(cancelRequestRow) : null,
    };
```

(import: `CHANNEL_CANCEL_REQUEST_REASON`, `toCancelRequestView` from `'../channel-cancel-request/channel-cancel-request.types'`; `desc` 가 없으면 drizzle import 에 더한다.)

`sales-order.module.ts` providers 에:

```ts
    // 채널 주문 취소 요청 — #1016 35번 행(ADR-0042). core 는 판정·기록·보류·명령, 환불은 채널
    ChannelCancelRequestReader,
    ChannelCancelRequestManager,
    ChannelCancelRequestService,
```

(명령 스트림 producer 는 `fulfillment.module.ts` 의 `forApp({ publishes: [... CHANNEL_ORDERS_COMMAND_STREAM] })` 가 이미 선언했다 — `ChannelAmendmentActionsService` 와 같은 주입이다.)

- [ ] **Step 7: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request`
Expected: PASS(요청 12, 계획 6). `npx jest apps/core/src/modules/sales-order/channel-cancel-request --maxWorkers=2` PASS, `npm run type-check` 0. `getOne` 결과를 `toEqual` 하던 스펙이 깨지면 `cancelRequest: null` 을 기대값에 더한다

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 채널 주문 취소 요청 — 판정·기록·출고 보류 잠금·CancelChannelOrder (#1016 35번 PR-C)"
```

---

### Task 6: core — 요청자 셋을 요청 경로로, 채널 주문 취소에서 wallet 을 뺀다

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (`adminCancelRequest` L122~216, `cancelByWalletIntentAfterRefund` L224~263, `processCancelRequest` L694~742, 생성자)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`

**Interfaces:**
- Consumes: `ChannelCancelRequestService.request/findBySourceKey`, `channelCancelRoute`, `sellerCenterMessage` (Task 5)
- Produces:
  - `adminCancelRequest` 반환 `AdminCancelResult = { status: string; refundStatus: string; refundEstimateAmount?: number; manualReason?: string | null } | { requestId: string; status: CancelRequestStatus; scope: 'full' | 'partial'; convertedFromFull: boolean }` — 두 번째가 채널(medusa) 주문
  - `cancelByWalletIntentAfterRefund` 반환 `{ status: string; skipped?: string; requestId?: string }`
  - 고객 `cancelRequest*` 는 지금처럼 `StoreOrderActionsResponseDto` (Task 10 이 `cancelRequestStatus` 를 채운다)
  - `StoreSalesOrdersService` 생성자 4번째 인자 `ChannelCancelRequestService`

- [ ] **Step 1: 스펙의 컨텍스트에 포트 목을 더한다**

`store-sales-orders.service.spec.ts` 의 `makeContext` 옵션에 `openRequestView?: Record<string, unknown> | null; replayView?: Record<string, unknown> | null;` 를 더하고, `walletClientMock` 다음에:

```ts
  const cancelRequestsMock = {
    request: jest.fn().mockResolvedValue({
      id: 'req-1',
      status: 'requested',
      scope: 'full',
      stage: null,
      convertedFromFull: false,
      requestedAt: '2026-10-07T00:00:00.000Z',
      rejection: null,
      outcome: null,
    }),
    findBySourceKey: jest.fn().mockResolvedValue(options.replayView ?? null),
    latestFor: jest.fn().mockResolvedValue(options.openRequestView ?? null),
  };
```

생성자 호출에 `cancelRequestsMock as any` 를 4번째로 넘기고 반환 객체에 `cancelRequestsMock` 를 더한다. `makeAdminContext`·`makeRetryContext` 도 **같은 모양의 목**(`request`·`findBySourceKey`·`latestFor` 셋, 뒤 둘은 `null`)을 4번째로 넘기고 반환에 더한다 — Task 10 이 `buildActionsView` 에서 `latestFor` 를 부른다.

- [ ] **Step 2: 실패하는 테스트로 바꾼다**

`describe('cancelRequestByChannelOrder')` 안에서 **지운다**: «취소 후 Wallet 환불 성공 시 …»부터 «Core 취소 자체가 실패하면 …»까지 11개, «동일 취소 key replay는 …», «동일 취소 key에 다른 hash면 …», «동일 key 동시 환불은 …». (고객 경로는 이제 wallet 을 부르지 않는다 — 그 흐름은 `3pl` 운영자 경로의 테스트가 남아 지킨다.) «디지털 상품이 있어도 미다운로드면 셀프 취소 성공», «준비중(FO ready, 미피킹) 주문은 셀프 취소 성공» 은 네 번째 인자로 컨텍스트 `{ idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] }` 를 넘기고(키 없는 성공 경로는 이제 400 이다), `salesOrdersServiceMock.cancel` 기대를 `cancelRequestsMock.request` 로, `r.orderStatus` 기대를 `'confirmed'` 로 바꾼다. 가드 테스트들(이미 취소·타임아웃·403·naver·출고·피킹·디지털)은 `expect(cancelRequestsMock.request).not.toHaveBeenCalled()` 를 더한다. 그리고 더한다:

```ts
    it('고객 취소는 요청을 기록하고 core 취소·Wallet 을 부르지 않는다 (ADR-0042 원칙 1)', async () => {
      const { service, salesOrdersServiceMock, walletClientMock, cancelRequestsMock } = makeContext();
      const context = { idempotencyKey: 'k-1', actorId: CUSTOMER_ID, actorRoles: ['customer'] };
      await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, { reasonCode: 'OTHER', reasonDetail: '변심' }, context);
      expect(cancelRequestsMock.request).toHaveBeenCalledWith({
        salesOrderId: SO_ID,
        requester: { kind: 'customer', customerId: CUSTOMER_ID },
        sourceKey: 'k-1',
        reasonCode: 'OTHER',
        reasonDetail: '변심',
      });
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('같은 키 재요청은 가드보다 먼저 지금 뷰를 돌려준다 — 이미 취소된 뒤여도 400 이 아니다', async () => {
      const { service, cancelRequestsMock } = makeContext({
        so: makeSo({ status: 'cancelled' }),
        replayView: { id: 'req-1', status: 'applied' },
      });
      const context = { idempotencyKey: 'k-1', actorId: CUSTOMER_ID, actorRoles: ['customer'] };
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {}, context)).resolves.toMatchObject({
        orderStatus: 'cancelled',
      });
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });

    it('Idempotency-Key 없는 고객 취소는 400', async () => {
      const { service } = makeContext();
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        'Idempotency-Key header is required',
      );
    });
```

(나머지 고객 가드 테스트들은 컨텍스트 없이 부르므로, 가드가 키 검사보다 **먼저** 돌게 구현한다 — Step 3 순서.)

`describe('adminCancelRequest')` 를 이렇게 바꾼다:
- 맨 위에 `const CORE_SO = () => makeSo({ salesChannel: '3pl' });` 를 두고, «lines 없으면 전체취소 — Wallet 환불 호출», «관리자 최초 취소 correlationId», «이미 취소된 주문이면 400», «타임아웃 주문이면 400», «Core 취소 실패 시 예외», «walletIntentId 없으면 전체취소도 manual_pending» 은 `makeAdminContext({ so: CORE_SO(), … })` 로 바꾼다(이름 앞에 `core 경로(3pl) — ` 를 붙인다)
- «부분취소 — 조건 충족 시에도 항상 manual_pending», «부분취소 — walletIntentId 없음», «부분취소 — unitPrice 없는 라인» 셋은 지우고(사유 판정은 `partial-cancellation-refund-calculator.spec.ts` 가 지킨다) 하나로 대신한다:

```ts
    it('core 경로(3pl) — 부분취소는 지금처럼 manual_pending 기록, Wallet 미호출', async () => {
      const { service, walletClientMock, salesOrdersServiceMock } = makeAdminContext({
        so: CORE_SO(),
        orderLines: [{ id: 'line-001', quantity: 2, unitPrice: 25000 }],
      });
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, { lines });
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
      expect(salesOrdersServiceMock.cancel).toHaveBeenCalledWith(SO_ID, expect.objectContaining({ lines, cancelledBy: 'admin' }));
      expect(result).toMatchObject({ refundStatus: 'manual_pending', manualReason: 'CHANNEL_ORDER' });
    });
```

- «부분취소 — 채널 주문(naver) → manual_pending» 은 이렇게 바꾼다:

```ts
    it.each([
      ['naver', '네이버 판매자센터에서 취소해 주세요.'],
      ['coupang', '쿠팡 판매자센터에서 취소해 주세요.'],
    ])('%s 주문은 판매자센터 문구로 400 — core 취소·요청 둘 다 없음', async (salesChannel, message) => {
      const { service, salesOrdersServiceMock, cancelRequestsMock } = makeAdminContext({ so: makeSo({ salesChannel }) });
      await expect(service.adminCancelRequest(SO_ID, { lines: [{ salesOrderLineId: 'line-001', quantity: 1 }] })).rejects.toThrow(message);
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(cancelRequestsMock.request).not.toHaveBeenCalled();
    });
```

- 더한다:

```ts
    it('Medusa 주문 — 요청 경로, 응답은 { requestId, status, scope, convertedFromFull }, core 취소·Wallet 없음', async () => {
      const { service, salesOrdersServiceMock, walletClientMock, cancelRequestsMock } = makeAdminContext();
      const lines = [{ salesOrderLineId: 'line-001', quantity: 1 }];
      const result = await service.adminCancelRequest(SO_ID, {
        lines,
        reasonCode: 'CUSTOMER_REQUEST',
        fulfillmentCommandContext: { idempotencyKey: 'k-9', actorId: 'admin-1', actorRoles: ['admin'] },
      });
      expect(cancelRequestsMock.request).toHaveBeenCalledWith({
        salesOrderId: SO_ID,
        lines,
        requester: { kind: 'operator', actorId: 'admin-1' },
        sourceKey: 'k-9',
        reasonCode: 'CUSTOMER_REQUEST',
        reasonDetail: undefined,
      });
      expect(result).toEqual({ requestId: 'req-1', status: 'requested', scope: 'full', convertedFromFull: false });
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('Medusa 주문인데 Idempotency-Key 컨텍스트가 없으면 400', async () => {
      const { service } = makeAdminContext();
      await expect(service.adminCancelRequest(SO_ID, {})).rejects.toThrow('Idempotency-Key header is required');
    });
```

`describe('cancelByWalletIntentAfterRefund')` 가 없으면 새로 만든다(`makeAdminContext` 의 `limit().then()` 이 SO 를 돌려준다):

```ts
  describe('cancelByWalletIntentAfterRefund', () => {
    it('Medusa 주문은 wallet 승인 요청자로 전체취소를 요청한다 — core 취소·Wallet 없음', async () => {
      const { service, salesOrdersServiceMock, walletClientMock, cancelRequestsMock } = makeAdminContext();
      const result = await service.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID, { amount: 50000 });
      expect(cancelRequestsMock.request).toHaveBeenCalledWith({
        salesOrderId: SO_ID,
        requester: { kind: 'wallet-refund-approval', intentId: WALLET_INTENT_ID },
        sourceKey: `wallet-refund-approval:${WALLET_INTENT_ID}`,
        reasonCode: 'CUSTOMER_REFUND_REQUEST',
      });
      expect(result).toEqual({ status: 'requested', requestId: 'req-1' });
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
      expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
    });

    it('이미 취소·출고면 지금처럼 건너뛴다', async () => {
      const cancelled = makeAdminContext({ so: makeSo({ status: 'cancelled' }) });
      await expect(cancelled.service.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID)).resolves.toEqual({
        status: 'cancelled',
        skipped: 'already_cancelled',
      });
      const shipped = makeAdminContext({ so: makeSo({ status: 'shipped' }) });
      await expect(shipped.service.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID)).resolves.toMatchObject({ skipped: 'already_shipped' });
      expect(shipped.cancelRequestsMock.request).not.toHaveBeenCalled();
    });
  });
```

Run: `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`
Expected: 새·바뀐 테스트 FAIL

- [ ] **Step 3: 구현**

생성자에 `private readonly cancelRequests: ChannelCancelRequestService,` 를 4번째로 더한다(import 3개: `ChannelCancelRequestService`, `channelCancelRoute`·`sellerCenterMessage`, `CancelRequestStatus`).

파일 상단 타입:

```ts
type AdminCancelResult =
  | { status: string; refundStatus: string; refundEstimateAmount?: number; manualReason?: string | null }
  | { requestId: string; status: CancelRequestStatus; scope: 'full' | 'partial'; convertedFromFull: boolean };
```

`adminCancelRequest` — 반환 타입을 `Promise<AdminCancelResult>` 로, `const so = await this.findSoOrThrow({ id: orderId });` 바로 다음에:

```ts
    // 채널 주문은 채널이 환불하고 core 는 문지기다(ADR-0042) — 판정·기록·보류 뒤 명령. 마켓은 판매자센터로.
    const route = channelCancelRoute(so.salesChannel);
    if (route === 'seller_center') throw new BadRequestException(sellerCenterMessage(so.salesChannel));
    if (route === 'command') {
      const ctx = dto.fulfillmentCommandContext;
      if (!ctx) throw new BadRequestException('Idempotency-Key header is required');
      const view = await this.cancelRequests.request({
        salesOrderId: so.id,
        ...(dto.lines ? { lines: dto.lines } : {}),
        requester: { kind: 'operator', actorId: ctx.actorId },
        sourceKey: ctx.idempotencyKey,
        reasonCode: dto.reasonCode,
        reasonDetail: dto.reasonDetail,
      });
      return { requestId: view.id, status: view.status, scope: view.scope, convertedFromFull: view.convertedFromFull };
    }
```

(나머지 본문은 core 경로로 그대로 둔다. 독스트링 첫 줄을 «관리자 취소. 채널(Medusa) 주문은 취소 요청(#1016 35번), core 직접 주문은 core 취소 + Wallet 환불.»로 고친다.)

`cancelByWalletIntentAfterRefund` — `salesOrdersService.cancel(...)` 호출과 그 뒤 로그·반환을:

```ts
    // 환불은 wallet 에서 끝났고 Medusa 장부에는 환불 투영(스펙 §6.4)이 넣는다 — Medusa 취소는 환불 없이 끝난다.
    // 31번 전환을 하지 않는다: 돈이 이미 다 나갔으므로 전체취소가 맞다(계획 단계 발견 8).
    const view = await this.cancelRequests.request({
      salesOrderId: so.id,
      requester: { kind: 'wallet-refund-approval', intentId },
      sourceKey: `wallet-refund-approval:${intentId}`,
      reasonCode: opts.reasonCode ?? 'CUSTOMER_REFUND_REQUEST',
    });
    this.logger.log(`[cancelByWalletIntentAfterRefund] SO ${so.id} cancel requested (intent=${intentId}, request=${view.id})`);
    return { status: view.status, requestId: view.id };
```

반환 타입 `Promise<{ status: string; skipped?: string; requestId?: string }>`. `opts.amount` 는 더 쓰지 않는다 — 매개변수는 DTO 호환으로 남기고 독스트링에 «amount 는 무시한다(환불액은 wallet·Medusa 장부가 안다)»를 적는다.

`processCancelRequest` — 맨 앞의 `validateCancellationReplay` 블록을:

```ts
    if (fulfillmentCommandContext) {
      const replay = await this.cancelRequests.findBySourceKey(so.id, fulfillmentCommandContext.idempotencyKey);
      if (replay) return this.buildActionsView(so);
    }
```

로 바꾸고, 가드들(취소·타임아웃·채널·출고·피킹·디지털)은 그대로 둔 뒤, `salesOrdersService.cancel(...)` 부터 끝까지를:

```ts
    if (!fulfillmentCommandContext) throw new BadRequestException('Idempotency-Key header is required');
    await this.cancelRequests.request({
      salesOrderId: so.id,
      requester: { kind: 'customer', customerId },
      sourceKey: fulfillmentCommandContext.idempotencyKey,
      reasonCode: dto.reasonCode,
      reasonDetail: dto.reasonDetail,
    });
    return this.buildActionsView(so);
```

`requestWalletRefundOnce` 는 이제 부르는 곳이 없다 — **지운다**(그 안의 advisory lock·correlation 로직 포함). `requestWalletRefundAfterCancel`·`recordWalletRefundLink`·`retryWalletRefund` 는 core 경로·재시도용으로 남긴다. `createHash` import 가 다른 데서 안 쓰이면 지운다.

- [ ] **Step 4: 가드 스펙 — 채널 주문 취소는 WalletRefundClient 를 부르지 않는다**

같은 스펙 파일 끝에:

```ts
describe('가드 — 채널(Medusa) 주문 취소 경로는 WalletRefundClient 를 부르지 않는다 (스펙 §5.7)', () => {
  it.each([
    ['운영자 전체', (s: StoreSalesOrdersService) =>
      s.adminCancelRequest(SO_ID, { fulfillmentCommandContext: { idempotencyKey: 'k', actorId: 'a', actorRoles: [] } })],
    ['운영자 부분', (s: StoreSalesOrdersService) =>
      s.adminCancelRequest(SO_ID, {
        lines: [{ salesOrderLineId: 'line-001', quantity: 1 }],
        fulfillmentCommandContext: { idempotencyKey: 'k', actorId: 'a', actorRoles: [] },
      })],
    ['wallet 환불 승인', (s: StoreSalesOrdersService) => s.cancelByWalletIntentAfterRefund(WALLET_INTENT_ID)],
  ])('%s', async (_label, call) => {
    const { service, walletClientMock } = makeAdminContext();
    await call(service);
    expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
  });

  it('고객', async () => {
    const { service, walletClientMock } = makeContext();
    await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {}, { idempotencyKey: 'k', actorId: CUSTOMER_ID, actorRoles: [] });
    expect(walletClientMock.refundByIntent).not.toHaveBeenCalled();
  });
});
```

(`makeAdminContext` 가 `describe('StoreSalesOrdersService')` 안에 선언돼 있으면 이 describe 도 그 안에 둔다.)

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order --maxWorkers=2` → PASS, `npm run type-check` → 0. 컨트롤러 둘(`sales-orders.controller.ts` `:id/cancel`, `admin-return-exchange.controller.ts` `sales-orders/:id/cancel`)은 반환을 그대로 넘기므로 바꿀 것 없다 — `@ApiOperation` summary 의 «Wallet 환불 포함/연동»만 «채널 주문은 취소 요청»으로 고친다

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 운영자·고객·wallet 승인 취소가 채널 주문이면 취소 요청을 낸다 — core 는 wallet 을 부르지 않는다 (#1016 35번 PR-C)"
```

---

### Task 7: core — 출고 보류 관문 셋

**Files:**
- Create: `apps/core/src/modules/fulfillment/hold/cancel-request-hold.ts`
- Create: `apps/core/src/modules/fulfillment/hold/cancel-request-hold.integration.spec.ts`
- Create: `apps/core/src/modules/fulfillment/hold/cancel-request-hold.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts` (`issueForShipment` 핸들러 L54~, `assertDispatchable` L390~)
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.manager.hold.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.types.ts` (L128~141)
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.locks.ts` (L219~234, L377)
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts` (`waybillBlockers` L1189~)
- Create: `apps/core/src/modules/sales-order/channel-cancel-request/request-vs-gate.integration.spec.ts`

**Interfaces:**
- Produces:

```ts
// cancel-request-hold.ts
export const CANCEL_REQUESTED = 'CANCEL_REQUESTED';
export async function heldShipmentIds(tx: DbTx, shipmentIds: readonly string[]): Promise<Set<string>>;
export async function assertShipmentNotHeld(tx: DbTx, shipmentId: string): Promise<void>; // ConflictError(`CANCEL_REQUESTED: 취소 처리 중인 주문이 있습니다 (shipment <id>)`)
export function isCancelRequestedError(error: unknown): boolean;
// allocation.types.ts
export type StartBlockReason = StartShortReason | 'WAYBILL_NOT_READY' | 'CANCEL_REQUESTED';
// allocation.locks.ts
export function dispatchBlocker(shipmentId: string, error: ConflictError): StartBlocker;
```

- [ ] **Step 1: 실패하는 테스트 — 보류 판정**

`cancel-request-hold.integration.spec.ts`:

```ts
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { assertShipmentNotHeld, heldShipmentIds } from './cancel-request-hold';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function requestRow(tx: DbTx, salesOrderId: string, status: 'requested' | 'rejected' | 'applied') {
  await tx.insert(wmsTables.salesOrderAmendments).values({
    salesOrderId,
    amendmentKind: 'commercial',
    reasonCode: 'CHANNEL_CANCEL_REQUEST',
    deltas: [],
    origin: 'operator',
    status,
  });
}

describeIfDb('출고 보류 판정 (DB integration, rollback-only)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('열린 요청이 걸린 주문의 박스만 보류, 합포장이면 한 주문만 걸려도 박스 전체', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const held = await f.seedOrder(tx);
      const free = await f.seedOrder(tx);
      const heldFo = await f.seedFo(tx, w, held);
      const freeFo = await f.seedFo(tx, w, free);
      const merged = await f.seedBox(tx, w, [heldFo.foItemId, freeFo.foItemId], { status: 'planned' });
      const alone = await f.seedBox(tx, w, [freeFo.foItemId], { status: 'planned' });
      await requestRow(tx, held.salesOrderId, 'requested');
      expect(await heldShipmentIds(tx, [merged.shipmentId, alone.shipmentId])).toEqual(new Set([merged.shipmentId]));
      await expect(assertShipmentNotHeld(tx, merged.shipmentId)).rejects.toThrow('CANCEL_REQUESTED');
      await expect(assertShipmentNotHeld(tx, alone.shipmentId)).resolves.toBeUndefined();
    });
  });

  it.each(['rejected', 'applied'] as const)('%s 요청은 보류가 아니다', async (status) => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o);
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned' });
      await requestRow(tx, o.salesOrderId, status);
      expect(await heldShipmentIds(tx, [box.shipmentId])).toEqual(new Set());
    });
  });

  it('빈 목록은 조회하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      expect(await heldShipmentIds(tx, [])).toEqual(new Set());
    });
  });
});
```

`cancel-request-hold.spec.ts`:

```ts
import { ConflictError } from '@app/shared';
import { isCancelRequestedError } from './cancel-request-hold';

describe('isCancelRequestedError', () => {
  it('CANCEL_REQUESTED 로 시작하는 ConflictError 만', () => {
    expect(isCancelRequestedError(new ConflictError('CANCEL_REQUESTED: x'))).toBe(true);
    expect(isCancelRequestedError(new ConflictError('WAYBILL_STALE: x'))).toBe(false);
    expect(isCancelRequestedError(new Error('CANCEL_REQUESTED: x'))).toBe(false);
  });
});
```

Run 둘 → FAIL(모듈 없음)

- [ ] **Step 2: 구현 — 보류 판정**

`cancel-request-hold.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { ConflictError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

/** 관문 셋의 거절 사유(스펙 §5.3). 메시지 접두사로 싣는다 — 배치 시작·합류는 이 접두사로 차단 사유를 가른다. */
export const CANCEL_REQUESTED = 'CANCEL_REQUESTED';

/**
 * 열린 채널 취소 요청(`sales_order_amendments.status = 'requested'`)이 걸린 판매주문을 담은 박스 (#1016 35번, ADR-0042 원칙 2).
 * 요청 행의 존재가 곧 «출고 보류»다 — 따로 풀 일이 없다. 합포장 박스는 한 주문만 걸려도 통째로 멈춘다.
 * 잠그지 않는다: 부르는 쪽이 박스 행을 먼저 잠근다(요청 트랜잭션도 같은 행을 잠가 직렬화된다).
 */
export async function heldShipmentIds(tx: DbTx, shipmentIds: readonly string[]): Promise<Set<string>> {
  if (shipmentIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ shipmentId: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .innerJoin(
      wmsTables.salesOrderAmendments,
      and(
        eq(wmsTables.salesOrderAmendments.salesOrderId, wmsTables.fulfillmentOrders.salesOrderId),
        eq(wmsTables.salesOrderAmendments.status, 'requested'),
      ),
    )
    .where(inArray(wmsTables.shipmentLines.shipmentId, [...shipmentIds]));
  return new Set(rows.map((row) => row.shipmentId));
}

export async function assertShipmentNotHeld(tx: DbTx, shipmentId: string): Promise<void> {
  if ((await heldShipmentIds(tx, [shipmentId])).size > 0) {
    throw new ConflictError(`${CANCEL_REQUESTED}: 취소 처리 중인 주문이 있습니다 (shipment ${shipmentId})`);
  }
}

export function isCancelRequestedError(error: unknown): boolean {
  return error instanceof ConflictError && error.message.startsWith(CANCEL_REQUESTED);
}
```

Run 둘 → PASS

- [ ] **Step 3: 실패하는 테스트 — 송장 관문**

`waybill.manager.hold.spec.ts`:

```ts
import { ConflictError } from '@app/shared';
import { WaybillManager } from './waybill.manager';
import { assertShipmentNotHeld } from '../hold/cancel-request-hold';

jest.mock('../hold/cancel-request-hold', () => ({
  ...jest.requireActual('../hold/cancel-request-hold'),
  assertShipmentNotHeld: jest.fn(),
}));

const held = assertShipmentNotHeld as jest.MockedFunction<typeof assertShipmentNotHeld>;

function chain(result: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'where', 'limit', 'for']) node[method] = jest.fn(() => node);
  node.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve);
  return node;
}

function makeManager() {
  const trx = chain([{ id: 'sh-1', manifestVersion: 1, recipientSnapshot: {} }]);
  const reader = {
    loadIssueContext: jest.fn().mockResolvedValue({ status: 'planned', manifestVersion: 1 }),
    getActiveWaybill: jest.fn().mockResolvedValue(null),
  };
  const commands = { execute: jest.fn((_req: unknown, handler: (t: unknown) => unknown) => handler(trx)) };
  const registry = { get: () => ({ isConfigured: () => true }) };
  const dbService = { run: (fn: (t: unknown) => unknown) => fn(trx) };
  const manager = new WaybillManager(
    reader as never,
    {} as never,
    {} as never,
    registry as never,
    commands as never,
    {} as never,
    dbService as never,
  );
  return { manager, reader, trx };
}

describe('송장 관문 — 열린 취소 요청 (#1016 35번 §5.3)', () => {
  beforeEach(() => held.mockReset());

  it('발송 사전검사: 보류면 활성 송장을 보기 전에 CANCEL_REQUESTED', async () => {
    held.mockRejectedValue(new ConflictError('CANCEL_REQUESTED: x'));
    const { manager, reader } = makeManager();
    await expect(manager.assertDispatchable('sh-1')).rejects.toThrow('CANCEL_REQUESTED');
    expect(reader.getActiveWaybill).not.toHaveBeenCalled();
  });

  it('발급: 박스 행을 잠근 뒤 보류를 묻고, 보류면 발급 맥락을 읽지 않는다', async () => {
    held.mockRejectedValue(new ConflictError('CANCEL_REQUESTED: x'));
    const { manager, reader, trx } = makeManager();
    await expect(
      manager.issueForShipment('sh-1', { carrier: 'HANJIN', expectedManifestVersion: 1 }, 'k', { id: 'a', roles: [] }),
    ).rejects.toThrow('CANCEL_REQUESTED');
    expect(trx.for).toHaveBeenCalledWith('update');
    expect(reader.loadIssueContext).not.toHaveBeenCalled();
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/waybill.manager.hold.spec.ts` → FAIL

- [ ] **Step 4: 구현 — 송장 관문**

`waybill.manager.ts`:
- import `assertShipmentNotHeld` from `'../hold/cancel-request-hold'`
- `issueForShipment` 의 `commands.execute` 핸들러 첫 줄(`const ctx = await this.reader.loadIssueContext(trx, shipmentId);` 앞)에:

```ts
          // 열린 채널 취소 요청과 직렬화한다(#1016 35번 §5.3) — 요청 트랜잭션이 같은 박스 행을 잠근다.
          // 발급은 원래 아무것도 잠그지 않았다(활성 송장 유니크만 기댔다).
          await trx
            .select({ id: inventoryTables.shipments.id })
            .from(inventoryTables.shipments)
            .where(eq(inventoryTables.shipments.id, shipmentId))
            .for('update');
          await assertShipmentNotHeld(trx, shipmentId);
```

- `assertDispatchable` 의 `if (!shipment) throw …` 다음 줄에:

```ts
      // 출고 보류(#1016 35번 §5.3). 발송·배치 시작·합류·시작 전 추가·라벨 렌더가 모두 여기를 지난다 — 보류는 출고 전체를 멈춘다.
      await assertShipmentNotHeld(trx, shipmentId);
```

Run 스펙 → PASS. 기존 waybill 스펙 회귀: `npx jest apps/core/src/modules/fulfillment/waybill --maxWorkers=2` → PASS(목이 `trx.select…for` 체인을 갖지 않아 깨지는 단위 스펙이 있으면, 그 목에 `.for` 를 더한다 — 동작 변경이 아니라 목 보강)

- [ ] **Step 5: 구현 — 배치 시작·합류의 차단 사유**

`allocation.types.ts`:

```ts
export type StartBlockReason = StartShortReason | 'WAYBILL_NOT_READY' | 'CANCEL_REQUESTED';
```

`StartBlocker.detail` 주석을 «WAYBILL_NOT_READY·CANCEL_REQUESTED 의 원 메시지. 줄 사유면 null.»로.

`allocation.locks.ts` — 파일 끝에 export 함수를 더하고(합류도 쓴다):

```ts
/**
 * `assertDispatchable` 의 거절을 박스 사유로 바꾼다. 출고 보류(취소 요청, #1016 35번)는 송장 문제가 아니다 —
 * `WAYBILL_NOT_READY` 에 섞으면 현장이 «송장 재발급»으로 읽는다.
 */
export function dispatchBlocker(shipmentId: string, error: ConflictError): StartBlocker {
  return {
    shipmentId,
    reason: isCancelRequestedError(error) ? 'CANCEL_REQUESTED' : 'WAYBILL_NOT_READY',
    shipmentLineId: null,
    skuId: null,
    requiredQty: null,
    shortQty: null,
    detail: error.message,
  };
}
```

`assertStartEligibility` 의 catch 안 `blockers.push({ … reason: 'WAYBILL_NOT_READY' … })` 를 `blockers.push(dispatchBlocker(shipment.id, error));` 로. `describeStartBlockers` 의 순서 표를 `{ INBOUND_PENDING: 0, STOCK_SHORT: 1, WAYBILL_NOT_READY: 2, CANCEL_REQUESTED: 3 }` 로. import 에 `isCancelRequestedError` 를 더한다.

`outbound-batch-orchestrator.service.ts` `waybillBlockers` 의 반환 배열을 `return [dispatchBlocker(shipmentId, error)];` 로(import `dispatchBlocker`). 주석을 «합류의 송장·보류 사유 — 막지 않고 모은다»로.

순수 함수 테스트를 `apps/core/src/modules/fulfillment/picking/allocation/` 의 기존 단위 스펙 파일(없으면 `dispatch-blocker.spec.ts` 신규)에:

```ts
import { ConflictError } from '@app/shared';
import { dispatchBlocker } from './allocation.locks';

describe('dispatchBlocker', () => {
  it('취소 요청 보류는 CANCEL_REQUESTED, 나머지 송장 거절은 WAYBILL_NOT_READY', () => {
    expect(dispatchBlocker('s1', new ConflictError('CANCEL_REQUESTED: 취소 처리 중인 주문이 있습니다 (shipment s1)'))).toMatchObject({
      reason: 'CANCEL_REQUESTED',
      detail: 'CANCEL_REQUESTED: 취소 처리 중인 주문이 있습니다 (shipment s1)',
    });
    expect(dispatchBlocker('s1', new ConflictError('WAYBILL_STALE: x')).reason).toBe('WAYBILL_NOT_READY');
  });
});
```

- [ ] **Step 6: 실 DB 직렬화 — 요청이 박스 행을 쥐는 동안 관문 잠금이 기다린다**

`request-vs-gate.integration.spec.ts`(커밋되는 시드라 끝에 지운다 — `channel-amendment-actions.integration.spec.ts` 의 경합 케이스와 같은 꼴):

```ts
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb } from '../../fulfillment/services/__support__';
import * as f from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

/** drizzle 0.44 는 쿼리 에러를 감싸 Postgres 코드가 `.cause` 에만 남는다. */
function pgErrorCode(error: unknown, depth = 5): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < depth && current !== null && typeof current === 'object'; i += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

describeIfDb('요청 vs 관문 — 같은 박스 행 잠금으로 직렬화 (DB integration)', () => {
  jest.setTimeout(60_000);
  const main = makeDb(DATABASE_URL as string);
  const contender = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await main.sql.end({ timeout: 5 });
    await contender.sql.end({ timeout: 5 });
  });

  it('요청 트랜잭션이 열려 있는 동안 박스 행 FOR UPDATE 는 lock_timeout 에 걸린다', async () => {
    const seeded = await main.db.transaction(async (raw) => {
      const tx = raw as unknown as DbTx;
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      await tx.update(wmsTables.salesOrderLines).set({ channelOrderItemId: 'item-1' }).where(eq(wmsTables.salesOrderLines.id, o.lineId));
      const fo = await f.seedFo(tx, w, o);
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned' });
      return { ...o, ...fo, ...box, world: w };
    });
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered!: () => void;
      const enteredSignal = new Promise<void>((resolve) => (entered = resolve));
      const held = main.db
        .transaction(async (raw) => {
          const tx = raw as unknown as DbTx;
          await wireCancelRequest(tx).manager.request(
            { salesOrderId: seeded.salesOrderId, requester: { kind: 'operator', actorId: 'a' }, sourceKey: 'k' },
            tx,
          );
          entered();
          await gate;
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
      await Promise.race([enteredSignal, held]);
      try {
        const outcome = await contender.db
          .transaction(async (tx) => {
            await tx.execute(drizzleSql`SET LOCAL lock_timeout = '300ms'`);
            await tx.execute(drizzleSql`SELECT id FROM shipments WHERE id = ${seeded.shipmentId} FOR UPDATE`);
          })
          .then(
            () => 'locked',
            (error: unknown) => error,
          );
        expect(pgErrorCode(outcome) ?? outcome).toBe('55P03');
      } finally {
        release();
        await held;
      }
    } finally {
      await main.db.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.shipmentId, seeded.shipmentId));
      await main.db.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, seeded.shipmentId));
      await main.db.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, seeded.foItemId));
      await main.db.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, seeded.foId));
      await main.db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seeded.salesOrderId));
      await main.db.delete(wmsTables.skus).where(eq(wmsTables.skus.id, seeded.world.skuId));
      await main.db.delete(wmsTables.warehouses).where(inArray(wmsTables.warehouses.id, [seeded.world.warehouseId]));
    }
  });
});
```

(`seedWorld` 가 만든 holder 는 sku 를 지운 뒤 남는다 — 이름에 `op-holder-` 접두사가 붙어 다른 스펙도 같은 식으로 남긴다. 지워야 하면 `holders` 를 `name like 'op-holder-%'` 로 지우지 말고 seedWorld 반환에 holderId 를 더해 지운다. 판매주문 줄은 cascade 로 함께 지워진다 — 아니면 `salesOrderLines` 를 먼저 지운다.)

- [ ] **Step 7: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "apps/core/src/modules/(fulfillment/hold|sales-order/channel-cancel-request/request-vs-gate|fulfillment/services/outbound)"` → PASS(기존 배치·발송 통합 회귀 포함). `npx jest apps/core/src/modules/fulfillment --maxWorkers=2` → PASS, `npm run type-check` → 0

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/fulfillment apps/core/src/modules/sales-order/channel-cancel-request
git commit -m "feat(core): 열린 취소 요청이 송장 발급·배치 시작·발송을 막는다 — CANCEL_REQUESTED (#1016 35번 PR-C)"
```

---

### Task 8: core — 확정(수집된 변경을 열린 요청과 맞춘다)

**Files:**
- Create: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-match.ts`, `channel-cancel-match.spec.ts`
- Create: `…/channel-cancel-settler.ts`
- Create: `…/channel-cancel-settle.integration.spec.ts`
- Modify: `…/__support__/cancel-request.fixtures.ts` (settler·changes)
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts` (생성자, `handle`)
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts` (생성자 두 곳)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` (`handleOrderCancelled`, 생성자)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts`

**Interfaces:**
- Consumes: reader (Task 5), `OrderModifiedCancelRequest` (Task 1), `ChannelDelta`·`QuantityCorrectionDelta` (5번), `isDomainRefusal`·`errorDetail` (`channel-change-blockers.ts`)
- Produces:

```ts
// channel-cancel-match.ts
export function takeRequestedDecreases(
  lines: CancelRequestLine[],
  deltas: ChannelDelta[],
): { matched: true; rest: ChannelDelta[] } | { matched: false };

// channel-cancel-settler.ts
settleModified(salesOrderId: string, deltas: ChannelDelta[], progress: OrderModifiedCancelRequest[], occurredAt: string, tx: DbTx): Promise<ChannelDelta[]>
settleCancelled(salesOrderId: string, tx: DbTx): Promise<void>
```

- `ChannelOrderChangeManager` 생성자 5번째 인자 `ChannelCancelSettler`; `OrderEventsConsumer` 생성자 7번째 인자 `ChannelCancelSettler`

- [ ] **Step 1: 실패하는 테스트 — 맞추기(순수)**

`channel-cancel-match.spec.ts`:

```ts
import { takeRequestedDecreases } from './channel-cancel-match';
import type { ChannelDelta } from '../channel-order-change/channel-order-change.types';

const line = (salesOrderLineId: string, quantity: number) => ({
  type: 'cancel_line' as const,
  salesOrderLineId,
  channelOrderItemId: `ci-${salesOrderLineId}`,
  quantity,
});
const decrease = (salesOrderLineId: string, before: number, after: number): ChannelDelta => ({
  type: 'quantity_correction',
  salesOrderLineId,
  channelOrderItemId: `ci-${salesOrderLineId}`,
  quantityBefore: before,
  correctedQuantity: after,
});
const address: ChannelDelta = {
  type: 'shipping_address_change',
  before: { recipientName: 'a', phone: '1', postalCode: '1', roadAddress: 'x', detailAddress: '1' },
  after: { recipientName: 'a', phone: '1', postalCode: '1', roadAddress: 'y', detailAddress: '1' },
};

describe('takeRequestedDecreases (스펙 §5.4)', () => {
  it('요청 줄마다 «정확히 그 수량만큼» 준 감소가 있으면 그것을 먹고 나머지를 돌려준다', () => {
    expect(takeRequestedDecreases([line('l1', 1)], [decrease('l1', 2, 1), address])).toEqual({ matched: true, rest: [address] });
  });

  it('줄 통째 제거(→0)도 같은 감소다', () => {
    expect(takeRequestedDecreases([line('l1', 2)], [decrease('l1', 2, 0)])).toEqual({ matched: true, rest: [] });
  });

  it.each([
    ['수량이 다름', [decrease('l1', 2, 0)]],
    ['감소가 없음', [address]],
    ['다른 줄', [decrease('l2', 2, 1)]],
  ])('%s → 안 맞음', (_label, deltas) => {
    expect(takeRequestedDecreases([line('l1', 1)], deltas)).toEqual({ matched: false });
  });

  it('요청 줄 하나라도 못 찾으면 안 맞음(일부만 맞음도 안 맞음)', () => {
    expect(takeRequestedDecreases([line('l1', 1), line('l2', 1)], [decrease('l1', 2, 1)])).toEqual({ matched: false });
  });
});
```

Run → FAIL

- [ ] **Step 2: 구현 — 맞추기**

`channel-cancel-match.ts`:

```ts
import type { ChannelDelta, QuantityCorrectionDelta } from '../channel-order-change/channel-order-change.types';
import type { CancelRequestLine } from './channel-cancel-request.types';

function isQuantityCorrection(delta: ChannelDelta): delta is QuantityCorrectionDelta {
  return delta.type === 'quantity_correction';
}

/**
 * 열린 부분취소 요청의 줄 ↔ 5번 diff 의 감소(스펙 §5.4). 요청 줄 «전부»가 정확히 같은 감소로 보일 때만 먹는다.
 * 하나라도 어긋나면 아무것도 먹지 않는다 — 그 델타는 5번 규칙을 타고, 요청은 settler 가 superseded 로 닫는다.
 */
export function takeRequestedDecreases(
  lines: CancelRequestLine[],
  deltas: ChannelDelta[],
): { matched: true; rest: ChannelDelta[] } | { matched: false } {
  const taken = new Set<ChannelDelta>();
  for (const line of lines) {
    const hit = deltas.find(
      (delta) =>
        !taken.has(delta) &&
        isQuantityCorrection(delta) &&
        delta.salesOrderLineId === line.salesOrderLineId &&
        delta.quantityBefore - delta.correctedQuantity === line.quantity,
    );
    if (!hit) return { matched: false };
    taken.add(hit);
  }
  return { matched: true, rest: deltas.filter((delta) => !taken.has(delta)) };
}
```

Run → PASS

- [ ] **Step 3: 실패하는 통합 테스트 — 확정**

픽스처 `wireCancelRequest` 에 settler·changes 를 넣는다(Task 4 에서 뺀 import 와 생성 줄).

`channel-cancel-settle.integration.spec.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { CHANNEL_CANCEL_REQUEST_REASON } from './channel-cancel-request.types';
import { modifiedPayload, seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };
const NEXT_ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '부산', detailAddress: '202' };

const progress = (requestId: string, stage: 'edited' | 'refunded') => [
  { requestId, stage, refundAmount: 1000, shippingCharge: 3000, shippingRefund: 0, shippingNotAdjusted: false },
];

async function amendmentsOf(tx: DbTx, salesOrderId: string) {
  return tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId));
}
async function requestOf(tx: DbTx, id: string) {
  const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
  return row;
}
async function cancellationsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderCancellations)
    .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
}

describeIfDb('채널 취소 확정 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function partialRequest(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request(
      { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
      tx,
    );
    return { w, seed, requestId: view.id };
  }

  it('refunded — 요청을 applied 로 닫고 결과를 채운다. 그 감소로 채널 행을 만들지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [1, 1], cancelRequests: progress(requestId, 'refunded') }),
        'm-1',
        tx,
      );
      const row = await requestOf(tx, requestId);
      expect(row.status).toBe('applied');
      expect(row.metadata).toMatchObject({
        outcome: { refundAmount: 1000, shippingCharge: 3000, shippingRefund: 0, shippingNotAdjusted: false },
      });
      expect((await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel')).toHaveLength(0);
      const cancellations = await cancellationsOf(tx, seed.salesOrderId);
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0].metadata).toMatchObject({ sourceEventId: `cancel-request:${requestId}` });
    });
  });

  it('edited 다음 refunded(델타 0) — 물리 취소는 한 번, 요청은 두 번째에 닫힌다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [1, 1], cancelRequests: progress(requestId, 'edited') }),
        'm-1',
        tx,
      );
      const mid = await requestOf(tx, requestId);
      expect(mid.status).toBe('requested');
      expect(mid.metadata).toMatchObject({ request: { stage: 'edited', appliedAt: expect.any(String) } });
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);

      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [1, 1], cancelRequests: progress(requestId, 'refunded') }),
        'm-2',
        tx,
      );
      expect((await requestOf(tx, requestId)).status).toBe('applied');
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('채널이 아직 이 요청을 처리하지 않았다(기록 없음) — 요청은 그대로, 델타는 5번 규칙', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { quantities: [1, 1] }), 'm-1', tx);
      expect((await requestOf(tx, requestId)).status).toBe('requested');
      expect((await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel')).toHaveLength(1);
    });
  });

  it('기록은 있는데 델타가 어긋남 — 요청 superseded(CHANNEL_CHANGE_MISMATCH), 델타는 5번 규칙', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [0, 1], cancelRequests: progress(requestId, 'refunded') }),
        'm-1',
        tx,
      );
      const row = await requestOf(tx, requestId);
      expect(row.status).toBe('superseded');
      expect(row.metadata).toMatchObject({ supersededReason: 'CHANNEL_CHANGE_MISMATCH' });
      expect((await amendmentsOf(tx, seed.salesOrderId)).filter((a) => a.origin === 'channel')).toHaveLength(1);
    });
  });

  it('열린 요청이 있어도 주소만 바뀐 변경은 5번 규칙대로, 요청 행은 대기 목록·superseded 처리에 섞이지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { address: NEXT_ADDRESS }), 'm-1', tx);
      expect((await requestOf(tx, requestId)).status).toBe('requested');
      const pending = await w.amendments.list({ status: 'pending', origin: 'channel', limit: 200 }, tx);
      expect(pending.items.some((item) => item.id === requestId)).toBe(false);
    });
  });

  it('전체 요청 + 수집된 전체취소 → applied / 부분 요청 + 전체취소 → superseded', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const full = await seedChannelOrder(tx, w, { withFo: true });
      const fullView = await w.manager.request({ salesOrderId: full.salesOrderId, requester: OPERATOR, sourceKey: 'kf' }, tx);
      await w.salesOrders.cancel(full.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-1' } }, tx);
      await w.settler.settleCancelled(full.salesOrderId, tx);
      expect((await requestOf(tx, fullView.id)).status).toBe('applied');

      const { seed, requestId } = await partialRequest(tx);
      await w.salesOrders.cancel(seed.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-2' } }, tx);
      await w.settler.settleCancelled(seed.salesOrderId, tx);
      const row = await requestOf(tx, requestId);
      expect(row.status).toBe('superseded');
      expect(row.metadata).toMatchObject({ supersededReason: 'CHANNEL_FULL_CANCEL' });
    });
  });
});
```

(`list(query, tx?)` 는 `{ items, nextCursor }` 를 돌려준다. `tx` 를 꼭 넘긴다 — 안 넘기면 다른 커넥션이라 롤백 트랜잭션의 행을 못 본다.)

Run → FAIL

- [ ] **Step 4: 구현 — settler**

`channel-cancel-settler.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { OrderModifiedCancelRequest } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../services/sales-orders.service';
import { errorDetail, isDomainRefusal } from '../channel-order-change/channel-change-blockers';
import type { ChannelDelta } from '../channel-order-change/channel-order-change.types';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import { takeRequestedDecreases } from './channel-cancel-match';
import {
  CHANNEL_CANCEL_REQUEST_REASON,
  CancelRequestMetadata,
  readCancelRequestLines,
  readCancelRequestMetadata,
} from './channel-cancel-request.types';

type AmendmentRow = typeof wmsTables.salesOrderAmendments.$inferSelect;

/**
 * 채널 취소 확정 (#1016 35번, 스펙 §5.4). 성공 사실은 따로 오지 않는다 — 재수집된 `OrderCancelled`/`OrderModified` 가 곧 사실이다.
 * 부분취소는 채널의 진행 기록(`snapshot.cancelRequests`)으로 «수정됨 · 환불 미완»과 «끝남»을 가른다(계획 단계 발견 1).
 * 부르는 쪽이 판매주문을 잠근 트랜잭션 안에서 부른다.
 */
@Injectable()
export class ChannelCancelSettler {
  private readonly logger = new Logger(ChannelCancelSettler.name);

  constructor(
    private readonly reader: ChannelCancelRequestReader,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  /** 열린 부분취소 요청이 먹은 감소를 반영하고, 먹지 않은 델타를 돌려준다 — 그것만 5번 규칙을 탄다. */
  async settleModified(
    salesOrderId: string,
    deltas: ChannelDelta[],
    progress: OrderModifiedCancelRequest[],
    occurredAt: string,
    tx: DbTx,
  ): Promise<ChannelDelta[]> {
    const open = await this.reader.findOpen(salesOrderId, tx, { lock: true });
    if (!open) return deltas;
    const meta = readCancelRequestMetadata(open.metadata);
    if (meta.request.scope !== 'partial') return deltas;
    const record = progress.find((p) => p.requestId === open.id);
    if (!record) return deltas;

    let rest = deltas;
    let appliedAt = meta.request.appliedAt;
    if (!appliedAt) {
      const lines = readCancelRequestLines(open.deltas);
      const taken = takeRequestedDecreases(lines, deltas);
      if (!taken.matched) {
        await this.supersede(open, meta, 'CHANNEL_CHANGE_MISMATCH', tx);
        return deltas;
      }
      const refusal = await this.applyPhysical(salesOrderId, open.id, lines, occurredAt, tx);
      if (refusal) {
        // 같은 델타가 5번 규칙에서 다시 거절돼 «반영 대기 변경»(CANCEL_NOT_IMMEDIATE)에 남는다 — 운영자가 거기서 본다.
        await this.supersede(open, meta, 'APPLY_REFUSED', tx, refusal);
        return deltas;
      }
      appliedAt = new Date().toISOString();
      rest = taken.rest;
    }

    const request = { ...meta.request, appliedAt };
    if (record.stage === 'refunded') {
      const { stage: _edited, ...closed } = request;
      await this.write(open.id, 'applied', {
        ...meta,
        request: closed,
        outcome: {
          refundAmount: record.refundAmount,
          shippingCharge: record.shippingCharge,
          shippingRefund: record.shippingRefund,
          shippingNotAdjusted: record.shippingNotAdjusted,
        },
      }, tx);
    } else {
      await this.write(open.id, 'requested', { ...meta, request: { ...request, stage: 'edited' } }, tx);
    }
    return rest;
  }

  /** 수집된 전체취소(`OrderCancelled`) — 열린 전체 요청은 applied, 부분 요청은 덮였다(스펙 §9-7·§9-12). */
  async settleCancelled(salesOrderId: string, tx: DbTx): Promise<void> {
    const open = await this.reader.findOpen(salesOrderId, tx, { lock: true });
    if (!open) return;
    const meta = readCancelRequestMetadata(open.metadata);
    if (meta.request.scope === 'full') {
      await this.write(open.id, 'applied', meta, tx);
      return;
    }
    await this.supersede(open, meta, 'CHANNEL_FULL_CANCEL', tx);
  }

  private async applyPhysical(
    salesOrderId: string,
    requestId: string,
    lines: Array<{ salesOrderLineId: string; quantity: number }>,
    occurredAt: string,
    tx: DbTx,
  ): Promise<string | null> {
    try {
      await tx.transaction(async (sp) => {
        await this.salesOrders.cancel(
          salesOrderId,
          {
            lines: lines.map((line) => ({ salesOrderLineId: line.salesOrderLineId, quantity: line.quantity })),
            cancelledBy: 'channel',
            reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
            occurredAt,
            // 같은 키라 재처리는 기존 취소를 돌려받는다(V2 replay). walletRefund 를 넘기지 않는다 — 환불은 채널이 했다.
            metadata: { sourceEventId: `cancel-request:${requestId}` },
          },
          sp,
        );
      });
      return null;
    } catch (error) {
      if (!isDomainRefusal(error)) throw error;
      this.logger.warn(`[CancelRequest] ${requestId} physical cancel refused: ${errorDetail(error)}`);
      return errorDetail(error);
    }
  }

  private async supersede(
    row: AmendmentRow,
    meta: CancelRequestMetadata,
    reason: 'CHANNEL_CHANGE_MISMATCH' | 'APPLY_REFUSED' | 'CHANNEL_FULL_CANCEL',
    tx: DbTx,
    detail?: string,
  ): Promise<void> {
    this.logger.warn(`[CancelRequest] ${row.id} superseded: ${reason}${detail ? ` (${detail})` : ''}`);
    await this.write(row.id, 'superseded', { ...meta, supersededReason: reason }, tx);
  }

  private async write(
    id: string,
    status: 'requested' | 'applied' | 'superseded',
    metadata: CancelRequestMetadata,
    tx: DbTx,
  ): Promise<void> {
    await tx
      .update(wmsTables.salesOrderAmendments)
      .set({ status, metadata, updatedAt: new Date() })
      .where(eq(wmsTables.salesOrderAmendments.id, id));
  }
}
```

(`errorDetail` 은 `string` 을 돌려준다. `_edited` 미사용 변수 lint 규칙에 걸리면 `const closed = { ...request }; delete closed.stage;` 대신 zod 스키마가 optional 이므로 `{ ...request, stage: undefined }` 를 쓰고 `write` 전에 `JSON` 직렬화가 undefined 키를 버린다는 점을 주석으로 남긴다.)

- [ ] **Step 5: 구현 — 5번 manager 와 소비자에 잇는다**

`channel-order-change.manager.ts`:
- 생성자 끝에 `private readonly cancelSettler: ChannelCancelSettler,` (import 추가)
- `handle` 의 앞부분을:

```ts
    const order = await this.reader.lockEffectiveOrder(salesOrderId, tx);
    if (!order) throw new Error(`Sales order ${salesOrderId} vanished after resolve`);
    // 열린 채널 취소 요청이 먹는 감소는 5번 규칙을 타지 않는다 — 우리가 요청한 변경이다(#1016 35번 §5.4).
    const deltas = await this.cancelSettler.settleModified(
      salesOrderId,
      diffChannelSnapshot(order, payload.snapshot),
      payload.snapshot.cancelRequests ?? [],
      payload.modifiedAt,
      tx,
    );
    const amendmentId = randomUUID();
    const allRemoved = removesAllLines(order, deltas);
```

  (이하 그대로.)

`channel-order-change.integration.spec.ts` 의 `new ChannelOrderChangeManager(…)` 두 곳에 5번째 인자 `new ChannelCancelSettler(new ChannelCancelRequestReader(), salesOrders)` 를 더한다(`failingPlanning` 케이스는 `w.salesOrders`).

`order-events.consumer.ts`:
- 생성자 끝에 `private readonly cancelSettler: ChannelCancelSettler,`
- `handleOrderCancelled` 의 `await this.salesOrdersService.cancel(…, tx);` 바로 다음에:

```ts
        // 우리가 낸 취소 요청이 열려 있으면 닫는다(#1016 35번 §5.4). 줄 단위 취소(마켓)는 요청과 무관하다.
        if (!lines) await this.cancelSettler.settleCancelled(salesOrderId, tx);
```

`order-events.consumer.spec.ts` 의 `Mocks` 에 `cancelSettler: { settleCancelled: jest.Mock }` 를 더하고 `makeMocks` 에 `cancelSettler: { settleCancelled: jest.fn().mockResolvedValue(undefined) }`, `makeConsumer` 의 생성자 7번째 인자로 넘긴다. 테스트 둘을 더한다:

```ts
  it('전체 OrderCancelled 는 취소 뒤 열린 요청을 닫으러 간다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue({ id: 'so-1' } as any);
    await consumer.handleOrderCancelled(
      { orderId: 'ord-1', salesChannel: 'medusa', externalOrderId: 'order_1', reason: 'ADMIN_CANCEL', cancelledBy: 'medusa', cancelledAt: '2026-10-07T00:00:00.000Z', refundRequired: false } as any,
      { messageId: 'msg-c', correlationId: 'c' } as any,
    );
    expect(mocks.cancelSettler.settleCancelled).toHaveBeenCalledWith('so-1', mocks.fakeTx);
  });

  it('줄 단위 OrderCancelled 는 요청을 건드리지 않는다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue({ id: 'so-1' } as any);
    mocks.salesOrders.findLineIdsByChannelOrderItemIds.mockResolvedValue(new Map([['ci-1', 'line-1']]) as any);
    await consumer.handleOrderCancelled(
      { orderId: 'ord-1', salesChannel: 'naver', externalOrderId: 'n1', reason: 'CUSTOMER_REQUEST', cancelledBy: 'naver', cancelledAt: '2026-10-07T00:00:00.000Z', refundRequired: true, cancelledLines: [{ channelOrderItemId: 'ci-1', quantity: 1 }] } as any,
      { messageId: 'msg-l', correlationId: 'c' } as any,
    );
    expect(mocks.cancelSettler.settleCancelled).not.toHaveBeenCalled();
  });
```

(`findLineIdsByChannelOrderItemIds` 의 반환 모양은 기존 «cancelledLines 가 있으면 …» 테스트가 쓰는 값과 같게 맞춘다.)

`sales-order.module.ts` providers 에 `ChannelCancelSettler` 를 더한다.

- [ ] **Step 6: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order` → PASS(채널 변경 회귀 포함). `npx jest apps/core/src/modules/sales-order --maxWorkers=2` → PASS. `npm run type-check` → 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 수집된 취소·부분취소를 열린 요청과 맞춰 확정 — 환불 미완이면 요청을 연 채 둔다 (#1016 35번 PR-C)"
```

---

### Task 9: core — 거절·정체 사실, [다시 보내기]·[요청 접기]

**Files:**
- Modify: `…/channel-cancel-request.manager.ts` (`reject`·`markStalled`·`resend`·`withdraw`)
- Modify: `…/channel-cancel-request.service.ts`
- Create: `…/channel-cancel-request.facts.integration.spec.ts`
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` (+spec)
- Modify: `apps/core/src/modules/sales-order/controllers/sales-orders.controller.ts`

**Interfaces:**
- Consumes: `ChannelOrderCancelRejectedPayload`, `ChannelOrderCancelStalledPayload` (계약, PR-B)
- Produces:

```ts
// manager / service
reject(fact: { requestId: string; reasonCode: string; message: string }, tx?: DbTx): Promise<void>   // requested 아니면 무시
markStalled(fact: { requestId: string }, tx?: DbTx): Promise<void>                                   // 이미 edited·requested 아님 → 무시
resend(salesOrderId: string, tx?: DbTx): Promise<CancelRequestView>                                   // 열린 요청 없으면 ConflictError
withdraw(salesOrderId: string, operatorId: string | null, tx?: DbTx): Promise<CancelRequestView>      // rejected(OPERATOR_WITHDRAWN)
// HTTP
POST /sales-orders/:id/cancel-request/resend   → CancelRequestView
POST /sales-orders/:id/cancel-request/withdraw → CancelRequestView
```

- [ ] **Step 1: 실패하는 통합 테스트**

`channel-cancel-request.facts.integration.spec.ts`:

```ts
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };

async function rowOf(tx: DbTx, id: string) {
  const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
  return row;
}

describeIfDb('거절·정체 사실과 운영자 조치 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function open(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
    return { w, seed, id: view.id };
  }

  it('거절 — rejected + 사유, 같은 사실이 다시 와도 그대로(시각도 그대로)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.reject({ requestId: id, reasonCode: 'NOT_CANCELABLE', message: '이미 출고' }, tx);
      const first = await rowOf(tx, id);
      expect(first.status).toBe('rejected');
      expect(first.metadata).toMatchObject({ rejection: { reasonCode: 'NOT_CANCELABLE', message: '이미 출고' } });
      await w.manager.reject({ requestId: id, reasonCode: 'ORDER_NOT_FOUND', message: '다른 사유' }, tx);
      expect((await rowOf(tx, id)).metadata).toEqual(first.metadata);
    });
  });

  it('거절 — 이미 applied 인 요청엔 아무것도 안 한다 · uuid 아닌 requestId 는 무시', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await tx.update(wmsTables.salesOrderAmendments).set({ status: 'applied' }).where(eq(wmsTables.salesOrderAmendments.id, id));
      await w.manager.reject({ requestId: id, reasonCode: 'NOT_CANCELABLE', message: 'x' }, tx);
      expect((await rowOf(tx, id)).status).toBe('applied');
      await expect(w.manager.reject({ requestId: 'not-a-uuid', reasonCode: 'NOT_CANCELABLE', message: 'x' }, tx)).resolves.toBeUndefined();
    });
  });

  it('정체 — requested 를 유지한 채 stage=edited, 두 번 와도 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.markStalled({ requestId: id }, tx);
      await w.manager.markStalled({ requestId: id }, tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('requested');
      expect(row.metadata).toMatchObject({ request: { stage: 'edited' } });
    });
  });

  it('다시 보내기 — 같은 requestId·같은 본문의 명령을 하나 더 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      await w.manager.resend(seed.salesOrderId, tx);
      const commands = await tx.execute<{ idempotency_key: string; payload: { payload: Record<string, unknown> } }>(
        drizzleSql`SELECT idempotency_key, payload FROM event.outbox_events WHERE aggregate_id = ${`medusa:${seed.externalOrderId}`} ORDER BY created_at`,
      );
      expect(commands).toHaveLength(2);
      expect(commands[1].payload.payload).toEqual(commands[0].payload.payload);
      expect(commands[1].payload.payload).toMatchObject({ requestId: id });
    });
  });

  it('요청 접기 — rejected(OPERATOR_WITHDRAWN) · 열린 요청이 없으면 409', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await open(tx);
      const view = await w.manager.withdraw(seed.salesOrderId, OPERATOR.actorId, tx);
      expect(view).toMatchObject({ id, status: 'rejected', rejection: { reasonCode: 'OPERATOR_WITHDRAWN' } });
      await expect(w.manager.withdraw(seed.salesOrderId, OPERATOR.actorId, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(w.manager.resend(seed.salesOrderId, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
```

(`event.outbox_events` 의 키 컬럼 이름은 Task 5 테스트를 돌릴 때 `\d event.outbox_events` 로 확인한다 — `idempotency_key` 가 아니면 그 이름으로 바꾼다.)

Run → FAIL

- [ ] **Step 2: 구현 — manager**

`channel-cancel-request.manager.ts` 클래스에 더한다(import 에 `ConflictError`, `readCancelRequestMetadata` 추가):

```ts
  /** 종결 사실(스펙 §5.5). [다시 보내기]마다 같은 사실이 다시 올 수 있다 — requested 가 아니면 무시한다. */
  async reject(fact: { requestId: string; reasonCode: string; message: string }, tx?: DbTx): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(fact.requestId, trx, { lock: true });
      if (!row || row.status !== 'requested') {
        this.logger.log(`[CancelRequest] rejection ignored: ${fact.requestId} is ${row?.status ?? 'unknown'}`);
        return;
      }
      const meta = readCancelRequestMetadata(row.metadata);
      await this.write(row.id, 'rejected', {
        ...meta,
        rejection: { reasonCode: fact.reasonCode, message: fact.message, at: new Date().toISOString() },
      }, trx);
    }, tx);
  }

  /** 진행 사실 — 요청을 연 채 «수정됨 · 환불 미완»만 적는다(스펙 §7.2). */
  async markStalled(fact: { requestId: string }, tx?: DbTx): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(fact.requestId, trx, { lock: true });
      if (!row || row.status !== 'requested') return;
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.stage === 'edited') return;
      await this.write(row.id, 'requested', { ...meta, request: { ...meta.request, stage: 'edited' } }, trx);
    }, tx);
  }

  /** [다시 보내기] — 처음 낸 명령 그대로(같은 requestId). 채널 쪽이 멱등이다(전체: 이미 취소됨 = 성공, 부분: 단계 기록). */
  async resend(salesOrderId: string, tx?: DbTx): Promise<CancelRequestView> {
    return this.db.run(async (trx) => {
      await this.lockSalesOrder(salesOrderId, trx);
      const row = await this.reader.findOpen(salesOrderId, trx, { lock: true });
      if (!row) throw new ConflictError(`열린 취소 요청이 없습니다: ${salesOrderId}`);
      const meta = readCancelRequestMetadata(row.metadata);
      await this.enqueue(meta.request.command, `cancel-request:${row.id}:resend:${Date.now()}`, trx);
      // updated_at 을 밀어 정체 보드가 다시 판정하게 한다 — 단계 진입 시각(stage_entered_at)은 그대로라 체류 시간이 이어진다.
      await this.write(row.id, 'requested', meta, trx);
      return toCancelRequestView({ ...row, metadata: meta });
    }, tx);
  }

  /** [요청 접기] — 보류를 푼다. 실제로는 채널이 취소했는데 수집만 늦었어도 수집이 오면 판단 10 대로 반영된다(스펙 §9-8). */
  async withdraw(salesOrderId: string, operatorId: string | null, tx?: DbTx): Promise<CancelRequestView> {
    return this.db.run(async (trx) => {
      await this.lockSalesOrder(salesOrderId, trx);
      const row = await this.reader.findOpen(salesOrderId, trx, { lock: true });
      if (!row) throw new ConflictError(`열린 취소 요청이 없습니다: ${salesOrderId}`);
      const meta = readCancelRequestMetadata(row.metadata);
      const next: CancelRequestMetadata = {
        ...meta,
        rejection: {
          reasonCode: 'OPERATOR_WITHDRAWN',
          message: operatorId ? `운영자가 요청을 접었습니다 (${operatorId})` : '운영자가 요청을 접었습니다',
          at: new Date().toISOString(),
        },
      };
      await this.write(row.id, 'rejected', next, trx);
      return toCancelRequestView({ ...row, status: 'rejected', metadata: next });
    }, tx);
  }

  private async write(id: string, status: 'requested' | 'rejected', metadata: CancelRequestMetadata, trx: DbTx): Promise<void> {
    await trx
      .update(wmsTables.salesOrderAmendments)
      .set({ status, metadata, updatedAt: new Date() })
      .where(eq(wmsTables.salesOrderAmendments.id, id));
  }
```

포트(`channel-cancel-request.service.ts`)에 넷을 위임한다:

```ts
  reject(fact: { requestId: string; reasonCode: string; message: string }): Promise<void> {
    return this.manager.reject(fact);
  }
  markStalled(fact: { requestId: string }): Promise<void> {
    return this.manager.markStalled(fact);
  }
  resend(salesOrderId: string): Promise<CancelRequestView> {
    return this.manager.resend(salesOrderId);
  }
  withdraw(salesOrderId: string, operatorId: string | null): Promise<CancelRequestView> {
    return this.manager.withdraw(salesOrderId, operatorId);
  }
```

- [ ] **Step 3: 구현 — 소비자·컨트롤러**

`order-events.consumer.ts` 생성자 끝(settler 다음)에 `private readonly cancelRequests: ChannelCancelRequestService,`, 그리고 `handleOrderRefundCreated` 앞에:

```ts
  /**
   * 채널이 우리 취소 요청을 거절했다(#1016 35번 §5.5). 같은 requestId 가 [다시 보내기]마다 다시 올 수 있다 — 처리기가 무해하게 받는다.
   * order_events 에 기록하지 않는다(그 테이블의 event_type 은 pg enum 이고 이 사실은 판매주문 생애가 아니다).
   */
  @On(ORDER_STREAM, 'ChannelOrderCancelRejected')
  async handleChannelOrderCancelRejected(
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'ChannelOrderCancelRejected'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'ChannelOrderCancelRejected'>,
  ) {
    this.logger.log(`[ChannelOrderCancelRejected] ${payload.requestId} ${payload.reasonCode}`, {
      correlationId: envelope.correlationId,
    });
    await this.cancelRequests.reject(payload);
  }

  /** 부분취소가 «수정됨 · 환불 미완»에 멈췄다 — 종결이 아니다(§7.2). */
  @On(ORDER_STREAM, 'ChannelOrderCancelStalled')
  async handleChannelOrderCancelStalled(
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'ChannelOrderCancelStalled'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'ChannelOrderCancelStalled'>,
  ) {
    this.logger.log(`[ChannelOrderCancelStalled] ${payload.requestId}`, { correlationId: envelope.correlationId });
    await this.cancelRequests.markStalled(payload);
  }
```

`order-events.consumer.spec.ts`: `Mocks` 에 `cancelRequests: { reject: jest.Mock; markStalled: jest.Mock }`, `makeMocks` 에 `cancelRequests: { reject: jest.fn().mockResolvedValue(undefined), markStalled: jest.fn().mockResolvedValue(undefined) }`, `makeConsumer` 8번째 인자. 테스트:

```ts
  it('거절·정체 사실은 요청 서비스로 그대로 넘긴다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };
    await consumer.handleChannelOrderCancelRejected({ ...key, reasonCode: 'NOT_CANCELABLE', message: 'x' } as any, { messageId: 'm1' } as any);
    await consumer.handleChannelOrderCancelStalled({ ...key, stage: 'edited', message: 'y' } as any, { messageId: 'm2' } as any);
    expect(mocks.cancelRequests.reject).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1', reasonCode: 'NOT_CANCELABLE' }));
    expect(mocks.cancelRequests.markStalled).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1' }));
  });
```

`sales-orders.controller.ts` — 생성자에 `private readonly cancelRequests: ChannelCancelRequestService,` 를 더하고 `cancel-by-intent` 핸들러 다음에:

```ts
  @Post(':id/cancel-request/resend')
  @ApiOperation({ summary: '채널 취소 요청 다시 보내기 — 같은 requestId (정체 보드 «취소 요청 미반영»)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  resendCancelRequest(@Param('id') id: string) {
    return this.cancelRequests.resend(id);
  }

  @Post(':id/cancel-request/withdraw')
  @ApiOperation({ summary: '채널 취소 요청 접기 — 보류를 푼다(OPERATOR_WITHDRAWN)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  withdrawCancelRequest(@Param('id') id: string, @User() user: { userId?: string; id?: string; sub?: string } | undefined) {
    return this.cancelRequests.withdraw(id, user?.userId ?? user?.id ?? user?.sub ?? null);
  }
```

(`@User()` 의 타입은 같은 파일의 `:id/cancel` 핸들러가 쓰는 꼴을 그대로 쓴다.)

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request` → PASS. `npx jest apps/core/src/modules/sales-order --maxWorkers=2` → PASS. `npm run audit:consume-validation -- --gate` → exit 0(새 소비 이벤트 둘의 발행자는 channel-adapter 아웃박스 — `StreamPublisher` 를 지난다). `npm run type-check` → 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 채널 취소 거절·정체 사실 처리와 다시 보내기·요청 접기 (#1016 35번 PR-C)"
```

---

### Task 10: core — 고객 액션 뷰(처리 중·거절·수집된 환불)

**Files:**
- Modify: `apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts` (L15~21, L71~119)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` (`buildActionsView` L521~692)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`

**Interfaces:**
- Consumes: `ChannelCancelRequestService.latestFor` (Task 5)
- Produces: `StoreCancelUnavailableReason` 에 `'cancel_requested'`, `StoreOrderActionsResponseDto.cancelRequestStatus?: 'requested' | 'rejected'`

- [ ] **Step 1: 실패하는 테스트**

`describe('getActionsByChannelOrder')` 에 더한다(`makeContext` 옵션 `openRequestView` 는 Task 6 이 만들었다):

```ts
    it('열린 취소 요청 — 취소 버튼 없이 cancel_requested, cancelRequestStatus=requested', async () => {
      const { service } = makeContext({ openRequestView: { id: 'req-1', status: 'requested' } });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.availableActions).toEqual(['receipt']);
      expect(r.cancelUnavailableReason).toBe('cancel_requested');
      expect(r.cancelRequestStatus).toBe('requested');
    });

    it('거절된 최근 요청 — 다시 취소할 수 있고 cancelRequestStatus=rejected', async () => {
      const { service } = makeContext({ openRequestView: { id: 'req-1', status: 'rejected' } });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.availableActions).toContain('cancel');
      expect(r.cancelRequestStatus).toBe('rejected');
    });

    it('취소된 주문은 요청 상태를 싣지 않는다', async () => {
      const { service } = makeContext({ so: makeSo({ status: 'cancelled' }), openRequestView: { id: 'req-1', status: 'applied' } });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.cancelRequestStatus).toBeUndefined();
    });
```

수집된 환불 요약 — `makeContext` 의 `orderBy().then` 이 지금 `[]` 를 돌려준다. 옵션 `refundLinks?: Array<{ relationName: string; metadata: Record<string, unknown>; createdAt: Date }>` 를 더해 그 `then` 이 `options.refundLinks ?? []` 를 돌려주게 하고:

```ts
    it('wallet 연결 없이 수집된 환불만 있으면 합계로 succeeded 요약(스펙 §7.5)', async () => {
      const { service } = makeContext({
        so: makeSo({ status: 'cancelled' }),
        refundLinks: [
          { relationName: 'order_lifecycle_refund_collected', metadata: { amount: 7000 }, createdAt: new Date('2026-10-07T01:00:00.000Z') },
          { relationName: 'order_lifecycle_refund_collected', metadata: { amount: 3000 }, createdAt: new Date('2026-10-07T00:00:00.000Z') },
        ],
      });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.refundStatus).toBe('succeeded');
      expect(r.refundSummary).toMatchObject({ status: 'succeeded', amount: 10000, lastUpdatedAt: '2026-10-07T01:00:00.000Z' });
    });
```

Run → FAIL

- [ ] **Step 2: 구현 — DTO**

`StoreCancelUnavailableReason` 에 `| 'cancel_requested'` 를 더하고, 그 swagger enum(L101~103)을 `['already_shipped', 'already_cancelled', 'channel_order', 'already_processing', 'digital_downloaded', 'cancel_requested']` 로. `StoreOrderActionsResponseDto` 에:

```ts
  @ApiPropertyOptional({
    enum: ['requested', 'rejected'],
    description: '채널 취소 요청 상태(#1016 35번). requested = 처리 중, rejected = 마지막 요청이 실패',
  })
  cancelRequestStatus?: 'requested' | 'rejected';
```

- [ ] **Step 3: 구현 — buildActionsView**

맨 앞(foRows 로드 다음)에:

```ts
    const cancelRequest = so.status === 'cancelled' ? null : await this.cancelRequests.latestFor(so.id);
    const cancelRequestStatus =
      cancelRequest?.status === 'requested' || cancelRequest?.status === 'rejected' ? cancelRequest.status : undefined;
```

환불 링크 조회의 `eq(relationName, 'cancellation_linked_wallet_refund')` 를 `inArray(relationName, ['cancellation_linked_wallet_refund', 'order_lifecycle_refund_collected'])` 로 바꾸고 select 에 `relationName` 을 더한 뒤:

```ts
      // 채널 주문의 환불은 채널이 한다 — 수집된 환불(order_lifecycle_refund_collected)이 그 기록이다(#1016 35번 §7.5).
      const walletLinks = refundLinks.filter((r) => r.relationName === 'cancellation_linked_wallet_refund');
      const collected = refundLinks.filter((r) => r.relationName === 'order_lifecycle_refund_collected');
      const collectedAmount = collected.reduce((sum, r) => {
        const amount = (r.metadata as Record<string, unknown>)?.amount;
        return sum + (typeof amount === 'number' ? amount : 0);
      }, 0);
      const latestLink = walletLinks[0];
```

(기존 코드의 `refundLinks[0]`·`refundLinks.find` 를 `walletLinks` 로 바꾼다.) `so.status === 'cancelled' && !overrideRefundStatus` 분기의 `else` 를:

```ts
        } else if (collected.length > 0) {
          refundStatus = 'succeeded';
        } else {
          refundStatus = so.walletIntentId ? 'pending' : 'none';
        }
```

`if (summaryLink) { … } else if (refundStatus !== 'none') { … }` 사이에:

```ts
      } else if (collected.length > 0) {
        refundSummary = buildRefundSummary({
          status: 'succeeded',
          amount: collectedAmount,
          manualRequired: false,
          lastUpdatedAt: collected[0].createdAt?.toISOString() ?? null,
        });
```

(`refundLinks` 는 `createdAt desc` 정렬이라 `collected[0]` 이 최근이다.) 액션 분기 사슬에서 `else if (hasShippedEvidence)` 다음, `else if (isChannelOrder)` 앞에:

```ts
    } else if (cancelRequestStatus === 'requested') {
      // 채널 취소가 처리 중 — 다시 누르면 같은 요청을 돌려받을 뿐이다
      availableActions.push('receipt');
      cancelUnavailableReason = 'cancel_requested';
```

반환 객체에 `cancelRequestStatus,` 를 더한다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts` → PASS. `npm run type-check` → 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 고객 액션 뷰에 취소 처리 중·실패와 수집된 환불 요약 (#1016 35번 PR-C)"
```

---

### Task 11: core — 정체 보드 «취소 요청 미반영»(5분)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts` (+ `.spec.ts`)
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts`
- Modify(필요하면): `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.spec.ts`

**Interfaces:**
- Produces: 단계 `cancel_request`(`ORDER_PROGRESS_STAGES` 의 `track` 다음), 세부 상태 `cancel_requested`·`cancel_edited`, `STUCK_AFTER_MS.cancel_request = 5 * MINUTE`

- [ ] **Step 1: 실패하는 테스트**

`order-progress.thresholds.spec.ts` 의 «스펙 §6 표» 테스트 기대값에 `cancel_request: 5 * 60_000,` 를 `track` 다음에 더한다. `order-progress.judge.integration.spec.ts` 의 취소 테스트들 다음에:

```ts
  it('열린 취소 요청 → cancel_request/cancel_requested, 진입 = 요청 시각(다른 단계보다 앞선다)', async () => {
    const at = new Date('2026-10-06T02:50:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', plannedAt: new Date('2026-10-01T00:00:00.000Z') });
      await tx.insert(wmsTables.salesOrderAmendments).values({
        salesOrderId: o.salesOrderId,
        amendmentKind: 'commercial',
        reasonCode: 'CHANNEL_CANCEL_REQUEST',
        deltas: [],
        metadata: { request: { kind: 'cancel' } },
        origin: 'operator',
        status: 'requested',
        createdAt: at,
      });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel_request', state: 'cancel_requested', outcome: null, estimatedEnteredAt: at.toISOString() });
  });

  it('수정됨 · 환불 미완 → cancel_request/cancel_edited · 닫힌 요청은 단계에 영향 없음', async () => {
    const edited = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await tx.insert(wmsTables.salesOrderAmendments).values({
        salesOrderId: o.salesOrderId,
        amendmentKind: 'commercial',
        reasonCode: 'CHANNEL_CANCEL_REQUEST',
        deltas: [],
        metadata: { request: { kind: 'cancel', stage: 'edited' } },
        origin: 'operator',
        status: 'requested',
      });
      return o.salesOrderId;
    });
    expect(edited).toMatchObject({ stage: 'cancel_request', state: 'cancel_edited' });

    const closed = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await tx.insert(wmsTables.salesOrderAmendments).values({
        salesOrderId: o.salesOrderId,
        amendmentKind: 'commercial',
        reasonCode: 'CHANNEL_CANCEL_REQUEST',
        deltas: [],
        origin: 'operator',
        status: 'rejected',
      });
      return o.salesOrderId;
    });
    expect(closed.stage).not.toBe('cancel_request');
  });
```

(파일 import 에 `wmsTables` 를 더한다. `one` 이 반환하는 행 필드 이름(`estimatedEnteredAt`)은 기존 테스트와 같다.)

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts` → FAIL. 통합: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- order-progress.judge` → FAIL

- [ ] **Step 2: 구현 — 기준**

`order-progress.thresholds.ts`: `ORDER_PROGRESS_STAGES` 의 `'track',` 다음에 `'cancel_request',`. `const MINUTE = 60_000;` 를 `HOUR` 위에 두고 `STUCK_AFTER_MS` 의 `track` 다음에:

```ts
  // 채널 취소 요청(#1016 35번 §5.5) — 보통 몇 초. 5분이면 명령이 처리되지 않았거나 결과가 유실됐다.
  cancel_request: 5 * MINUTE,
```

- [ ] **Step 3: 구현 — 판정 SQL**

`judgedRowsSql`:
- `has_fo AS (…)` 다음에 CTE:

```sql
    -- 열린 채널 취소 요청(#1016 35번) — 출고 보류 중이라 다른 단계는 멈춰 있다. 한 주문에 하나(부분 유니크).
    creq AS (
      SELECT a.sales_order_id, a.created_at,
             CASE WHEN a.metadata->'request'->>'stage' = 'edited' THEN 'cancel_edited' ELSE 'cancel_requested' END AS state
        FROM sales_order_amendments a
        JOIN so ON so.id = a.sales_order_id
       WHERE a.status = 'requested'
    ),
```

- `decided` 의 select 목록에 `cr.state AS creq_state, cr.created_at AS creq_at,` 를 더하고, `CASE` 의 첫 줄로 `WHEN cr.sales_order_id IS NOT NULL THEN 'cancel_request'` 를 넣고, `FROM so` 의 join 들 끝에 `LEFT JOIN creq cr ON cr.sales_order_id = so.id` 를 더한다
- 최종 SELECT 의 stage CASE 에 `WHEN 'cancel_request' THEN 'cancel_request'`, state CASE 에 `WHEN 'cancel_request' THEN d.creq_state`, 진입 시각 CASE 에 `WHEN 'cancel_request' THEN d.creq_at` 을 더한다

`candidateIdsSql` 끝에:

```sql
    UNION SELECT a.sales_order_id FROM sales_order_amendments a WHERE a.updated_at > ${since}
```

(주석 «갱신 대상» 목록에 «변경 기록(취소 요청)»을 더한다.)

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress --maxWorkers=2` → PASS(요약 스펙은 `ORDER_PROGRESS_STAGES` 를 펼쳐 비교하므로 그대로 통과해야 한다). `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- order-progress` → PASS. `npm run type-check` → 0

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-progress
git commit -m "feat(core): 정체 보드에 취소 요청 단계(5분) — 미반영·수정됨 환불 미완 (#1016 35번 PR-C)"
```

---

### Task 12: 창고 앱 — 차단 사유 «취소 처리 중»

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/batchStart.ts`
- Modify: `native/warehouse-app/src/domains/outbound/batchJoin.ts` (`JOIN_BLOCKER_TEXT`)
- Test: `native/warehouse-app/src/domains/outbound/batchStart.test.ts`

**Interfaces:**
- Consumes: core 차단 사유 `CANCEL_REQUESTED` (Task 7)
- Produces: `StartBlockReason` 에 `'CANCEL_REQUESTED'`

> 워크트리에 `native/warehouse-app/node_modules` 가 없으면 메인 체크아웃의 것을 심볼릭 링크한다: `ln -s /home/pauseb/workspace/almondyoung-server/native/warehouse-app/node_modules native/warehouse-app/node_modules` (커밋하지 않는다 — gitignore 대상인지 `git status` 로 확인).

- [ ] **Step 1: 실패하는 테스트**

`batchStart.test.ts` 의 `groupStartBlockers` describe 에:

```ts
  it('취소 처리 중 박스는 따로 묶어 맨 뒤에, 송장 사유로 섞지 않는다', () => {
    const groups = groupStartBlockers([
      blocker({ reason: 'CANCEL_REQUESTED', shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null, detail: 'CANCEL_REQUESTED: 취소 처리 중인 주문이 있습니다 (shipment s1)' }),
      blocker({ reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null, detail: 'WAYBILL_STALE: x' }),
    ]);
    expect(groups.map((g) => g.reason)).toEqual(['WAYBILL_NOT_READY', 'CANCEL_REQUESTED']);
    expect(groups[1].rows).toEqual(['4527-1697-8431 · 취소 처리 중']);
    expect(groups[1].title).toBe('취소 처리 중인 주문');
  });
```

`startBlockersOf` describe 에:

```ts
  it('CANCEL_REQUESTED 차단도 버리지 않는다', () => {
    const b = blocker({ reason: 'CANCEL_REQUESTED' });
    expect(startBlockersOf(new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [b]))).toEqual([b]);
  });
```

Run: `(cd native/warehouse-app && npx vitest run src/domains/outbound/batchStart.test.ts)` → FAIL

- [ ] **Step 2: 구현**

`batchStart.ts`:
- `export type StartBlockReason = 'INBOUND_PENDING' | 'STOCK_SHORT' | 'WAYBILL_NOT_READY' | 'CANCEL_REQUESTED';`
- `const REASONS: readonly StartBlockReason[] = ['INBOUND_PENDING', 'STOCK_SHORT', 'WAYBILL_NOT_READY', 'CANCEL_REQUESTED'];`
- `START_BLOCKER_TEXT` 에:

```ts
  CANCEL_REQUESTED: {
    title: '취소 처리 중인 주문',
    guidance: '취소가 끝나면 이 박스는 빠집니다. 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
  },
```

- `rowOf` 에 `if (b.reason === 'CANCEL_REQUESTED') return \`${tracking(b)} · 취소 처리 중\`;` 를 `WAYBILL_NOT_READY` 줄 앞에

`batchJoin.ts` `JOIN_BLOCKER_TEXT` 에 `CANCEL_REQUESTED: { title: '취소 처리 중인 주문', guidance: '취소가 끝날 때까지 이 박스는 넣을 수 없어요.' },`

(`BlockerText` 가 `Record<StartBlockReason, …>` 라 두 표 모두 빠지면 tsc 가 잡는다.)

- [ ] **Step 3: 통과 확인**

Run: `(cd native/warehouse-app && npx tsc -b && npx vitest run)` → PASS

- [ ] **Step 4: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound
git commit -m "feat(warehouse-app): 배치 시작·합류 차단 사유에 «취소 처리 중» (#1016 35번 PR-C)"
```

---

### Task 13: admin-web — 취소 요청 응답·주문 행·변경 기록·판매자센터

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts`, `cancel-request.shape.spec.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/sales-orders.client.ts` (`adminCancelSalesOrder`, `cancelSalesOrderByIntent`, 새 `resendCancelRequest`·`withdrawCancelRequest`)
- Modify: `apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.shape.ts` (`AmendmentRecord`)
- Modify: `apps/admin-web/src/features/order/history/hooks/use-order-rows.ts` (`OrderLineRow`, 상세 쿼리 `refetchInterval`)
- Modify: `apps/admin-web/src/features/order/history/components/modals/cancel-order-modal.tsx`
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx` (기능 열 L851~886, 타임라인 모달 L605~628)

**Interfaces:**
- Consumes: core `getOne().cancelRequest`(Task 5), 운영자 취소 응답(Task 6), 변경 기록 행(`reasonCode`, `metadata`)
- Produces:

```ts
export interface CancelRequestView { id: string; status: 'requested' | 'applied' | 'rejected' | 'superseded'; scope: 'full' | 'partial'; stage: 'edited' | null; convertedFromFull: boolean; requestedAt: string; rejection: { reasonCode: string; message: string; at: string } | null; outcome: { refundAmount: number; shippingCharge: number; shippingRefund: number; shippingNotAdjusted: boolean } | null }
export function toCancelRequestView(value: unknown): CancelRequestView | null;
export function cancelRequestFromAmendment(row: AmendmentRecord): CancelRequestView | null;
export type CancelAction = { kind: 'cancel'; label: '취소' | '강제취소' } | { kind: 'requested'; label: string } | { kind: 'rejected'; reason: string } | { kind: 'seller_center'; label: string };
export function cancelActionOf(row: { channel: string; orderStatus: string; cancelRequest: CancelRequestView | null }): CancelAction;
export function cancelRequestLine(view: CancelRequestView): string;
export type AdminCancelResponse = { status: string; refundStatus: string; refundAmount?: number; manualReason?: string | null } | { requestId: string; status: string; scope: 'full' | 'partial'; convertedFromFull: boolean };
export function isCancelRequested(r: AdminCancelResponse): r is Extract<AdminCancelResponse, { requestId: string }>;
export function hasOpenCancelRequest(details: ReadonlyArray<unknown>): boolean;
```

- [ ] **Step 1: 실패하는 테스트 — 순수 함수**

`cancel-request.shape.spec.ts`:

```ts
import {
  cancelActionOf,
  cancelRequestFromAmendment,
  cancelRequestLine,
  hasOpenCancelRequest,
  isCancelRequested,
  toCancelRequestView,
} from './cancel-request.shape';

const view = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'requested',
  scope: 'partial',
  stage: null,
  convertedFromFull: false,
  requestedAt: '2026-10-07T00:00:00.000Z',
  rejection: null,
  outcome: null,
  ...over,
});

describe('cancel-request shape', () => {
  it('뷰 읽기 — 모양이 깨지면 null', () => {
    expect(toCancelRequestView(view())).toEqual(view());
    expect(toCancelRequestView({ id: 'r1' })).toBeNull();
    expect(toCancelRequestView(null)).toBeNull();
  });

  it('변경 기록 행 — 취소 요청 행만, 메타데이터에서 같은 뷰를 만든다', () => {
    const row = {
      id: 'r1',
      salesOrderId: 's1',
      origin: 'operator',
      status: 'rejected',
      deltas: [],
      occurredAt: '2026-10-07T00:00:00.000Z',
      reasonCode: 'CHANNEL_CANCEL_REQUEST',
      metadata: {
        request: { kind: 'cancel', scope: 'full', convertedFromFull: false },
        rejection: { reasonCode: 'NOT_CANCELABLE', message: '거절', at: '2026-10-07T00:01:00.000Z' },
      },
    };
    expect(cancelRequestFromAmendment(row)).toMatchObject({
      id: 'r1',
      status: 'rejected',
      scope: 'full',
      rejection: { reasonCode: 'NOT_CANCELABLE' },
    });
    expect(cancelRequestFromAmendment({ ...row, reasonCode: 'CHANNEL_ORDER_MODIFIED' })).toBeNull();
  });

  it.each([
    [{ channel: 'naver', orderStatus: 'confirmed', cancelRequest: null }, { kind: 'seller_center', label: '네이버 판매자센터에서 취소' }],
    [{ channel: 'coupang', orderStatus: 'confirmed', cancelRequest: null }, { kind: 'seller_center', label: '쿠팡 판매자센터에서 취소' }],
    [{ channel: 'medusa', orderStatus: 'confirmed', cancelRequest: view() }, { kind: 'requested', label: '취소 요청됨' }],
    [{ channel: 'medusa', orderStatus: 'confirmed', cancelRequest: view({ stage: 'edited' }) }, { kind: 'requested', label: '수정됨 · 환불 미완' }],
    [
      { channel: 'medusa', orderStatus: 'confirmed', cancelRequest: view({ status: 'rejected', rejection: { reasonCode: 'NOT_CANCELABLE', message: '이미 출고', at: 'x' } }) },
      { kind: 'rejected', reason: '채널이 거절 · 이미 출고' },
    ],
    [{ channel: 'medusa', orderStatus: 'processing', cancelRequest: view({ status: 'applied' }) }, { kind: 'cancel', label: '강제취소' }],
    [{ channel: '3pl', orderStatus: 'confirmed', cancelRequest: null }, { kind: 'cancel', label: '취소' }],
  ])('행 → 취소 칸 %#', (row, expected) => {
    expect(cancelActionOf(row as never)).toEqual(expected);
  });

  it.each([
    [view(), '부분취소 요청 · 처리 중'],
    [view({ stage: 'edited' }), '부분취소 요청 · 수정됨 · 환불 미완'],
    [view({ status: 'applied', outcome: { refundAmount: 27500, shippingCharge: 3000, shippingRefund: 0, shippingNotAdjusted: false } }), '부분취소 반영 · 환불 27,500원 · 배송비 −3,000원'],
    [view({ status: 'applied', outcome: { refundAmount: 9000, shippingCharge: 0, shippingRefund: 3000, shippingNotAdjusted: false } }), '부분취소 반영 · 환불 9,000원 · 배송비 환불 3,000원'],
    [view({ status: 'applied', outcome: { refundAmount: 9000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: true } }), '부분취소 반영 · 환불 9,000원 · 배송비 미조정'],
    [view({ scope: 'full', status: 'applied' }), '전체취소 반영'],
    [view({ convertedFromFull: true }), '부분취소(출고분 제외) 요청 · 처리 중'],
    [view({ status: 'rejected', rejection: { reasonCode: 'OPERATOR_WITHDRAWN', message: 'm', at: 'x' } }), '부분취소 실패 · 요청 접음 · m'],
    [view({ status: 'superseded' }), '부분취소 요청 · 다른 변경으로 대체됨'],
  ])('변경 기록 한 줄 %#', (v, line) => {
    expect(cancelRequestLine(v as never)).toBe(line);
  });

  it('응답 가르기·열린 요청 감지', () => {
    expect(isCancelRequested({ requestId: 'r1', status: 'requested', scope: 'full', convertedFromFull: false })).toBe(true);
    expect(isCancelRequested({ status: 'cancelled', refundStatus: 'succeeded' })).toBe(false);
    expect(hasOpenCancelRequest([null, { cancelRequest: view() }])).toBe(true);
    expect(hasOpenCancelRequest([{ cancelRequest: view({ status: 'applied' }) }, { cancelRequest: null }])).toBe(false);
  });
});
```

Run: `npm run test:admin-web -- cancel-request.shape` → FAIL

- [ ] **Step 2: 구현 — shape**

`cancel-request.shape.ts`:

```ts
// src/lib/api/domains/orders/cancel-request.shape.ts
//
// 채널 주문 취소 요청(#1016 35번) 응답 정형·문구 순수 함수. admin-web 은 컴포넌트 테스트가 안 되므로 화면이 읽는 판정은 여기서 한다.
// 서버 원형: apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts (CancelRequestView)

import type { AmendmentRecord } from './sales-order-amendments.shape';

export interface CancelRequestView {
  id: string;
  status: 'requested' | 'applied' | 'rejected' | 'superseded';
  scope: 'full' | 'partial';
  stage: 'edited' | null;
  convertedFromFull: boolean;
  requestedAt: string;
  rejection: { reasonCode: string; message: string; at: string } | null;
  outcome: { refundAmount: number; shippingCharge: number; shippingRefund: number; shippingNotAdjusted: boolean } | null;
}

export type AdminCancelResponse =
  | { status: string; refundStatus: string; refundAmount?: number; manualReason?: string | null }
  | { requestId: string; status: string; scope: 'full' | 'partial'; convertedFromFull: boolean };

export type CancelAction =
  | { kind: 'cancel'; label: '취소' | '강제취소' }
  | { kind: 'requested'; label: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'seller_center'; label: string };

const CHANNEL_CANCEL_REQUEST_REASON = 'CHANNEL_CANCEL_REQUEST';
const STATUSES = new Set(['requested', 'applied', 'rejected', 'superseded']);
const SELLER_CENTER: Record<string, string> = { naver: '네이버', coupang: '쿠팡' };
const REJECTION_LABELS: Record<string, string> = {
  NOT_SUPPORTED: '자동 취소 불가 채널',
  ORDER_NOT_FOUND: '채널에 주문 없음',
  NOT_CANCELABLE: '채널이 거절',
  REFUND_FAILED: '환불 불가',
  OPERATOR_WITHDRAWN: '요청 접음',
};
const won = new Intl.NumberFormat('ko-KR');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectionOf(value: unknown): CancelRequestView['rejection'] {
  return isRecord(value) && typeof value.reasonCode === 'string' && typeof value.message === 'string'
    ? { reasonCode: value.reasonCode, message: value.message, at: typeof value.at === 'string' ? value.at : '' }
    : null;
}

function outcomeOf(value: unknown): CancelRequestView['outcome'] {
  if (!isRecord(value)) return null;
  const { refundAmount, shippingCharge, shippingRefund } = value;
  if (typeof refundAmount !== 'number' || typeof shippingCharge !== 'number' || typeof shippingRefund !== 'number') return null;
  return { refundAmount, shippingCharge, shippingRefund, shippingNotAdjusted: value.shippingNotAdjusted === true };
}

export function toCancelRequestView(value: unknown): CancelRequestView | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.status !== 'string' || !STATUSES.has(value.status)) return null;
  if (value.scope !== 'full' && value.scope !== 'partial') return null;
  return {
    id: value.id,
    status: value.status as CancelRequestView['status'],
    scope: value.scope,
    stage: value.stage === 'edited' ? 'edited' : null,
    convertedFromFull: value.convertedFromFull === true,
    requestedAt: typeof value.requestedAt === 'string' ? value.requestedAt : '',
    rejection: rejectionOf(value.rejection),
    outcome: outcomeOf(value.outcome),
  };
}

/** 변경 기록 행(`GET /sales-orders/:id/amendments`)에서 같은 뷰를 만든다. 취소 요청 행이 아니면 null. */
export function cancelRequestFromAmendment(row: AmendmentRecord): CancelRequestView | null {
  if (row.reasonCode !== CHANNEL_CANCEL_REQUEST_REASON || !isRecord(row.metadata)) return null;
  const request = row.metadata.request;
  if (!isRecord(request)) return null;
  return toCancelRequestView({
    id: row.id,
    status: row.status,
    scope: request.scope,
    stage: request.stage,
    convertedFromFull: request.convertedFromFull,
    requestedAt: row.occurredAt,
    rejection: row.metadata.rejection,
    outcome: row.metadata.outcome,
  });
}

export function cancelActionOf(row: { channel: string; orderStatus: string; cancelRequest: CancelRequestView | null }): CancelAction {
  const center = SELLER_CENTER[row.channel];
  if (center) return { kind: 'seller_center', label: `${center} 판매자센터에서 취소` };
  const request = row.cancelRequest;
  if (request?.status === 'requested') {
    return { kind: 'requested', label: request.stage === 'edited' ? '수정됨 · 환불 미완' : '취소 요청됨' };
  }
  if (request?.status === 'rejected' && request.rejection) {
    return { kind: 'rejected', reason: `${REJECTION_LABELS[request.rejection.reasonCode] ?? request.rejection.reasonCode} · ${request.rejection.message}` };
  }
  return { kind: 'cancel', label: row.orderStatus === 'processing' ? '강제취소' : '취소' };
}

export function cancelRequestLine(view: CancelRequestView): string {
  const name = view.scope === 'full' ? '전체취소' : view.convertedFromFull ? '부분취소(출고분 제외)' : '부분취소';
  switch (view.status) {
    case 'requested':
      return `${name} 요청 · ${view.stage === 'edited' ? '수정됨 · 환불 미완' : '처리 중'}`;
    case 'applied': {
      const o = view.outcome;
      if (!o) return `${name} 반영`;
      const shipping = o.shippingNotAdjusted
        ? '배송비 미조정'
        : o.shippingCharge > 0
          ? `배송비 −${won.format(o.shippingCharge)}원`
          : o.shippingRefund > 0
            ? `배송비 환불 ${won.format(o.shippingRefund)}원`
            : null;
      return [`${name} 반영`, `환불 ${won.format(o.refundAmount)}원`, shipping].filter(Boolean).join(' · ');
    }
    case 'rejected': {
      const r = view.rejection;
      return r ? `${name} 실패 · ${REJECTION_LABELS[r.reasonCode] ?? r.reasonCode} · ${r.message}` : `${name} 실패`;
    }
    case 'superseded':
      return `${name} 요청 · 다른 변경으로 대체됨`;
  }
}

export function isCancelRequested(r: AdminCancelResponse): r is Extract<AdminCancelResponse, { requestId: string }> {
  return 'requestId' in r && typeof r.requestId === 'string';
}

/** 상세 목록에 처리 중인 요청이 하나라도 있으면 true — 행을 잠깐 다시 읽어 «취소 요청됨»이 끝나는 걸 보인다. */
export function hasOpenCancelRequest(details: ReadonlyArray<unknown>): boolean {
  return details.some((d) => isRecord(d) && toCancelRequestView(d.cancelRequest)?.status === 'requested');
}
```

(`value.status as CancelRequestView['status']` 는 바로 앞 `STATUSES.has` 가 좁힌 값이다 — 좁힘 함수(`isStatus(value): value is …`)로 바꿔도 된다. 바꾸는 쪽을 권한다.)

`sales-order-amendments.shape.ts` 의 `AmendmentRecord` 에 `reasonCode?: string | null;`, `metadata?: Record<string, unknown>;` 를 더한다.

Run Step 1 → PASS

- [ ] **Step 3: 배선 — client·rows·modal·table**

`sales-orders.client.ts`:
- `adminCancelSalesOrder` 의 반환 타입을 `Promise<AdminCancelResponse>` 로(import)
- `cancelSalesOrderByIntent` 반환 타입에 `requestId?: string` 을 더한다
- 더한다:

```ts
  // 채널 취소 요청 다시 보내기·접기 (정체 보드 «취소 요청», #1016 35번)
  resendCancelRequest: async (id: string): Promise<CancelRequestView> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}/cancel-request/resend`, {});
    return response.data;
  },
  withdrawCancelRequest: async (id: string): Promise<CancelRequestView> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}/cancel-request/withdraw`, {});
    return response.data;
  },
```

`use-order-rows.ts`:
- `OrderLineRow` 에 `cancelRequest: CancelRequestView | null;`
- 행 조립에 `cancelRequest: toCancelRequestView(detail?.cancelRequest),` (모든 줄에 — 기능 열이 줄마다 그려진다)
- 상세 쿼리(`queryKey: ['sales-orders', 'details', orderIds]`)에 `refetchInterval: (query) => (hasOpenCancelRequest(query.state.data ?? []) ? 3000 : false),` — 처리 중 요청이 있는 동안만 3초마다 다시 읽는다

`cancel-order-modal.tsx`:
- `handleSubmit` 의 `const result = await cancelMutation.mutateAsync(…)` 다음을:

```ts
      if (isCancelRequested(result)) {
        // 채널 주문 — 채널이 취소·환불하고 수집으로 반영된다(#1016 35번). 결과는 주문 행의 배지가 보여 준다.
        toast.success(
          result.convertedFromFull ? '출고된 상품을 뺀 나머지의 취소를 요청했습니다.' : '취소를 요청했습니다.'
        );
        onOpenChange(false);
        return;
      }
      setCancelResult({ … 기존 그대로 … });
```

- 부분취소 안내 문단(«부분 취소 시 미출고 상품은 라인 단가 비중으로 자동 환불을 시도합니다…»)을 지운다(채널 주문은 채널이 계산하고, 그 문장은 이제 틀렸다)

`table/index.tsx` 기능 열의 `else` 분기(취소되지 않은 주문)에서 취소 `Button` 을:

```tsx
                {(() => {
                  const action = cancelActionOf(r);
                  if (action.kind === 'seller_center') {
                    return <span className="text-[11px] text-gray-500 whitespace-normal leading-tight">{action.label}</span>;
                  }
                  if (action.kind === 'requested') {
                    return (
                      <span className="inline-flex items-center h-7 px-2 rounded border border-amber-200 bg-amber-50 text-xs text-amber-700 whitespace-nowrap">
                        {action.label}
                      </span>
                    );
                  }
                  const open = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setSelectedOrder(r);
                    setShowCancelModal(true);
                  };
                  return (
                    <>
                      {action.kind === 'rejected' && (
                        <span className="text-[11px] text-red-600 whitespace-normal leading-tight">취소 실패 · {action.reason}</span>
                      )}
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-red-600 border-red-300 hover:bg-red-50" onClick={open}>
                        {action.kind === 'rejected' ? '다시 요청' : action.label}
                      </Button>
                    </>
                  );
                })()}
```

(import `cancelActionOf`. `React.MouseEvent` 가 이 파일에서 안 보이면 `import type { MouseEvent } from 'react'` 로.)

타임라인 모달의 «채널 변경» 블록 앞에:

```tsx
          {(() => {
            const requests = (amendments ?? []).flatMap((a) => {
              const view = cancelRequestFromAmendment(a);
              return view ? [view] : [];
            });
            return requests.length > 0 ? (
              <div className="mt-4 border-t px-1 pt-3">
                <p className="mb-2 text-sm font-medium">취소 요청</p>
                {requests.map((view) => (
                  <div key={view.id} className={view.status === 'requested' ? 'mb-1 text-sm text-amber-700' : 'mb-1 text-sm text-muted-foreground'}>
                    {cancelRequestLine(view)}
                  </div>
                ))}
              </div>
            ) : null;
          })()}
```

(import `cancelRequestFromAmendment`, `cancelRequestLine`.) `r.channel !== 'medusa'` 옆의 «채널 관리자센터 처리 후 완료 확인» 문구는 옛 기록용이라 그대로 둔다. 채널 주문에 «수동 완료»·«재시도»를 새로 띄우지 않는 건 이미 그렇다 — 새 요청은 `cancellation_linked_wallet_refund` 링크를 만들지 않는다.

- [ ] **Step 4: 확인**

Run: `npm run test:admin-web` → PASS, `(cd apps/admin-web && npx tsc --noEmit)` → 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 채널 주문 취소는 «취소 요청됨 → 반영», 실패 사유와 다시 요청, 판매자센터 안내 (#1016 35번 PR-C)"
```

---

### Task 14: admin-web — 정체 보드 «취소 요청» 단계와 조치

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts` (`BoardStageKey`, `BOARD_STAGES`, `STATE_LABELS`)
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.spec.ts`
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts`
- Modify: `apps/admin-web/src/features/order/stall-board/components/stage-orders.tsx`

**Interfaces:**
- Consumes: core 단계 `cancel_request`·상태 둘(Task 11), `resendCancelRequest`·`withdrawCancelRequest`(Task 13)
- Produces: `useResendCancelRequest()`, `useWithdrawCancelRequest()` — 성공 시 `['order-progress']`·`['sales-orders']` 무효화

- [ ] **Step 1: 실패하는 테스트**

`order-progress.shape.spec.ts` 의 단계 순서 기대를 `…'track', 'cancel_request', 'cancel', 'return_exchange', 'unclassified'` 로 바꾸고(번호 9칸 기대는 그대로), 더한다:

```ts
  it('취소 요청 단계의 세부 상태 이름', () => {
    expect(stateLabel('cancel_requested')).toBe('취소 요청 미반영');
    expect(stateLabel('cancel_edited')).toBe('수정됨 · 환불 미완');
  });
```

Run: `npm run test:admin-web -- order-progress.shape` → FAIL

- [ ] **Step 2: 구현 — shape**

`BoardStageKey` 에 `| 'cancel_request'`, `BOARD_STAGES` 의 `track` 다음에 `{ key: 'cancel_request', no: '', name: '취소 요청' },`, `STATE_LABELS` 에:

```ts
  cancel_requested: '취소 요청 미반영',
  cancel_edited: '수정됨 · 환불 미완',
```

- [ ] **Step 3: 구현 — 조치**

`mutations.ts`:

```ts
/** 정체 보드 «취소 요청» — 같은 requestId 로 명령을 다시 낸다 (#1016 35번) */
export const useResendCancelRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (salesOrderId: string) => orders.salesOrders.resendCancelRequest(salesOrderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-progress'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });
};

/** 정체 보드 «취소 요청» — 요청을 접어 보류를 푼다 */
export const useWithdrawCancelRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (salesOrderId: string) => orders.salesOrders.withdrawCancelRequest(salesOrderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-progress'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });
};
```

(같은 파일의 기존 import 관용(`orders`, `useMutation`, `useQueryClient`)을 따른다. 쿼리 키는 `query-keys.ts` 의 `progressSummary: ['order-progress','summary']`·`progressOrders` 가 `['order-progress', …]` 로 시작한다.)

`stage-orders.tsx`:
- 상단에 `const isCancelRequest = props.stage === 'cancel_request';`, `const resend = useResendCancelRequest(); const withdraw = useWithdrawCancelRequest(); const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null);`
- 헤더 `<tr>` 끝에 `{isCancelRequest && <th className="px-4 py-2 text-right font-medium">조치</th>}`
- 행 `<tr>` 끝에:

```tsx
                {isCancelRequest && (
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="mr-1.5 rounded border px-2 py-0.5 text-xs disabled:opacity-40"
                      disabled={resend.isPending}
                      onClick={() =>
                        resend.mutate(r.salesOrderId, {
                          onSuccess: () => toast.success('취소 요청을 다시 보냈습니다.'),
                          onError: (e) => toast.error(e instanceof Error ? e.message : '다시 보내지 못했습니다.'),
                        })
                      }
                    >
                      다시 보내기
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded border px-2 py-0.5 text-xs disabled:opacity-40',
                        confirmWithdraw === r.salesOrderId && 'border-red-600 text-red-600'
                      )}
                      disabled={withdraw.isPending}
                      onClick={() => {
                        if (confirmWithdraw !== r.salesOrderId) {
                          setConfirmWithdraw(r.salesOrderId);
                          return;
                        }
                        withdraw.mutate(r.salesOrderId, {
                          onSuccess: () => toast.success('요청을 접었습니다. 출고 보류가 풀렸습니다.'),
                          onError: (e) => toast.error(e instanceof Error ? e.message : '요청을 접지 못했습니다.'),
                          onSettled: () => setConfirmWithdraw(null),
                        });
                      }}
                    >
                      {confirmWithdraw === r.salesOrderId ? '접기 확인' : '요청 접기'}
                    </button>
                  </td>
                )}
```

(import: `useResendCancelRequest`, `useWithdrawCancelRequest` from `@/lib/services/orders/mutations`, `toast` from `sonner`. 접기는 보류를 푸는 조치라 두 번 누르게 한다 — 브라우저 confirm 대화상자를 쓰지 않는다.)

- [ ] **Step 4: 확인**

Run: `npm run test:admin-web` → PASS, `(cd apps/admin-web && npx tsc --noEmit)` → 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 정체 보드 «취소 요청» 단계 — 다시 보내기·요청 접기 (#1016 35번 PR-C)"
```

---

### Task 15: 스토어프론트 — 취소 «처리 중 → 완료»

**Files:**
- Modify: `web/almondyoung-storefront/src/lib/api/orders/store-orders.ts` (타입 L58~95)
- Create: `web/almondyoung-storefront/src/lib/orders/cancel-outcome.ts`, `cancel-outcome.test.ts`
- Modify: `web/almondyoung-storefront/src/components/orders/order-card/order-actions.tsx` (`handleCancelConfirm` L153~187)
- Modify: `web/almondyoung-storefront/src/domains/order/details/components/order-details-desktop.tsx` (L177~210)
- Modify: `web/almondyoung-storefront/src/domains/order/details/components/order-details-mobile.tsx` (L184~)
- Modify: `web/almondyoung-storefront/src/components/orders/order-status-badges.tsx` (`CANCEL_UNAVAILABLE_MESSAGES`)
- Modify: `web/almondyoung-storefront/src/i18n/messages/{ko,en,ja}/mypage.json`

**Interfaces:**
- Consumes: 액션 뷰 `cancelRequestStatus`, `cancel_requested` (Task 10)
- Produces:

```ts
export type CancelOutcome = 'cancelled' | 'rejected' | 'pending';
export function cancelOutcomeOf(actions: Pick<StoreOrderActionsResponse, 'orderStatus' | 'cancelRequestStatus'>): CancelOutcome;
export async function waitForCancelOutcome(
  read: () => Promise<Pick<StoreOrderActionsResponse, 'orderStatus' | 'cancelRequestStatus'> | null>,
  opts?: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<CancelOutcome>;
```

> 워크트리엔 스토어프론트 `node_modules` 가 없다. 없으면 `ln -s /home/pauseb/workspace/almondyoung-server/web/almondyoung-storefront/node_modules web/almondyoung-storefront/node_modules` (커밋하지 않는다).

- [ ] **Step 1: 실패하는 테스트**

`cancel-outcome.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { cancelOutcomeOf, waitForCancelOutcome } from "./cancel-outcome"

describe("cancelOutcomeOf", () => {
  it.each([
    [{ orderStatus: "cancelled" }, "cancelled"],
    [{ orderStatus: "confirmed", cancelRequestStatus: "rejected" as const }, "rejected"],
    [{ orderStatus: "confirmed", cancelRequestStatus: "requested" as const }, "pending"],
    [{ orderStatus: "confirmed" }, "pending"],
  ])("%o → %s", (actions, outcome) => expect(cancelOutcomeOf(actions)).toBe(outcome))
})

describe("waitForCancelOutcome — 2초마다 최대 30초", () => {
  const instant = () => Promise.resolve()

  it("끝나면 그 결과를 돌려준다", async () => {
    const reads = [{ orderStatus: "confirmed", cancelRequestStatus: "requested" as const }, { orderStatus: "cancelled" }]
    const read = () => Promise.resolve(reads.shift() ?? null)
    await expect(waitForCancelOutcome(read, { sleep: instant })).resolves.toBe("cancelled")
  })

  it("30초를 넘기면 pending 으로 멈춘다 — 15번 읽는다", async () => {
    let count = 0
    const read = () => {
      count += 1
      return Promise.resolve({ orderStatus: "confirmed", cancelRequestStatus: "requested" as const })
    }
    await expect(waitForCancelOutcome(read, { sleep: instant })).resolves.toBe("pending")
    expect(count).toBe(15)
  })

  it("읽기 실패(null)는 기다림을 끝내지 않는다", async () => {
    const reads = [null, { orderStatus: "confirmed", cancelRequestStatus: "rejected" as const }]
    const read = () => Promise.resolve(reads.shift() ?? null)
    await expect(waitForCancelOutcome(read, { sleep: instant })).resolves.toBe("rejected")
  })
})
```

Run: `(cd web/almondyoung-storefront && npx vitest run src/lib/orders/cancel-outcome.test.ts)` → FAIL

- [ ] **Step 2: 구현 — 타입·헬퍼**

`store-orders.ts`:
- `StoreCancelUnavailableReason` 에 `| "digital_downloaded" | "cancel_requested"` (앞의 것은 core 에 이미 있었는데 여기만 빠져 있었다)
- `StoreOrderActionsResponse` 에:

```ts
  /** 채널 취소 요청 상태(#1016 35번). requested = 처리 중, rejected = 마지막 요청이 실패 */
  cancelRequestStatus?: "requested" | "rejected"
```

`src/lib/orders/cancel-outcome.ts`:

```ts
import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"

type CancelState = Pick<StoreOrderActionsResponse, "orderStatus" | "cancelRequestStatus">

export type CancelOutcome = "cancelled" | "rejected" | "pending"

/** 취소는 비동기다(#1016 35번, ADR-0042) — 채널이 취소·환불하고 core 가 수집으로 반영한다. */
export function cancelOutcomeOf(actions: CancelState): CancelOutcome {
  if (actions.orderStatus === "cancelled") return "cancelled"
  if (actions.cancelRequestStatus === "rejected") return "rejected"
  return "pending"
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 스펙 §7.5: 2초마다 최대 30초 다시 읽는다. 30초를 넘기면 읽기만 멈춘다(pending). */
export async function waitForCancelOutcome(
  read: () => Promise<CancelState | null>,
  opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<CancelOutcome> {
  const intervalMs = opts.intervalMs ?? 2000
  const attempts = Math.floor((opts.timeoutMs ?? 30_000) / intervalMs)
  const sleep = opts.sleep ?? defaultSleep
  for (let i = 0; i < attempts; i += 1) {
    await sleep(intervalMs)
    const state = await read()
    if (!state) continue
    const outcome = cancelOutcomeOf(state)
    if (outcome !== "pending") return outcome
  }
  return "pending"
}
```

Run Step 1 → PASS

- [ ] **Step 3: i18n·배지 문구**

`ko/mypage.json` 의 `mypage.order.actions` 에(`cancelError` 다음):

```json
      "cancelRequested": "취소를 요청했어요. 처리하고 있습니다.",
      "cancelCompleted": "주문이 취소되었습니다.",
      "cancelRejected": "취소를 완료하지 못했습니다. 고객센터로 문의해 주세요.",
      "cancelStillProcessing": "취소 처리 중입니다. 잠시 뒤 주문 상세에서 확인해 주세요.",
```

`cancelUnavailable` 에 `"cancel_requested": "취소 처리 중입니다."`. `en`:

```json
      "cancelRequested": "Cancellation requested. We're processing it.",
      "cancelCompleted": "Your order has been cancelled.",
      "cancelRejected": "We couldn't complete the cancellation. Please contact customer service.",
      "cancelStillProcessing": "Cancellation is still processing. Please check the order details shortly.",
```

`cancelUnavailable.cancel_requested`: `"Cancellation is in progress."`. `ja`:

```json
      "cancelRequested": "キャンセルを受け付けました。処理中です。",
      "cancelCompleted": "注文がキャンセルされました。",
      "cancelRejected": "キャンセルを完了できませんでした。カスタマーセンターにお問い合わせください。",
      "cancelStillProcessing": "キャンセル処理中です。しばらくしてから注文詳細でご確認ください。",
```

`cancelUnavailable.cancel_requested`: `"キャンセル処理中です。"`. (`locale-parity.test.ts` 가 세 벌의 키가 같은지 본다.)

`order-status-badges.tsx` `CANCEL_UNAVAILABLE_MESSAGES` 에 `cancel_requested: "취소 처리 중입니다.",`

- [ ] **Step 4: 취소 화면 셋**

`order-details-desktop.tsx`·`order-details-mobile.tsx` 의 `handleCancelConfirm` 에서 `const message = …` 부터 `router.refresh()` 까지를:

```tsx
        setShowCancelDialog(false)
        // 채널 주문 취소는 비동기다 — 처리 중이면 잠깐 다시 읽어 결과를 알린다(#1016 35번 §7.5)
        const first = cancelOutcomeOf(result.actions)
        if (first === "pending") toast.info(tActions("cancelRequested"))
        const outcome =
          first === "pending"
            ? await waitForCancelOutcome(() => getOrderActionsByMedusaId(order.id).catch(() => null))
            : first
        if (outcome === "cancelled") toast.success(tActions("cancelCompleted"))
        else if (outcome === "rejected") toast.error(tActions("cancelRejected"))
        else toast.info(tActions("cancelStillProcessing"))
        router.refresh()
```

(import: `cancelOutcomeOf`, `waitForCancelOutcome` from `@/lib/orders/cancel-outcome`, `getOrderActionsByMedusaId` 를 기존 `cancelOrderByMedusaId` import 에 더한다. `getOrderActionsByMedusaId` 는 `"use server"` 모듈의 서버 액션이라 클라이언트에서 부를 수 있다. `cancelSuccess*` 네 키는 다른 곳에서 안 쓰이면 세 로케일에서 함께 지운다 — `grep -rn "cancelSuccess" web/almondyoung-storefront/src` 로 확인.)

`order-actions.tsx` 의 같은 블록(하드코딩 한국어)을:

```tsx
        setShowCancelDialog(false)
        const first = cancelOutcomeOf(result.actions)
        if (first === "pending") toast.info("취소를 요청했어요. 처리하고 있습니다.")
        const outcome =
          first === "pending"
            ? await waitForCancelOutcome(() => getOrderActionsByMedusaId(orderId).catch(() => null))
            : first
        if (outcome === "cancelled") toast.success("주문이 취소되었습니다.")
        else if (outcome === "rejected") toast.error("취소를 완료하지 못했습니다. 고객센터로 문의해 주세요.")
        else toast.info("취소 처리 중입니다. 잠시 뒤 주문 상세에서 확인해 주세요.")
        router.refresh()
```

- [ ] **Step 5: 확인**

Run: `(cd web/almondyoung-storefront && npx vitest run)` → PASS(로케일 동등성 포함), `npx tsc --noEmit -p web/almondyoung-storefront/tsconfig.json` → 0(이 앱은 `next build` 가 타입 오류를 무시하므로 이것만 판정이다)

- [ ] **Step 6: 커밋**

```bash
git add web/almondyoung-storefront/src
git commit -m "feat(storefront): 주문 취소 «처리 중 → 완료», 실패 안내 (#1016 35번 PR-C)"
```

---

### Task 16: 문서 — 스펙·모듈 주석

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` (§5.4, §5.3, §7.2, §7.4, §11, §12)
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts` (소비 정책 주석의 «4개 이벤트»)

- [ ] **Step 1: 스펙 반영**

- §5.4 «`OrderModified`» 항목을: «수집된 변경의 `snapshot.cancelRequests`(channel-adapter 가 Medusa `metadata.partialCancels` 에서 싣는다)에 열린 요청의 기록이 있을 때만 맞춘다. 물리 취소는 델타가 요청 줄과 정확히 같을 때 운영자 범위로 한 번 반영하고(`metadata.request.appliedAt`), `stage = edited` 면 요청을 연 채 «수정됨 · 환불 미완», `refunded` 면 `applied` + `outcome`. 어긋나면 `superseded`(`CHANNEL_CHANGE_MISMATCH`), 물리 취소가 도메인 거절되면 `superseded`(`APPLY_REFUSED`) — 둘 다 델타는 5번 규칙. 왜: 수정 확정 뒤 환불 실패에도 주문이 줄어 `OrderModified` 가 나가고, 환불 성공은 items·total 을 바꾸지 않아 다시 오지 않는다(2026-10-07 사용자 결정)»
- §5.3 표 아래에: «송장 발급은 명령 트랜잭션에서 박스 행을 `FOR UPDATE` 로 잠근 뒤 묻는다(원래 아무것도 잠그지 않았다). 발송 사전검사는 라벨 렌더도 지나므로 보류 중엔 라벨도 막힌다. 배치 시작·합류의 차단 사유는 `CANCEL_REQUESTED`(창고 앱이 모르는 사유는 버리므로 앱도 함께 바꿨다)»
- §5.2 끝에: «부분 요청이 남는 수량을 0 으로 만들면 전체취소로 보낸다. 채널 줄 번호가 없는 줄의 부분 요청은 400 — 명령 `lines[].channelOrderItemId` 는 `sales_order_lines.channel_order_item_id`(곧 Medusa 줄 id)»
- §7.2 끝에 «`OrderModified.snapshot.cancelRequests?`(PR-C 가 더함) — 비면 키를 생략한다(해시 입력이라)»
- §11 PR-C 행 내용에 «+ 계약 `OrderModified.snapshot.cancelRequests` + channel-adapter Medusa 수집 + 창고 앱 차단 사유», 배포 직후 칸에 «옛 core 태스크는 거절·정체 사실을 버린다 → 5분 정체 보드(§10-5 반대 방향). 창고 앱 배포 전에는 «취소 처리 중» 박스가 차단 목록에서 빠져 보인다»
- §12 core 항목의 «확정 맞추기(정확히 맞음 → 운영자 범위 적용 / 일부 → 나머지 5번 / 안 맞음)» 뒤에 «/ edited → refunded 두 번에 걸친 확정 / 안 맞음 → superseded»
- §9-12 끝에 «PR-C: 전체취소 수집이 열린 부분 요청을 `superseded`(`CHANNEL_FULL_CANCEL`)로 닫는다»

- [ ] **Step 2: 모듈 주석**

`sales-order.module.ts` 의 «이 앱이 구독하는 4개 이벤트는 전부 `orders.events.v1` 이고» 를 «이 앱이 구독하는 6개 이벤트(…, `ChannelOrderCancelRejected`·`ChannelOrderCancelStalled` 포함)는 전부 `orders.events.v1` 이고» 로. 같은 단락의 «발행자는 channel-adapter 의 order publisher 2벌 + 자체 outbox dispatcher» 가 새 두 사실에도 맞는지 확인한다(PR-B 의 `ChannelOrderCancelRepository` 가 같은 아웃박스 `enqueue` 를 쓴다 — 맞다).

- [ ] **Step 3: 전체 게이트**

Run:
```bash
npm run type-check
npx jest --maxWorkers=2
(cd apps/admin-web && npx tsc --noEmit) && npm run test:admin-web
npx tsc --noEmit -p web/almondyoung-storefront/tsconfig.json && (cd web/almondyoung-storefront && npx vitest run)
(cd native/warehouse-app && npx tsc -b && npx vitest run)
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local
npm run audit:consume-validation -- --gate
```
Expected: 전부 0 / 초록(통합은 메모리의 «develop 부터 RED» 목록과 대조 — 이 PR 이 새로 만든 빨강이 없어야 한다)

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md apps/core/src/modules/sales-order/sales-order.module.ts
git commit -m "docs: PR-C 의 계획 단계 발견(부분취소 진행 기록·관문 잠금·차단 사유)을 스펙에 반영 (#1016 35번 PR-C)"
```

---

## 배포 메모 (PR 본문에 옮긴다)

- **마이그 1건, additive → `migrate → deploy`.** 새 core 가 `requested` 를 쓰는데 CHECK 가 옛것이면 요청이 전부 500 이다
- **배포 직후 전환된다.** 채널(Medusa) 주문의 운영자·고객·wallet 승인 취소가 요청 경로를 탄다. 옛 역투영(`CoreOrderCancelled`)은 살아 있어 확정 뒤 Medusa 에 «이미 취소됨»으로 무해하게 간다 — 지우는 건 PR-D(이 PR 배포가 끝난 뒤)
- **롤링 중:** 옛 core 태스크는 `ChannelOrderCancelRejected`·`Stalled` 를 버린다 → 요청이 `requested` 로 남아 5분 뒤 정체 보드. 새 core 가 옛 channel-adapter 에 명령을 보내도 같은 곳으로 간다
- **창고 앱은 따로 배포된다.** 새 앱 전에는 «취소 처리 중» 차단이 목록에서 빠져 «시작 안 됨 + 사유 없음»으로 보일 수 있다
- **admin-web·스토어프론트가 core 보다 늦게 뜨면:** admin 취소 대화상자는 `{ requestId }` 응답을 모르는 옛 패널(«환불 수동 처리 필요»)로 보인다 — 잘못된 안내지만 상태는 맞다. 스토어프론트는 «주문이 취소되었습니다» 토스트를 띄운다(실제로는 처리 중). 한 SST 스택이라 같은 배포에 나간다
- **수동 스모크(로컬 E2E, 브라우저 로그인은 사람):** 카드 전체취소 · 쿠폰 쓴 주문의 부분취소 · 조건부 무료배송 미달 부분취소(+ 그룹 통째 취소 뒤 고객 주문 상세의 «총 결제금액»이 설명되는 숫자인지 — 계획 단계 발견 9) · 고객 취소(처리 중 → 완료) · 거절 경로(naver 주문 취소 → 판매자센터 문구) · 정체 보드 다시 보내기·요청 접기 · 열린 요청 중 송장 발급 거절
