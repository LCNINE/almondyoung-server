# K8 PR 1 — 정산 도구 꺼내기 · 부분취소 택배비는 사유가 정한다 · 반품 배송 방법은 배송비 계산에서 뺀다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medusa 부분취소가 판매자 사유(품절 등)일 때 무료배송 깨짐 배송비를 고객에게 매기지 않게 하고, 반품이 붙은 주문의 부분취소 배송비 계산이 깨지지 않게 하며, 반품 정산(PR 6)이 같이 쓸 환불·주문 읽기 도구를 `settlement/` 로 꺼낸다.

**Architecture:** 세 갈래다. ① `partial-cancel-order.ts` 의 private `refund()`·`loadOrder()`(+ `OrderView`·`toShippingMethodView`)를 `workflows/orders/settlement/` 의 두 파일로 옮긴다 — 동작 그대로, 환불 종류(`kind`)와 메모(`note`)만 인자로. ② 부담 주체 순수 함수 `cancelShippingFeeBearer` 가 `reasonCode`·`requestedBy` 로 `customer | seller` 를 정하고, `seller` 면 `planShipping` 에 `chargeCap: 0` 을 넘긴다(줄어드는 쪽 배송비 환불은 그대로). channel-adapter 는 이미 core 명령에 실려 오는 `reasonCode`·`requestedBy` 를 Medusa 라우트 본문으로 넘긴다. ③ `planShipping` 의 «원래 배송 방법»에서 반품·교환·클레임에 속한 배송 방법을 뺀다.

**Tech Stack:** Medusa 2.13.4 워크플로(`apps/medusa`), NestJS(`apps/channel-adapter`), Jest(unit + `@medusajs/test-utils` HTTP 통합).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.4 «함정», §4.5, §8 PR 1. 결정 D4.

## 코드에서 확인한 것 (develop `c90d589bd` + 설계 커밋 `479c9bb51`)

- 부분취소는 channel-adapter 만 부른다: `channel-order-cancel.manager.ts:95` → `medusa.client.ts:2658 partialCancelOrder` → `POST /admin/orders/:id/partial-cancel`(`route.ts`) → `partialCancelOrder`(`partial-cancel-order.ts:118`).
- **core 는 사유를 이미 싣는다.** `CancelChannelOrderPayload.reasonCode?`·`requestedBy`(`channel-orders-command.stream.ts`), 채움은 `channel-cancel-request.manager.ts:192-193`. channel-adapter 가 Medusa 로 넘기지 않을 뿐이다(`settlePartial`, :95-100). **이벤트 계약 변경 없음.**
- 넘어오는 사유 값: 관리자 취소 화면 `CUSTOMER_REQUEST`·`OUT_OF_STOCK`·`ADMIN_REQUEST`·`CHANNEL_CANCEL`·`PAYMENT_FAILED`·`OTHER`(`cancel-order-modal.tsx:20-27`), 고객 자기 취소 `CHANGE_OF_MIND`·`WRONG_ORDER`·`FOUND_CHEAPER`·`DELAY`·`OTHER`(`cancel-reason-form.tsx:8-20`, `store-sales-orders.service.ts:695` 가 그대로 넘김). `requestedBy` 는 `operator | customer | wallet-refund-approval`.
- `planShipping` 은 사유를 모른다(`plan-shipping.ts:42`). `chargeCap` 이 청구 상한이고(`:85`), 올라가는 그룹은 `recordedFee = currentFee + share` 로 기록된다(`:89-94`) — `chargeCap: 0` 이면 청구 0·기록 요금 그대로·줄어드는 쪽 `refund` 그대로다.
- `toShippingMethodView`(`partial-cancel-order.ts:426`)는 배송 방법이 반품 것인지 보지 않는다. 반품 배송 방법은 `policySnapshot` 이 없어 `planShipping` 이 `NO_SNAPSHOT` 으로 조정을 통째로 멈춘다(`plan-shipping.ts:52-55`). order 모듈의 `order_shipping` 행에는 `return_id`·`exchange_id`·`claim_id` 가 있다(`@medusajs/order/dist/models/order-shipping.js` 인덱스) — `listOrders` 의 `shipping_methods` 에 반품 방법이 섞여 나오는지, 어느 칸으로 가를 수 있는지는 **Task 3 의 특성 테스트로 먼저 확인**한다.
- 라이브: Medusa 부분취소 실행 1건(10-19, 자동, 배송비 청구 0). 스냅샷이 있는 배송 방법은 10-07 이후 주문뿐(907/5,736).

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. 부담 주체 표.** `customer` = (`requestedBy = customer` 이고 사유가 `DELAY` 가 아님) 또는 (`requestedBy = operator` 이고 사유가 `CUSTOMER_REQUEST`). 그 밖 전부 `seller` — `OUT_OF_STOCK`·`ADMIN_REQUEST`·`CHANNEL_CANCEL`·`PAYMENT_FAILED`·운영자 `OTHER`·`wallet-refund-approval`·사유 없음·`requestedBy` 없음. 고객의 `DELAY`(배송 지연)는 우리 잘못이라 `seller`. 스펙 §4.5 의 «고객 자기 취소 → customer» 를 `DELAY` 만큼 좁힌다.
- **N2. 판매자 사유 부분취소는 «기록 요금»을 올리지 않는다** (`chargeCap: 0` 의 자연스러운 결과). 그래서 판매자 사유로 기준이 깨진 주문에서 **나중에 고객이 또 부분취소하면 그때 면제 배송비를 뺀다**. 따로 «면제한 몫» 장부를 두지 않는 이유: 그룹이 비면 `planShipping` 이 «기록 요금 − 새 요금»을 돌려주므로, 청구하지 않은 금액을 기록에 올리면 그 금액을 환불하게 된다. 라이브 실행이 1건이라 드문 경우를 단순하게 둔다.
- **N3. 요청 해시는 그대로다** — `hashRequest(items, alreadyRefunded)` 에 사유를 넣지 않는다. 같은 `requestId` 재전송이 옛 channel-adapter(사유 없음)와 새 channel-adapter 사이에서 갈려 거절되지 않게. 사유는 기록(`PartialCancelRecord.shippingFeeBearer`)에 남긴다.
- **N4. Medusa 가 표를 소유한다.** channel-adapter 는 사유를 «번역하지 않고» 넘긴다 — 돈 규칙은 커머스 엔진 쪽(D1). 받는 칸은 본문의 `reasonCode`·`requestedBy`(둘 다 선택).

