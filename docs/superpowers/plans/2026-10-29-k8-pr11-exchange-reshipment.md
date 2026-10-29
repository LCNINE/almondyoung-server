# K8 PR 11 — 교환(판매자 잘못 · 같은 품목 재발송) 커널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객·CS 가 판매자 잘못 사유로 «교환»을 접수하면, 회수품 검수 뒤(또는 CS 가 연 때) core 가 같은 품목을 새 상자로 내보내고, Medusa 는 돈 없이(차액 0) 반품 수령 + 대체 품목 줄로 장부를 닫는다.

**Architecture:** 교환은 Medusa 의 «교환 표지가 붙은 반품»이다(`almondReturn.kind = 'exchange'`, `OrderExchange` 객체는 쓰지 않는다 — 설계 §4.9 X3). 접수·취소·회수·도착·검수는 반품 길 그대로다. 갈라지는 곳은 셋: ① core 가 접수 사실에서 같은 판매주문에 «교환 줄»을 만들고, 검수(또는 CS 문)에서 그 줄로 기존 FO 에 FOI·draft 상자를 연다. ② Medusa 정산이 환불 대신 주문 수정으로 variant 없는 대체 품목 줄을 넣어 차액을 0 으로 되돌린다. ③ channel-adapter 스냅샷과 core 변경 판정이 교환 줄을 서로 비교하지 않는다.