## Global Constraints

- 이벤트 계약(`packages/event-contracts`) 변경 없음. core 변경 없음.
- `partialCancelOrder` 의 응답 계약(200·400 `partial_cancel_rejected`·400 `wallet_refund_refused:*`·502 `refund_pending`)은 그대로.
- 환불 종류: 부분취소는 `'ITEM_CANCEL'` 그대로(`almond-payment/refund-data.ts` 의 kind). 메모는 `partial-cancel:${requestId}` 그대로 — 이미 낸 환불을 이 메모로 찾는다(`refund()` :334). 바꾸면 재시도가 두 번 환불한다.
- Medusa 확장 규칙(CLAUDE.md «Medusa»): 코어 라우트 override 금지, 워크플로 훅 중복 등록 금지.
- Medusa 통합 테스트는 `scripts/local/run-medusa-integration.sh` 로만 돌린다(`npm run test:integration:*` 직접 금지 — `DB_*` 파생). postgres·redis 둘 다 떠 있어야 한다.
- 검증 게이트: `npm run type-check` 0, `npx jest` 0(루트). medusa 는 루트 게이트에서 빠지므로 `(cd apps/medusa && npm run test:unit)` 과 통합 래퍼를 따로 돈다.

## Review Focus

- **옛 기록이 있는 주문의 재시도** — `edited` 단계로 멈춘 옛 요청(사유 칸 없는 기록)을 같은 `requestId` 로 다시 부르면 환불부터 이어 가고, 사유가 같이 와도 해시 불일치로 거절하지 않는다. Task 2 테스트.
- **같은 주문에 판매자 사유 → 고객 사유 순서의 두 부분취소** — 첫 번째는 배송비 청구 0, 두 번째가 그때 면제 배송비를 뺀다(N2). Task 2 테스트.
- **판매자 사유인데 그룹이 통째로 빈다** — 청구는 0 이어도 그 그룹 배송비 환불은 나간다. Task 2 테스트.
- **반품 배송 방법이 붙은 주문의 부분취소** — `NO_SNAPSHOT` 이 아니라 배송비를 다시 계산한다. Task 3 테스트.
- **교환·클레임의 내보내는 배송 방법** — Task 3 의 거르기가 반품뿐 아니라 교환·클레임 배송 방법도 뺀다(같은 칸 규칙). Task 3 단위 테스트.

---

### Task 1: 환불·주문 읽기 도구를 `settlement/` 로 옮긴다 (동작 그대로)

**Files:**
- Create: `apps/medusa/src/workflows/orders/settlement/refund-order-payments.ts`
- Create: `apps/medusa/src/workflows/orders/settlement/load-order-view.ts`
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts` (`refund` :318-355, `OrderView`·`loadOrder` :359-423, `toShippingMethodView`·`readSnapshot`·`SummaryRow` :425-451 를 옮기고 import)
- Modify: `apps/medusa/integration-tests/http/partial-cancel.spec.ts` — import 경로만(`toShippingMethodView` 를 쓰면)

**Interfaces:**
- Produces:
  - `refundOrderPayments(container: MedusaContainer, input: { orderId: string; amount: number; note: string; mode: RefundMode; kind: WalletRefundKind; actorId?: string }): Promise<void>` — 지금 `refund()` 본문 그대로. `kind` 타입은 `issuePaymentRefund` 가 받는 타입을 그대로 import.
  - `loadOrderView(container: MedusaContainer, orderId: string): Promise<OrderView | null>` — 못 찾으면 `null`(지금은 `PartialCancelRejected` 를 던진다 — 던지기는 호출자 몫으로).
  - `type OrderView`(지금 모양 그대로), `toShippingMethodView(m)`(지금 시그니처 그대로, `export`).
- Consumes: `issuePaymentRefund`, `orderPaymentIds`, `paymentRefundLockKey`, `toNumber`.

- [ ] **Step 1: 기준선 — 부분취소 통합 스펙 두 개를 지금 상태로 돌려 초록인지 본다**

Run: `scripts/local/run-medusa-integration.sh -- integration-tests/http/partial-cancel.spec.ts integration-tests/http/partial-cancel-settlement.spec.ts`
Expected: 전부 PASS. 실패가 있으면 목록을 scratchpad 에 남기고 그 목록과만 비교한다.

- [ ] **Step 2: 두 파일로 옮긴다** — `partial-cancel-order.ts` 는 `loadOrderView` 가 `null` 이면 `PartialCancelRejected(\`주문을 찾을 수 없습니다: ${orderId}\`)` 를 던지는 얇은 `loadOrder` 를 남기고, `refund(...)` 호출을 `refundOrderPayments(container, { orderId, amount, note: refundNote(requestId), mode, kind: 'ITEM_CANCEL', actorId })` 로 바꾼다. 상수 `PAYMENT_LOCK_TIMEOUT_SECONDS` 는 `refund-order-payments.ts` 로 간다.

- [ ] **Step 3: 같은 통합 스펙과 단위 테스트를 다시 돌린다**

Run: `scripts/local/run-medusa-integration.sh -- integration-tests/http/partial-cancel.spec.ts integration-tests/http/partial-cancel-settlement.spec.ts && (cd apps/medusa && npm run test:unit)`
Expected: Step 1 과 같은 결과.

- [ ] **Step 4: Commit**

```bash
git add apps/medusa/src/workflows/orders/settlement apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts apps/medusa/integration-tests/http/partial-cancel.spec.ts
git commit -m "K8 PR1 — 부분취소의 환불·주문 읽기를 settlement 로 꺼낸다(동작 그대로, 반품 정산이 같이 쓴다)"
```

### Task 2: 부분취소 택배비는 사유가 정한다

**Files:**
- Create: `apps/medusa/src/workflows/orders/partial-cancel/shipping-fee-bearer.ts`
- Test: `apps/medusa/src/workflows/orders/partial-cancel/__tests__/shipping-fee-bearer.unit.spec.ts`
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts` (`PartialCancelInput`, `PartialCancelRecord`, `edit()` 의 `planShipping` 호출 :174-186)
- Modify: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/parse-input.ts`, `route.ts`
- Test: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/__tests__/parse-input.unit.spec.ts`
- Test: `apps/medusa/integration-tests/http/partial-cancel.spec.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (`partialCancelOrder` :2658-2675), `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts` (`settlePartial` :95-100)
- Test: `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts`, `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`

**Interfaces:**
- Produces:
  - `type ShippingFeeBearer = 'customer' | 'seller'`
  - `cancelShippingFeeBearer(input: { reasonCode?: string; requestedBy?: string }): ShippingFeeBearer` — N1 표.
  - `PartialCancelInput` 에 `reasonCode?: string; requestedBy?: string`. `PartialCancelRecord` 에 `shippingFeeBearer?: ShippingFeeBearer`(옛 기록엔 없음).
  - 본문 칸 `reasonCode?: string`, `requestedBy?: string` (snake 아님 — `requestId`·`refundMode` 와 같은 표기).
  - `MedusaClient.partialCancelOrder` 입력에 `reasonCode?: string; requestedBy?: string`.

- [ ] **Step 1: 실패하는 단위 테스트**

```ts
describe('cancelShippingFeeBearer', () => {
  it.each([
    [{ requestedBy: 'customer', reasonCode: 'CHANGE_OF_MIND' }, 'customer'],
    [{ requestedBy: 'customer', reasonCode: 'WRONG_ORDER' }, 'customer'],
    [{ requestedBy: 'customer', reasonCode: 'FOUND_CHEAPER' }, 'customer'],
    [{ requestedBy: 'customer', reasonCode: 'OTHER' }, 'customer'],
    [{ requestedBy: 'customer' }, 'customer'],
    [{ requestedBy: 'customer', reasonCode: 'DELAY' }, 'seller'],
    [{ requestedBy: 'operator', reasonCode: 'CUSTOMER_REQUEST' }, 'customer'],
    [{ requestedBy: 'operator', reasonCode: 'OUT_OF_STOCK' }, 'seller'],
    [{ requestedBy: 'operator', reasonCode: 'ADMIN_REQUEST' }, 'seller'],
    [{ requestedBy: 'operator', reasonCode: 'OTHER' }, 'seller'],
    [{ requestedBy: 'operator' }, 'seller'],
    [{ requestedBy: 'wallet-refund-approval', reasonCode: 'CUSTOMER_REFUND_REQUEST' }, 'seller'],
    [{}, 'seller'],
  ])('%j → %s', (input, expected) => expect(cancelShippingFeeBearer(input)).toBe(expected));
});
```

parse-input 단위 테스트에 더한다: `reasonCode: 'OUT_OF_STOCK', requestedBy: 'operator'` 가 그대로 나오고, 둘 다 없으면 키가 없으며, 문자열이 아니면 `INVALID_DATA`.

- [ ] **Step 2: 돌려서 실패를 본다**

Run: `(cd apps/medusa && npx jest src/workflows/orders/partial-cancel/__tests__/shipping-fee-bearer.unit.spec.ts 'src/api/admin/orders/\[id\]/partial-cancel/__tests__/parse-input.unit.spec.ts')`
Expected: FAIL — 모듈 없음 / 새 키 없음.

- [ ] **Step 3: 구현** — `shipping-fee-bearer.ts`, `parseInput` 의 두 칸, `route.ts` 가 넘기기, `edit()` 가 `const bearer = cancelShippingFeeBearer(input)` 로 `chargeCap: bearer === 'seller' ? 0 : plan.itemRefundEstimate` 를 넘기고 기록에 `shippingFeeBearer: bearer` 를 남긴다. `hashRequest` 는 건드리지 않는다(N3).

- [ ] **Step 4: 단위 테스트 통과 확인** — Step 2 명령, Expected: PASS.

- [ ] **Step 5: 통합 테스트를 더한다** (`partial-cancel.spec.ts`, 픽스처 상품 A·B 30,000 조건부 무료 50,000/3,000 그대로)

  - `'판매자 사유(OUT_OF_STOCK) 부분취소는 무료배송이 깨져도 배송비를 빼지 않는다'` — A+B(PC6000) 주문에서 B 를 `reasonCode: 'OUT_OF_STOCK', requestedBy: 'operator'` 로 취소 → `refundAmount` 27000(30,000 − 3,000 할인분), `shippingDelta` 0, `'부분취소 배송비'` 방법 없음, 장부 0, 기록 `shippingFeeBearer` `'seller'`.
  - `'고객 사유(CUSTOMER_REQUEST)는 지금처럼 뺀다'` — 같은 주문 모양, `refundAmount` 24000, `shippingDelta` 3000.
  - `'판매자 사유 뒤 고객 사유 부분취소가 그때 면제 배송비를 뺀다'` — A×1 + B×1 + C×1(PC 없이; A·B 조건부 그룹 60,000 → 무료, C 고정 3,000): B 를 `OUT_OF_STOCK` 으로 취소(A 30,000 만 남아 기준 미달인데 청구 0, 기록 `shippingCharge` 0) 뒤 C 를 `CUSTOMER_REQUEST` 로 취소 → 두 번째 기록 `shippingCharge` 3000(조건부 그룹이 이제 매겨짐)·`shippingRefund` 3000(C 그룹이 비어 돌려줌)·`shippingDelta` 0, 환불액 10,000.
  - `'판매자 사유인데 그룹이 통째로 비면 그 그룹 배송비는 돌려준다'` — 기존 «그룹이 통째로 비면…» 케이스를 `OUT_OF_STOCK` 으로 한 번 더, 같은 환불액.
  - `'사유 없이 온 요청은 판매자 사유로 본다'` — `reasonCode`·`requestedBy` 없이 A+B 의 B 취소 → `shippingDelta` 0.
  - `'옛 기록(사유 칸 없음)으로 멈춘 요청을 사유와 함께 다시 부르면 환불부터 이어 간다'` — 기존 «환불이 한 번 실패하면 refund_pending…» 케이스처럼 첫 호출은 사유 없이 실패시키고, 재호출에 `reasonCode` 를 실어도 `PartialCancelRejected` 가 아니라 같은 `refundAmount` 로 끝난다.

- [ ] **Step 6: 통합 테스트를 돌린다**

Run: `scripts/local/run-medusa-integration.sh -- integration-tests/http/partial-cancel.spec.ts`
Expected: 새 케이스 포함 PASS. 기존 케이스 중 사유를 안 싣는 것들(«줄 제거 + 조건부 무료 미달» 등)은 이제 `seller` 라 배송비를 안 뺀다 — **그 케이스들에 `reasonCode: 'CUSTOMER_REQUEST', requestedBy: 'operator'` 를 실어 원래 기대값을 지킨다**(기대값을 바꾸지 말 것).

- [ ] **Step 7: channel-adapter 가 사유를 넘긴다** — `settlePartial` 이 `command.reasonCode`·`command.requestedBy` 를 `partialCancelOrder` 로, `partialCancelOrder` 가 본문 `reasonCode`·`requestedBy` 로(값이 있을 때만 키). 테스트: `medusa.client.spec.ts` 에 본문에 두 칸이 실리는 케이스와 없을 때 키가 없는 케이스, `channel-order-cancel.manager.spec.ts` 에 명령의 두 값이 클라이언트 입력으로 가는 케이스.

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/medusa apps/channel-adapter
git commit -m "K8 PR1 — 부분취소 배송비는 사유가 정한다: 판매자 사유(품절 등)·사유 없음은 무료배송 깨짐을 매기지 않는다, channel-adapter 가 사유를 넘긴다"
```

### Task 3: 반품·교환·클레임 배송 방법은 배송비 계산에서 뺀다

**Files:**
- Modify: `apps/medusa/src/workflows/orders/settlement/load-order-view.ts` (Task 1 이 만든 `loadOrderView`·`toShippingMethodView`)
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/plan-shipping.ts` (`ShippingMethodView`, `originals` :48)
- Test: `apps/medusa/src/workflows/orders/partial-cancel/__tests__/plan-shipping.unit.spec.ts`
- Test: `apps/medusa/integration-tests/http/partial-cancel.spec.ts`
- Modify: `apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts` (반품 옵션 하나)

**Interfaces:**
- Consumes: Task 1 의 `loadOrderView`, `toShippingMethodView`.
- Produces: `ShippingMethodView.isReturnExchangeOrClaimShipping: boolean` — 반품·교환·클레임에 속한 배송 방법이면 `true`. `planShipping` 의 «원래 방법»은 `!isPartialCancelCharge && !isReturnExchangeOrClaimShipping`.

- [ ] **Step 1: 특성 테스트 — 반품 배송 방법이 주문에서 어떻게 보이는지 적는다** (`partial-cancel.spec.ts`)

픽스처에 `manual_manual` provider 의 반품 옵션(`is_return: true`, 고정 0원)을 하나 만든다. A+B(PC6000) 주문에 `beginReturnOrderWorkflow` → `requestItemReturnWorkflow`(B 1개) → `createReturnShippingMethodWorkflow`(`custom_amount: 2500`) → `confirmReturnRequestWorkflow` 를 돌린 뒤 `loadOrderView` 와 `listOrders(..., relations: ['shipping_methods'])` 를 읽어 **반품 배송 방법이 목록에 있는지와 반품을 가리키는 칸(`return_id` 등)의 이름·값**을 `expect` 로 적는다.

Run: `scripts/local/run-medusa-integration.sh -- integration-tests/http/partial-cancel.spec.ts -t '특성(K8)'`
Expected: 적은 그대로 PASS. 목록에 반품 방법이 **없으면** 이 Task 의 나머지는 할 일이 없다 — 특성 테스트만 남기고 Step 6 으로 간다(커밋 메시지에 그 사실을 적는다).

- [ ] **Step 2: 실패하는 테스트** — `plan-shipping.unit.spec.ts`: 원래 방법 하나(스냅샷 있음) + `isReturnExchangeOrClaimShipping: true` 이고 스냅샷 없는 방법 하나 → `adjustable: true` 이고 결과가 원래 방법 하나만 있을 때와 같다. 통합: `'반품 배송 방법이 붙은 주문의 부분취소는 배송비를 다시 계산한다'` — Step 1 의 주문에서 A 를 `CUSTOMER_REQUEST` 로 취소 → `shippingNotAdjusted` false.

- [ ] **Step 3: 돌려서 실패를 본다** — Expected: 단위는 `NO_SNAPSHOT`, 통합은 `shippingNotAdjusted: true`.

- [ ] **Step 4: 구현** — `loadOrderView` 가 Step 1 에서 확인한 칸을 읽어 `toShippingMethodView` 에 넘기고, `toShippingMethodView` 가 `isReturnExchangeOrClaimShipping` 를 채운다(반품·교환·클레임 셋 다), `planShipping` 이 거른다.

- [ ] **Step 5: 단위·통합 통과 확인**

Run: `(cd apps/medusa && npx jest src/workflows/orders/partial-cancel/__tests__/plan-shipping.unit.spec.ts) && scripts/local/run-medusa-integration.sh -- integration-tests/http/partial-cancel.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/medusa
git commit -m "K8 PR1 — 반품·교환·클레임 배송 방법은 부분취소 배송비 계산의 «원래 방법»에서 뺀다(스냅샷이 없어 조정이 통째로 멈췄다)"
```

### Task 4: 게이트

- [ ] **Step 1:** `npm run type-check` → 에러 0.
- [ ] **Step 2:** `npx jest` (루트) → 실패 0.
- [ ] **Step 3:** `(cd apps/medusa && npm run test:unit)` → 실패 0. `scripts/local/run-medusa-integration.sh` (전체 HTTP) → Task 1 Step 1 기준선 외 실패 0.

---

## 배포

- **Medusa 와 channel-adapter 를 같은 배치에.** 순서 제약은 없다(Medusa 는 모르는 본문 칸을 무시하고, channel-adapter 의 새 칸은 선택이다). 다만 **Medusa 만 먼저 나가면 그 사이 모든 부분취소가 «사유 없음 = 판매자»로 배송비를 안 뺀다** — 고객에게 불리한 쪽은 아니다.
- 마이그 없음. 동작 변경: 품절·관리자 사유 부분취소에서 무료배송 깨짐 배송비를 빼지 않는다(N1·N2). 배포 노트에 적는다.

## 다음 PR 에 넘기는 것

- `refundOrderPayments` 는 반품 정산(PR 6)이 `kind: 'RETURN'`, 메모 `return-settle:${returnId}:${requestId}` 꼴로 쓴다(메모 규칙은 PR 6 이 정한다).
- `loadOrderView` 는 반품 정산이 수령 전후 `pendingDifference` 를 읽는 데 쓴다.
- 반품 택배비 차감은 `cancelShippingFeeBearer` 가 아니라 반품 사유(`ReturnReason.metadata`)의 부담 주체를 쓴다 — 표가 다르다(PR 2·6).
- Medusa 반품 수령은 품목 `quantity` 를 줄이지 않는다(`return_received_quantity` 만 늘어난다, `@medusajs/order/dist/utils/actions/receive-return-item.js`) — PR 6 정산은 «남는 수량 = quantity − 수령·반품 수량»을 정하고, PR 1 의 부분취소 무료배송 깨짐 청구(`groupFees`)와 이중으로 빼지 않는지 함께 본다. (`planShipping`/`planPartialCancel` 은 지금 반품 완료 수량도 남는 수량으로 센다.)