**Tech Stack:** NestJS · Drizzle(postgres.js) · `@app/events` · Medusa 2.13.4 워크플로(order edit·return receive) · zod 이벤트 계약.

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §4.9 «PR 11 설계»(정본 — 결정 X1~X3, 모양 E1~E12), 반품 길은 §4.2~§4.7. 이전 PR 본문(#1146~#1175)의 숙제 중 이 PR 몫: #427(교환 완료가 새 물건을 안 낸다), `claim-quantities.sql.ts:7`·`claim-statuses.ts:5` 의 «교환은 PR 11 이 다시 더한다»(이 설계에선 교환도 `customer_returns` 행이라 이미 센다 — 주석만 고친다). PR 10 N9 «core 가 `exchange` 액션을 다시 켠다»와 #934 의 교환 폼은 **PR 11b**(E12).

## 사전 실측 (2026-10-29, Medusa 2.13.4, 로컬 통합 러너)

`OrderExchange` 로 A 30,000 × 3 주문의 1개를 같은 variant 로 교환(배송 방법 없음, 새 품목 `unit_price` = 30,000). 이 표가 X3 의 근거다 — Task 1 은 **채택한 길**(반품 + 수령 뒤 주문 수정)의 사실을 같은 방식으로 못 박는다.

| 단계 | 할인 없음 | 5,000 주문 할인 |
| --- | --- | --- |
| 확정 직후 차액(summary = `loadOrderView`) | **+30,000** | +30,000 |
| 확정 직후 NOT_PAID 결제 컬렉션 | 0 | **1건 1,666.67** |
| 수령 뒤 차액 | 0 | **+1,666.67**(남는다) |
| Medusa 재고 예약(주문 전체) | 결제 때 1건 그대로 | 같음 |
| 수령 전 `cancelOrderExchangeWorkflow` | 성공, 차액 0 | — |
| `order_exchange.difference_due` | null | null |
| 새 품목 `metadata` | 넘긴 값 그대로 줄에 남는다 | 같음 |

## 결정 (이 계획에서 정한 것)

| # | 결정 |
| --- | --- |
| N1 | 접수 라우트는 새로 만들지 않는다 — `POST /store/orders/:id/returns`·`POST /admin/orders/:id/returns` 본문에 `kind?: 'return' \| 'exchange'`(기본 `return`). `ReturnRequestRecord.kind?: 'exchange'`(반품이면 칸 없음 — 옛 기록 모양 그대로), 해시에 `kind` 를 넣되 `return` 이면 넣지 않는다(옛 반품의 해시가 그대로) |
| N2 | 교환 판정은 `planReturnRequest` 뒤 한 줄: 확정된 부담 주체가 `seller` 가 아니면 `ReturnRequestRejected('exchange_requires_seller_fault')`. CS 기타 사유는 `operatorFeeBearer: 'seller'` 일 때만 통과 |
| N3 | 정산 갈래는 `settleOrderReturn` 안이다. 교환 기록이면 수령 «전»에 `holdDeduction`(금액 > 0)·`alreadyRefundedAmount`·`closesMissing` 중 하나라도 있으면 `ReturnSettleRejected('exchange_settle_unsupported')`. 수령은 지금 그대로, 청구 단계는 부담 주체 `seller` 라 0 이다. 그다음 환불 대신 `addExchangeReplacements`(Task 4) → 기록 `stage: 'exchanged'`, `refundAmount: 0`, `exchangeItems` |
| N4 | 대체 품목 줄 = variant 없는 사용자 정의 줄. `title` = 원래 품목 `title`, `quantity` = 그 품목의 `received + dismissed`, `unit_price` = (`unitPrice × q − cancelledAdjustmentShare(adjustments, quantity, quantity − q)`) ÷ q — **자르지 않는다**. `metadata.almondExchange = { requestId, sourceItemId, variantId }`. 주문 수정 `internal_note` 태그 `return-exchange:<requestId>` |
| N5 | 주문 수정 확정 뒤 `loadOrderView` 차액의 절댓값이 1 이상이면 `Error`(일시 — channel-adapter 가 다시 시도, 12번 뒤 core `stalled` → 사람). 같은 requestId 재시도는 태그로 이미 확정된 수정을 찾아 그 줄을 `exchangeItems` 로 읽고, 열린 수정이면 `cancelOpenOrderEdit` 뒤 다시 넣는다(`ensureNoDanglingChange` 꼴) |
| N6 | 선환불(`prepayOrderReturn`)은 교환 기록을 `ReturnPrepayRejected('exchange_unsupported')` 로 닫는다(기록 전 거절 — 라우트가 400 `return_prepay_rejected` + reason). core 가 먼저 막으므로(N15) 뒷문이다 |
| N7 | 교환 취소는 반품 취소 그대로 + 한 줄: core 자격 응답의 그 반품 `exchangeReleased === true` 면 `ReturnRequestRejected('exchange_released')`(Medusa 취소 «전», 회수 놓아주기 «전») |
| N8 | `shippingPlanLines` 는 `metadata.almondExchange` 가 있는 줄을 뺀다 — `OrderLine` 에 `exchangeReplacement: boolean` 칸을 `loadOrderView` 가 채운다 |
| N9 | channel-adapter `buildSnapshot` 은 `metadata.almondExchange` 가 있는 품목을 줄로 싣지 않는다. 반품 관측은 `kind` 를 싣고, 정산 관측은 `stage` 가 `exchanged` 인 기록도 읽어 `ChannelReturnSettled`(`refundAmount 0`, `refundMode 'auto'`, `settledAt` = 기록의 `exchangedAt`, `exchangeItems`)를 낸다 |
| N10 | 계약: `ChannelReturnRequested.kind?: 'return' \| 'exchange'`, `ChannelReturnSettled.exchangeItems?: Array<{ sourceItemId; itemId; quantity }>` — 선택 칸, 기존 이름. 옛 소비자는 칸을 버린다(`z.object` 기본). 개통 전(D9 — 자격 0)이라 배포 순서 제약은 «한 배치» 하나 |
| N11 | core 마이그 하나(expand): enum `customer_return_kind`(`return`·`exchange`), `customer_returns.kind NOT NULL DEFAULT 'return'`, `customer_returns.exchange_released_at timestamptz`, `customer_returns.exchange_released_by uuid`, `sales_order_lines.exchange_return_line_id uuid` FK → `customer_return_lines.id` `ON DELETE RESTRICT` + 부분 unique(NOT NULL). 이름 `add-customer-exchange` |
| N12 | 교환 줄 = 같은 판매주문의 새 `sales_order_lines` 행: `variantId`·`productName`·`fulfillmentKind`·`requiresShipping`·`channelProductId` 는 원래 줄에서, `quantity` = 반품 줄 수량, `unitPrice 0`, `totalPrice 0`, `channelOrderItemId null`, `exchangeReturnLineId` = 반품 줄 id. 구성은 원래 줄의 굳은 구성을 복사(`LineCompositionManager.copyFrozen`, 출처 값도 복사). 원래 줄에 굳은 구성이 없으면 `BadRequestError` — 접수 사실 전체를 거절한다(구성 없는 반품 줄을 거절하는 N3 과 같은 자리) |
| N13 | `CustomerExchangeReleaser.release(trx, { customerReturnId, actorId })` — 잠근 기록이 `kind 'exchange'` 이고 `exchange_released_at` 가 null 일 때만 연다(있으면 아무것도 안 하고 `false`). 판매주문을 `FOR UPDATE` → FO(없으면 `Error`) → 교환 줄마다 구성 × 수량으로 FOI(`status 'pending'`) → `openShipment`(owner = FO 창고, `status 'draft'`, `shippingProfileId` = `compatibleShippingProfileId(SKU 들)`, `recipientSnapshot` = `readPickupSource(trx, id)` 가 `kind 'ok'` 면 그 `snapshot`(회수지와 같은 주소), 아니면 판매주문 `shippingAddress`) → `acquireStockAvailabilityLocks` → 줄마다 `reservePartial` → 하나도 안 움직였으면 `recompute` → `reprojectFulfillmentOrders([fo.id])` → `exchange_released_at/by` 쓰기. `true` 반환 |
| N14 | 부르는 곳: ① `recordInspection` 의 보류 없는 갈래(정산 명령과 같은 트랜잭션, `actorId` = 검수자) ② 새 CS 문 `POST admin/customer-returns/:id/exchange-release`(`order.claim.write`) — `held` 면 `held → inspected` + 정산 명령(명령 칸 `{}`) + release, `expected`·`arrived` 면 release 만(선발송), 그 밖은 409. 같은 요청의 재전송은 view 를 돌려준다 |
| N15 | core 의 다른 CS 문 셋(`settleHeld`·`requestPrepay`·`closeMissing`)은 `kind 'exchange'` 를 `BadRequestError('교환은 …')` 로 거절한다 |
| N16 | 취소 사실(`recordCancelled`): 교환이고 `exchange_released_at` 가 있으면 `ConflictError`(DLQ — 사람), 아니면 지금처럼 `cancelled` + 그 교환 줄 삭제(구성은 cascade). 정산 사실(`recordSettled`): 교환이면 `exchangeItems` 의 `sourceItemId` = 반품 줄 `channel_order_item_id` 로 교환 줄을 찾아 `channel_order_item_id = itemId` 를 쓴다. `completed`·`SalesOrderReturned` 는 내지 않는다(E10) |
| N17 | 자격 응답 `customerReturns[]` 에 `kind`·`exchangeReleased`(released_at not null). Medusa 파서는 두 칸이 없으면 `return`·`false` 로 읽는다 |
| N18 | core 변경 판정 `diffChannelSnapshot` 은 `EffectiveSalesOrder.lines` 에서 교환 줄을 뺀다(`lockEffectiveOrder` 가 `exchangeReturnLineId` 를 싣는다). 취소 계획 `planCancellation` 은 교환 줄을 계획에 넣지 않고, 교환 줄을 지목한 줄 취소는 `BadRequestError` |
| N19 | 고객 이벤트 `kind`: `recordRequested`·도착(`recordArrival`)이 기록의 `kind` 를 싣는다 |

## Global Constraints

- 트랜잭션: `this.dbService.run(fn, tx)`, 공개 메서드 `tx?: DbTx` 마지막, private 헬퍼 `tx: DbTx` 필수(ADR-0025). `db.query.*`·`with`·`any`·`as` 금지(Inventory Query Rules).
- 마이그: `npm run db:generate:core -- --name add-customer-exchange`. expand → 배포 `migrate → deploy`. `schema` 와 `drizzle/` 을 한 커밋에. 새 enum 값을 같은 마이그 안에서 쓰지 않는다(§7).
- core·channel-adapter·Medusa·event-contracts 는 **한 배포 배치**. 고객 자격은 출고 개통 전 0 이라(D9) 롤링 중 교환이 생길 길은 CS 접수뿐이다 — 배포 중 CS 교환 접수 금지를 PR 본문에 적는다.
- 새 HTTP 라우트는 권한 데코레이터 필수(`route-classification.spec.ts`). CS 문은 `:id/missing-closure` 와 같은 묶음. 컨트롤러를 고친 뒤 `npx jest scripts/security`(IDOR 줄 좌표).
- 상자 쓰기는 커널 도구만(`openShipment`) — `insertShipment`·`insertShipmentLine` 은 커널 폴더 밖 금지(`shipment-writes.guard.spec.ts`). FOI·FO 상태는 `reprojectFulfillmentOrders` 가 쓴다(`fulfillment-order-status-writes.guard.spec.ts` 가 빨가면 그 가드의 허용 목록에 근거와 함께 올린다). 구성 행은 `LineCompositionManager` 만 쓴다.
- Medusa: 교환·클레임 기본 라우트는 막힌 채다(`reject-default-return-writes.ts`). `OrderExchange`·`OrderClaim` 워크플로를 부르지 않는다. 같은 주문 잠금 `orderCancelLockKey`.
- 거절 코드 정본은 Medusa `ReturnRejectReason` — 새 값마다 스토어프론트 문구 키를 더한다(`scripts/storefront/medusa-return-parity.spec.ts`). 문구는 고객용 한 줄.
- 통합 스펙: core 는 `describeIfDb` + scratch DB `--runInBand`, Medusa 는 `scripts/local/run-medusa-integration.sh --testPathPattern <이름>`(postgres+redis). 스펙 안 `dotenv.config()` 금지.
- Medusa 타입: `npx tsc --noEmit -p apps/medusa/tsconfig.json` — 기존 3건(`src/admin/lib/sdk.ts`×2, `confirm-purchase.unit.spec.ts`)만.
- 기준선 실패: 루트 `npx jest` 의 admin-web 근태 4건(ICU), core 통합 `expected-arrivals-parity`·`unified-reservation`·`cancellation-plan` «인쇄 줄»(불안정)·`waybill.manager` ERROR-04/05.

## Review Focus

1. **할인이 3개에 나뉜 줄의 1개 교환**(단가 30,000, 할인 5,000) → 정산 뒤 차액 정확히 0, NOT_PAID 0, 환불 0. 대체 줄 단가를 원 단위로 자르면 0.33원이 남아 N5 가 영원히 일시 실패한다. → Task 1(실측), Task 4(통합).
2. **선발송한 교환을 고객이 취소하려 한다** → Medusa 가 `exchange_released` 로 거절하고 회수도 놓아주지 않는다. 놓아주기를 먼저 하면 물건만 나가고 회수가 사라진다. → Task 5.
3. **교환 줄이 생긴 뒤 같은 주문의 다음 폴링**(스냅샷 해시가 바뀐 OrderModified) → core 반영 대기 변경 0건, 교환 줄 수량 그대로. 판정이 교환 줄을 «스냅샷에 없음 → 0 으로 정정»으로 읽으면 교환품 출고가 취소된다. → Task 6(스냅샷), Task 9(판정).
4. **보류 없는 검수 트랜잭션이 재고 부족을 만난다** → 검수·정산 명령은 커밋되고 교환 상자는 draft(덜 잡힘)로 남는다. 예약 실패로 검수 전체가 롤백되면 창고가 검수를 다시 해야 한다. → Task 9.
5. **교환 상자가 배송완료된 뒤의 판매주문 상태와 재반품** → 판매주문은 `delivered` 로 끝나고, 교환품(정산 뒤 id 가 이어진 줄)은 자격 API 에서 `deliveredUnits` 가 그 수량이다. → Task 9.

---

### Task 1: 채택한 길의 Medusa 전제 실측

**Files:**
- Create: `apps/medusa/integration-tests/http/exchange-premises.spec.ts` (계획 전 `OrderExchange` 실측은 위 표에 있고 파일은 남기지 않았다)

**Interfaces:**
- Consumes: `requestOrderReturn`(지금 모양, 사유 `defective`), 코어 `beginReceiveReturnWorkflow`·`receiveItemReturnRequestWorkflow`·`dismissItemReturnRequestWorkflow`·`confirmReturnReceiveWorkflow`, `beginOrderEditOrderWorkflow`·`orderEditAddNewItemWorkflow`·`requestOrderEditRequestWorkflow`·`confirmOrderEditRequestWorkflow`, `loadOrderView`, `partialCancelOrder`(지금 모양).
- Produces: 없음(사실 고정). 이 스펙이 빨가면 N4·N5 가 바뀐다 — 단언을 구부리지 말고 관측값과 함께 멈춘다.

- [ ] **Step 1: 스펙 작성** — 픽스처는 `return-prepay-premises.spec.ts` 와 같다(A 30,000, `PP5000`). 수령 뒤 주문 수정으로 variant 없는 줄(`title`, `quantity`, `unit_price`, `metadata`)을 넣는 헬퍼 하나를 스펙 안에 둔다. 테스트 셋:
  - `할인 없는 주문 1개 수령 → 대체 줄 30,000 → 차액 0, NOT_PAID 0, 예약 수 그대로`
  - `5,000 할인 3개 중 1개 폐기(dismiss) → 대체 줄 단가 28,333.333… → 차액 |x| < 0.01, NOT_PAID 0` (단가 = `30000 − 5000/3`, 자르지 않음)
  - `대체 줄의 metadata·title 이 주문 품목에 남고 variant_id 는 null`
  (대체 줄이 있는 주문의 부분취소는 N8 이 고치므로 Task 4 의 테스트다.)

- [ ] **Step 2: 실행** — `scripts/local/run-medusa-integration.sh --testPathPattern exchange-premises` → 셋 PASS.

- [ ] **Step 3: Commit** — `test(medusa): K8 PR11 교환 전제 — 수령 뒤 대체 줄로 차액 0`

### Task 2: 이벤트 계약 두 칸

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts`(`ChannelReturnRequestedPayload`·스키마, `ChannelReturnSettledPayload`·스키마)
- Test: 같은 폴더의 계약 스펙(없으면 `packages/event-contracts/streams/__tests__/orders.stream.channel-return.spec.ts`)

**Interfaces:**
- Produces: `ChannelReturnRequestedPayload.kind?: CustomerReturnKind`, `export const CUSTOMER_RETURN_KINDS = ['return', 'exchange'] as const`, `export type CustomerReturnKind`, `ChannelReturnSettledPayload.exchangeItems?: Array<{ sourceItemId: string; itemId: string; quantity: number }>`(quantity 양의 정수, 배열 min 1).

- [ ] **Step 1: 실패하는 테스트** — `kind 'exchange' 를 받는다`, `kind 'swap' 은 거절`, `kind 없는 옛 payload 그대로 통과`, `exchangeItems 빈 배열 거절`, `exchangeItems 없는 옛 settled 통과`.
- [ ] **Step 2: 실행해 FAIL 확인** — `npx jest packages/event-contracts -t channel-return`
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS 확인**
- [ ] **Step 5: Commit** — `feat(event-contracts): 반품 접수 kind·정산 exchangeItems (K8 PR11)`

### Task 3: Medusa 교환 접수

**Files:**
- Modify: `apps/medusa/src/workflows/orders/returns/load-return-order.ts`(`ReturnRequestRecord.kind?`, `readReturnRequestRecord` 가 `kind` 를 읽는다 — `'exchange'` 외 값이면 기록 전체 null)
- Modify: `apps/medusa/src/workflows/orders/returns/request-order-return.ts`(`RequestOrderReturnInput.kind?`, 해시, N2 판정, 결과 `kind`)
- Modify: `apps/medusa/src/workflows/orders/returns/plan-return-request.ts`(`ReturnRejectReason` 에 `exchange_requires_seller_fault`·`exchange_released` — 둘을 여기서 한 번에 더해 parity 를 한 번만 고친다)
- Modify: `apps/medusa/src/api/orders-returns/parse-return-input.ts`(`kind` — `'return' | 'exchange'` 외 값은 400 `invalid_data`)
- Modify: 스토어프론트 거절 문구 표 두 곳(`scripts/storefront/medusa-return-parity.spec.ts` 가 가리키는 파일)·admin-web 거절 표 — 새 코드 둘
- Test: `apps/medusa/src/workflows/orders/returns/__tests__/plan-return-request.unit.spec.ts`(또는 그 폴더의 판정 스펙), `apps/medusa/integration-tests/http/return-request.spec.ts`

**Interfaces:**
- Consumes: Task 2 없음(Medusa 는 계약을 import 하지 않는다).
- Produces: `ReturnRequestRecord.kind?: 'exchange'`, `RequestOrderReturnResult.kind: 'return' | 'exchange'`, `isExchangeRecord(record: ReturnRequestRecord): boolean`(load-return-order.ts).

- [ ] **Step 1: 실패하는 테스트**
  - 판정 단위: `교환 + change_of_mind → exchange_requires_seller_fault`, `교환 + other + operatorFeeBearer customer → 같은 거절`, `교환 + other + seller → 통과`, `교환 + defective → 통과`.
  - 통합(`return-request.spec.ts`): `kind exchange 로 접수 → 반품 metadata.almondReturn.kind = 'exchange', 응답 kind exchange`, `같은 requestId·같은 본문 재전송 → 같은 반품`, `같은 requestId 로 kind 만 바꿔 다시 → request_id_conflict`, `kind 없는 반품의 requestHash 가 이 PR 전과 같다`(고정 해시 값 하나를 단언 — 옛 반품의 재전송이 conflict 가 되면 안 된다), store 라우트 `kind: 'swap'` → 400.
- [ ] **Step 2: FAIL 확인** — `cd apps/medusa && npx jest src/workflows/orders/returns/__tests__ -t exchange` · `scripts/local/run-medusa-integration.sh --testPathPattern return-request`
- [ ] **Step 3: 구현** — 해시 본문은 `kind === 'exchange'` 일 때만 `kind` 키를 더한다.
- [ ] **Step 4: PASS 확인** — 위 두 명령 + `npx jest scripts/storefront/medusa-return-parity.spec.ts`
- [ ] **Step 5: Commit** — `feat(medusa): 반품 라우트로 교환 접수 — 판매자 잘못 사유만 (K8 PR11)`

### Task 4: Medusa 교환 정산 — 수령 뒤 대체 줄, 선환불 거절, 배송비 판정에서 빼기

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/exchange-replacements.ts`
- Modify: `apps/medusa/src/workflows/orders/returns/settle-order-return.ts`(N3 갈래)
- Modify: `apps/medusa/src/workflows/orders/returns/return-settlement-record.ts`(단계 `exchanged`, 칸 `exchangedAt?`·`exchangeItems?`, 읽기)
- Modify: `apps/medusa/src/workflows/orders/returns/prepay-order-return.ts`(N6)
- Modify: `apps/medusa/src/workflows/orders/settlement/load-order-view.ts`(`OrderLine.exchangeReplacement`), `apps/medusa/src/workflows/orders/partial-cancel/shipping-plan-lines.ts`(N8)
- Test: `apps/medusa/src/workflows/orders/returns/__tests__/exchange-replacements.unit.spec.ts`, `apps/medusa/integration-tests/http/return-settle.spec.ts`(교환 describe 추가), `apps/medusa/integration-tests/http/return-prepay.spec.ts`(한 테스트)

**Interfaces:**
- Consumes: Task 3 `isExchangeRecord`.
- Produces:
  - `planExchangeReplacements(lines: OrderView['lines'], items: Array<{ itemId: string; received: number; dismissed: number }>): Array<{ sourceItemId: string; title: string; variantId: string | null; quantity: number; unitPrice: number }>` — 순수 함수, 수량 0 품목은 뺀다.
  - `addExchangeReplacements(container, input: { orderId: string; requestId: string; replacements: ReturnType<typeof planExchangeReplacements>; actorId?: string }): Promise<Array<{ sourceItemId: string; itemId: string; quantity: number }>>` — 멱등(N5).
  - `ReturnSettlementStage = 'received' | 'charged' | 'refunded' | 'exchanged'`, 기록 `exchangedAt?: string`, `exchangeItems?: Array<{ sourceItemId; itemId; quantity }>`.
  - `SettleOrderReturnResult.stage: 'refunded' | 'exchanged'`, `exchangeItems?`.
  - `ReturnSettleRejectReason` 에 `exchange_settle_unsupported`, `ReturnPrepayRejectReason` 에 `exchange_unsupported`.

- [ ] **Step 1: 실패하는 단위 테스트(`planExchangeReplacements`)** — `할인 없는 30,000 × 1 → unitPrice 30000`, `30,000 × 3 에 할인 5,000, q=1 → unitPrice 28333.333333…(toBeCloseTo 6자리)`, `received 1 + dismissed 1 → quantity 2`, `received 0·dismissed 0 품목은 결과에 없다`, `주문 줄에 없는 품목 → throw`.
- [ ] **Step 2: 실패하는 통합 테스트(`return-settle.spec.ts` «교환»)**
  - `교환 정산(양품 1) → stage exchanged, refundAmount 0, wallet 환불 호출 0, 차액 0, NOT_PAID 0, 대체 줄 1개(metadata.almondExchange.sourceItemId = 원래 품목)`
  - `할인 주문 폐기 1 → 차액 |x| < 1, 환불 0`
  - `같은 requestId 재전송 → 대체 줄 그대로 1개, 같은 exchangeItems`
  - `대체 줄을 넣는 주문 수정 확정 전에 끊김(테스트 훅: 열린 수정을 남긴다) → 재시도가 열린 수정을 버리고 1개만 넣는다`
  - `교환 + holdDeduction 1000 → 400 exchange_settle_unsupported, 반품 status requested 그대로`(수령 전 거절)
  - `교환 정산 뒤 다른 품목 부분취소 → 배송비 판정이 대체 줄을 세지 않는다`(Task 1 넷째 단언을 여기로)
  - `return-prepay.spec.ts`: `교환 반품 선환불 → 400 return_prepay_rejected(reason exchange_unsupported), 환불 0`
- [ ] **Step 3: FAIL 확인** — `cd apps/medusa && npx jest src/workflows/orders/returns/__tests__/exchange-replacements` · `scripts/local/run-medusa-integration.sh --testPathPattern 'return-settle|return-prepay'`
- [ ] **Step 4: 구현** — `settleOrderReturn.run` 은 `received`(또는 `charged`) 뒤 `isExchangeRecord(request)` 면 환불 블록 대신 `addExchangeReplacements` → 기록 `exchanged`. `existing?.stage === 'exchanged'` 면 바로 결과. 대체 줄은 `orderEditAddNewItemWorkflow` 의 `items: [{ title, quantity, unit_price, metadata }]`(variant_id 없이), 태그는 `beginOrderEditOrderWorkflow` 의 `internal_note`. 확정 뒤 N5 검사.
- [ ] **Step 5: PASS 확인** — 위 명령 + `npx tsc --noEmit -p apps/medusa/tsconfig.json`(기존 3건만)
- [ ] **Step 6: Commit** — `feat(medusa): 교환 정산 — 수령 뒤 대체 품목 줄로 차액 0, 환불 없음 (K8 PR11)`

### Task 5: Medusa 교환 취소 막음 + 자격 파서

**Files:**
- Modify: `apps/medusa/src/workflows/orders/returns/core-return-eligibility.ts`(`customerReturns: Array<{ channelReturnId; status; kind: 'return' | 'exchange'; exchangeReleased: boolean }>`, 없는 칸 기본값 N17)
- Modify: `apps/medusa/src/workflows/orders/returns/cancel-order-return.ts`(N7 — 회수 놓아주기 «전»)
- Modify: `apps/medusa/integration-tests/http/fixtures/return-fixture.ts`(`FakeCore` 가 두 칸을 줄 수 있게)
- Test: `apps/medusa/integration-tests/http/return-cancel.spec.ts`, 자격 파서 단위 스펙(그 폴더 `__tests__`)

**Interfaces:**
- Consumes: Task 3 거절 코드 `exchange_released`.
- Produces: `CoreReturnEligibility.customerReturns[].kind`·`.exchangeReleased`.

- [ ] **Step 1: 실패하는 테스트** — 파서: `kind·exchangeReleased 없는 옛 응답 → return·false`, `exchangeReleased 'yes' → CoreEligibilityUnavailable`. 통합: `교환 반품 + core 가 exchangeReleased true → 400 exchange_released, FakeCore 의 release 호출 0, 반품 requested 그대로`, `false 면 지금처럼 취소`.
- [ ] **Step 2: FAIL 확인** — `scripts/local/run-medusa-integration.sh --testPathPattern return-cancel`
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS 확인**
- [ ] **Step 5: Commit** — `feat(medusa): 교환 상자가 열린 교환은 취소하지 않는다 (K8 PR11)`

### Task 6: channel-adapter — 스냅샷에서 대체 줄 빼기, 관측 두 칸

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-return-observations.ts`(`readRecord` 가 `kind` — `'exchange'` 면 싣고 모르는 값이면 `no_record`, `readSettlement` 이 `exchanged` 단계)
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-order.source.ts`(`buildSnapshot`/`buildLine` 앞에서 `metadata.almondExchange` 품목 거르기 — N9)
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts`(`MedusaOrder` 품목 `metadata` 타입이 없으면 더한다)
- Test: 두 파일 옆 스펙(`medusa-return-observations.spec.ts`·`medusa-order.source.spec.ts`)

**Interfaces:**
- Consumes: Task 2 `CustomerReturnKind`, `ChannelReturnSettledPayload.exchangeItems`. Task 4 기록 모양(`stage 'exchanged'`, `exchangedAt`, `exchangeItems`, `refundAmount 0`).
- Produces: 없음.

- [ ] **Step 1: 실패하는 테스트** — `kind exchange 기록 → ChannelReturnRequested.kind 'exchange'`, `kind 없는 기록 → payload 에 kind 칸 없음`, `kind 'swap' → skipped no_record`, `exchanged 기록 → ChannelReturnSettled { refundAmount 0, refundMode 'auto', settledAt = exchangedAt, exchangeItems }`, `exchangeItems 가 빈 exchanged 기록 → no_settlement_record`, `metadata.almondExchange 품목이 있는 주문의 스냅샷 줄에 그 품목이 없다 — 해시 입력도 같다(대체 줄 추가 전후 스냅샷 해시 동일)`.
- [ ] **Step 2: FAIL 확인** — `npx jest apps/channel-adapter/src/services/order-collection -t "exchange|교환"`
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS 확인**
- [ ] **Step 5: Commit** — `feat(channel-adapter): 교환 관측 — kind·대체 줄, 스냅샷에서 대체 줄을 뺀다 (K8 PR11)`

### Task 7: core 스키마·마이그

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`(N11 — `customerReturnKindEnum`, `customerReturns.kind`·`exchangeReleasedAt`·`exchangeReleasedBy`, `salesOrderLines.exchangeReturnLineId` + 부분 unique `uq_sales_order_lines_exchange_return_line`)
- Create: `apps/core/drizzle/<timestamp>_add-customer-exchange.sql` + `drizzle/meta/*`(생성)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.types.ts`(`CustomerReturn` 에 칸, view 에 `kind`·`exchangeReleasedAt`)

**Interfaces:**
- Produces: `wmsTables.customerReturns.kind: 'return' | 'exchange'`, `.exchangeReleasedAt: Date | null`, `.exchangeReleasedBy: string | null`, `wmsTables.salesOrderLines.exchangeReturnLineId: string | null`, `CustomerReturnView.kind`·`.exchangeReleasedAt: string | null`.

- [ ] **Step 1: 스키마 편집 → `npm run db:generate:core -- --name add-customer-exchange`**
- [ ] **Step 2: 생성 SQL 검토** — `CREATE TYPE` → `ALTER TABLE customer_returns ADD COLUMN kind … DEFAULT 'return' NOT NULL` 등 ADD 만, DROP 0. FK `ON DELETE restrict`.
- [ ] **Step 3: scratch DB 에 적용** — `DATABASE_URL=<scratch> npx drizzle-kit migrate --config apps/core/drizzle.config.ts` → 성공, 그다음 빈 DB 부트스트랩도 한 번.
- [ ] **Step 4: 게이트** — `npm run type-check` 0, `npx jest apps/core/src/modules/sales-order/customer-return/customer-return.types.spec.ts` PASS
- [ ] **Step 5: Commit** — `feat(core): 교환 칸 — customer_returns.kind·교환 상자 열림, 판매주문 교환 줄 (K8 PR11)` (schema + drizzle 한 커밋)

### Task 8: core 교환 접수·취소 사실 — 교환 줄

**Files:**
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.manager.ts`(`recordRequested`·`recordCancelled`)
- Modify: `apps/core/src/modules/product-matching/line-composition/line-composition.manager.ts`(`copyFrozen`)
- Modify: `apps/core/src/modules/sales-order/internal/return-eligibility.reader.ts`·`return-eligibility.ts`(N17)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-receiving.manager.ts`(도착 이벤트 `kind`, N19)
- Modify: `apps/core/src/modules/sales-order/line-quantities/claim-quantities.sql.ts:7`·`claim-statuses.ts:5` 주석(교환도 `customer_returns` 행이라 이미 센다)
- Test: `customer-return.manager.integration.spec.ts`, `line-composition.manager` 통합 스펙(있으면 그 파일, 없으면 `line-composition.manager.integration.spec.ts`), `return-eligibility` 스펙

**Interfaces:**
- Consumes: Task 2 `kind`, Task 7 칸.
- Produces: `LineCompositionManager.copyFrozen(input: { sourceLineId: string; targetLineId: string }, tx?: DbTx): Promise<void>` — 원본 출처·행을 복사, 원본이 안 굳었으면 `Error`. `CustomerReturnManager.recordRequested` 는 교환이면 교환 줄 id 들도 만든다(반환 모양은 그대로).

- [ ] **Step 1: 실패하는 테스트**
  - `교환 접수 사실 → customer_returns.kind exchange, 같은 판매주문에 교환 줄 1개(수량 = 반품 줄 수량, unit/total 0, channel_order_item_id null, exchange_return_line_id = 반품 줄), 구성 = 원래 줄 구성, claim progress kind exchange`
  - `원래 줄이 세트(구성 2 SKU) → 교환 줄 구성 2행, qty_per_unit 같음`
  - `kind 없는 사실 → 지금과 같다(교환 줄 0)`
  - `같은 사실 재전달 → 교환 줄 그대로 1개`
  - `교환 취소 사실(열기 전) → cancelled, 교환 줄 0, 구성 0`
  - `교환 취소 사실(exchange_released_at 있음) → ConflictError, 줄 그대로`
  - 자격: `교환 반품 → customerReturns[].kind exchange, exchangeReleased false`, 열린 뒤 `true`
  - 도착: `교환 반품 도착 → claim progress collected kind exchange`
  - K6: `교환 접수 뒤 원래 줄 claimable 이 반품과 같이 준다`(이미 성립 — 회귀 고정)
- [ ] **Step 2: FAIL 확인** — `npm run test:core:integration:local -- 'apps/core/src/modules/(sales-order/(customer-return|internal)|product-matching/line-composition)/.*integration'` (스펙은 `describeIfDb` — 러너가 `DATABASE_URL` 을 넘긴다. 사용자 dev DB 를 건드리지 않으려면 `LOCAL_PG` 로 별도 postgres 를 가리킨다)
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS 확인** — 같은 명령, 그다음 `customer-return` 폴더 전체 `--runInBand`(반품 회귀)
- [ ] **Step 5: Commit** — `feat(core): 교환 접수가 같은 판매주문에 교환 줄을 만들고, 취소가 지운다 (K8 PR11)`

### Task 9: core 교환 상자 열기 + 정산 사실 + 판정·취소에서 교환 줄 빼기

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/customer-exchange.releaser.ts`
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-receiving.manager.ts`(`recordInspection` 보류 없는 갈래에서 release)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-cs.manager.ts`(새 `releaseExchange`, N15 거절 셋)
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return.service.ts`·`customer-returns.controller.ts`(N14 라우트)·DTO
- Modify: `apps/core/src/modules/sales-order/customer-return/customer-return-settlement.manager.ts`(`recordSettled` 교환 갈래, N16)
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.reader.ts`(`lockEffectiveOrder` 가 교환 줄을 뺀다, N18)
- Modify: `planCancellation`(판매주문 서비스 — `grep -rn "planCancellation(" apps/core/src --include=*.ts` 의 정의) 과 줄 지목 취소 검증
- Modify: `scripts/security/idor-reviewed.spec.ts` 줄 좌표(필요하면), customer-return 모듈 providers
- Test: `customer-exchange.releaser.integration.spec.ts`(새), `customer-return-receiving.manager.integration.spec.ts`, `customer-return-cs.manager.integration.spec.ts`, `customer-return-settlement.manager.integration.spec.ts`, `channel-order-change` 통합 스펙, 취소 계획 스펙

**Interfaces:**
- Consumes: Task 7 칸, Task 8 교환 줄, 커널 `openShipment`·`compatibleShippingProfileId`·`acquireStockAvailabilityLocks`·`ShipmentReservationService.reservePartial/recompute`·`reprojectFulfillmentOrders`(이름·import 는 `fulfillments.service.ts` 의 `createV2` 가 쓰는 그대로), `readPickupSource`(`customer-return-pickup-source.reader.ts`).
- Produces: `CustomerExchangeReleaser.release(trx: DbTx, input: { customerReturnId: string; actorId: string | null }): Promise<boolean>`, `CustomerReturnCsManager.releaseExchange(input: { customerReturnId: string; actorId: string }, tx?: DbTx): Promise<CustomerReturnView>`, 라우트 `POST admin/customer-returns/:id/exchange-release`(본문 없음, 200 view).

- [ ] **Step 1: 실패하는 테스트**
  - releaser: `교환 줄 1(단일 SKU) → 기존 FO 에 FOI 1(qty = 수량 × qpu, pending), draft 상자 1(창고 = FO 창고, 받는 사람 = 회수지), 예약 = 수량, exchange_released_at/by 기록`, `세트 줄 → FOI 2·상자 줄 2`, `재고 0 → 상자 draft·예약 0, 예외 없음`, `두 번 부르면 false·FOI 그대로`, `kind return 이면 false·아무것도 안 함`
  - 검수: `교환 + 보류 없음 → inspected + 정산 명령 1 + 교환 상자 1(같은 트랜잭션)`, `재고 부족이어도 검수 커밋`, `교환 + 보류 → held, 상자 0`, `반품(kind return) 검수 → 상자 0`(회귀)
  - CS 문: `held 교환 → inspected + 정산 명령(command {}) + 상자`, `expected 교환(선발송) → 상태 그대로 + 상자`, `이미 열림 → 같은 view`, `settled 교환 → 409`, `반품(kind return) → 400`, `교환에 settleHeld·requestPrepay·closeMissing → 400`
  - 정산 사실: `교환 settled + exchangeItems → settled, 교환 줄 channel_order_item_id = itemId, claim completed 0, SalesOrderReturned 0`, `반품 settled → 지금 그대로(completed 1·SalesOrderReturned 1)`
  - 판정: `교환 줄이 있는 판매주문 + 대체 줄 없는 스냅샷 → 델타 0`, `교환 줄의 id 가 이어진 뒤 스냅샷에 그 품목이 있어도 → 델타 0`
  - 취소: `전체 취소 계획에 교환 줄 없음`, `교환 줄 지목 취소 → BadRequestError`
  - 끝까지(Review Focus 5): `교환 상자 출고·배송완료 → 판매주문 delivered, 자격 API 의 교환 줄 deliveredUnits = 수량`
- [ ] **Step 2: FAIL 확인** — Task 8 과 같은 러너(`npm run test:core:integration:local -- <위 스펙 경로 패턴>`)
- [ ] **Step 3: 구현** — release 는 검수 트랜잭션 안에서 정산 명령 enqueue «뒤»에 부른다. 예약 부족은 결과로만 남고 던지지 않는다(`reservePartial` 이 이미 그렇다). 라우트는 `:id/missing-closure` 와 같은 데코레이터 묶음 + `@RequirePermission('order.claim.write')`.
- [ ] **Step 4: PASS 확인** — 같은 명령, 그다음 `customer-return`·`channel-order-change`·`order-cancellation`·`fulfillment` 폴더 통합 전체 `--runInBand`, `npx jest scripts/security`, `npx jest apps/core/src/modules/fulfillment/shipment/shipment-writes.guard.spec.ts apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-status-writes.guard.spec.ts libs/authorization`
- [ ] **Step 5: Commit** — `feat(core): 검수·CS 문이 교환 상자를 열고, 정산 사실이 교환 줄에 Medusa 품목을 잇는다 (K8 PR11)`

### Task 10: 게이트·문서

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` §4.9 끝에 «PR 11 에서 확정한 결과»(계획과 달라진 판정만, 판정 번호로)
- Delete: 이 계획이 남긴 임시 파일 없음 확인(`git status`)

- [ ] **Step 1: 전체 게이트** — `npm run type-check` 0, `npx jest` 실패 = 기준선(근태 4건)뿐, `(cd apps/medusa && npm run test:unit)`, `scripts/local/run-medusa-integration.sh`(전체 HTTP), `npx tsc --noEmit -p apps/medusa/tsconfig.json` 기존 3건, core 통합 `customer-return`·`fulfillment`·`channel-order-change`·`order-cancellation` `--runInBand`(기준선 실패만).
- [ ] **Step 2: 설계 «확정한 결과» 쓰기**
- [ ] **Step 3: Commit** — `docs: K8 PR11 확정한 결과`

## 배포 (PR 본문에 옮길 것)

- core 마이그 하나(expand) → **`migrate → deploy`**. core·channel-adapter·Medusa 한 배치(`npm run deploy:preflight -- --stage live`).
- 배포 전 점검: `select count(*) from customer_returns` 와 Medusa `select count(*) from "return"` — 0 이 아니면 그 반품들은 `kind return` 으로 읽히고 동작이 안 바뀐다(확인만).
- 배포 중 CS 교환 접수 금지(롤링 중 옛 core 가 `kind` 를 버리면 교환이 반품으로 기록된다 — 고객 자격은 개통 전 0).
- 배포 뒤 확인: ① `select count(*) from sales_order_lines where exchange_return_line_id is not null` 0 ② `POST /admin/customer-returns/<없는 id>/exchange-release` 키 없이 401 ③ 아무 라이브 주문 다음 폴링 뒤 core 반영 대기 변경 증가 0.
- 화면은 PR 11b — 그 전엔 교환을 CS 가 Medusa admin 라우트(`kind: 'exchange'`)로만 접수할 수 있고, 보류·선발송 버튼이 없다(라우트는 있다).
- 🔴 **교환 반품이 열려 있는 동안 Medusa 를 PR 11 이전으로 롤백하지 않는다** — 옛 정산이 교환을 반품으로 읽어 품목 값을 환불한다.
- 인쇄(디자인) 상품 교환은 이 PR 범위 밖 — 교환 줄이 `almond_design_id` 를 복사하지 않는다. PR 11b 자격에서 막고, 그 전엔 CS 가 인쇄 상품 교환을 받지 않는다.
