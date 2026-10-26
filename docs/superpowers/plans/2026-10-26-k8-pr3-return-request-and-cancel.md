# K8 PR 3 — 우리 반품 요청·취소 워크플로와 라우트(store·admin), 자격은 core 내부 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객(스토어프론트)과 CS(관리자)가 우리 라우트로 Medusa 반품을 요청·취소한다. 반품 가능 수량과 «받은 날»은 core 가 주고, 반품비는 요청 때 매기지 않으며(0원 반품 배송 방법), 택배비 부담 주체는 반품 기록에 남는다(PR 6 정산이 읽는다).

**Architecture:** ① core 에 `@InternalOnly` 라우트 하나 — Medusa 줄(`channelOrderItemId`)마다 «배송완료된 판매 단위»와 «마지막 배송완료 시각». ② Medusa 에 core 클라이언트 + 순수 판정 함수(수량·기한·사유) + 오케스트레이터 둘(요청·취소, 둘 다 `orderCancelLockKey` 잠금 안) + 라우트 여섯(store·admin 의 요청·취소·조회). ③ Medusa 는 출고를 모른다(`fulfilled_quantity` 0) — 반품 직전 그 반품이 잡는 수량만큼 `registerFulfillment` 로 올리고, 취소 때 되돌린다(N1).

**Tech Stack:** NestJS + Drizzle(core), Medusa 2.13.4 워크플로·모듈 서비스, Jest(core unit·`describeIfDb` 통합, medusa unit·`@medusajs/test-utils` HTTP 통합), SST infra.

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.2(«우리 워크플로 셋»의 1·2, «Medusa→core 호출이 처음 생긴다», «반품 사유 시드»), §4.3(직배 품목), §4.0(개통 전 수량 0), §6(빌더 몫: Medusa 가 배송완료를 아는지), §8 PR 3. 결정 D1·D5·D9. 이 브랜치는 PR 2(`feat/k8-pr2-return-gate`, #1147) 위에 쌓는다 — 반품 옵션·사유 시드와 기본 라우트 차단이 전제다.

## 코드에서 확인한 것 (PR 2 브랜치 `bb156fc04`)

- **Medusa 는 출고를 모른다.** core 출고는 channel-adapter 가 주문 **metadata** 로만 투영한다(`medusa.client.ts:2023` `updateOrderShippingProjection`, `:2077`). Medusa 코드에 `createOrderFulfillmentWorkflow`·`registerFulfillment` 호출 0 — 라이브 주문의 `detail.fulfilled_quantity` 는 0이다. PR 2 통합 테스트도 반품 전에 `createOrderFulfillmentWorkflow` 를 따로 불러야 했다(`return-setup.spec.ts:91`).
- **코어 반품은 fulfilled 를 요구한다.** `RETURN_ITEM` 검증: `quantity ≤ fulfilled_quantity − return_requested_quantity`(`@medusajs/order/dist/utils/actions/return-item.js:27`). 수령(`receive-return-item.js:13-14`)은 requested 를 줄이고 received 를 올리므로, **이 검증만으로는 이미 돌려받은 수량을 또 반품할 수 있다** — 우리 판정이 received·dismissed 까지 빼야 한다.
- `orderModule.registerFulfillment({ order_id, items: [{ id, quantity }] })` 는 `FULFILL_ITEM` 주문 변경을 만들고 곧바로 확정한다(`services/actions/register-fulfillment.js`) — **fulfillment 모듈 레코드·재고 조정·provider 호출이 없다.** 검증은 `quantity ≤ item.quantity − fulfilled`(`fulfill-item.js:28`). 되돌리기는 `orderModule.cancelFulfillment`(같은 모양, `CANCEL_ITEM_FULFILLMENT`, `cancel-item-fulfillment.js:28` `quantity ≤ fulfilled`).
- fulfilled 를 올리면 주문 수정이 그 아래로 수량을 못 줄인다(`item-update.js:44-46`). 그래서 «배송완료 전부»가 아니라 **반품이 잡는 수량만** 올린다(N1).
- 주문 `fulfillment_status` 집계는 fulfillment 레코드가 있어야 움직인다(`core-flows/dist/order/utils/aggregate-status.js:103-125`) — `registerFulfillment` 만으로는 admin-web 고객 탭 배지(`orders-tab.tsx:280`)가 바뀌지 않는다(테스트로 확인, Review Focus 5).
- 반품 취소(`cancelReturnWorkflow`, `cancel-return.js:42-43`)는 **반품 fulfillment 를 먼저 취소**해야 하고, 받은 품목이 있으면 거절한다. `confirmReturnRequestWorkflow` 가 반품 배송 방법이 있으면 반품 fulfillment 를 만든다(`confirm-return-request.js:185-202`, PR 2 의 almond `createReturnFulfillment`). fulfillment 취소는 `cancelFulfillmentWorkflow({ id })`(almond `cancelFulfillment` 있음, `service.ts:104`).
- 확정 전 실패의 되돌리기는 `cancelReturnRequestWorkflow({ return_id })`(`cancel-request-return.js`) — 열린 주문 변경과 반품을 버린다.
- `beginReturnOrderWorkflow` 입력 `{ order_id, location_id, created_by, metadata }` 의 metadata 는 반품 행에 들어간다(`begin-return.js:63-66`). `location_id` 가 있으면 재고 관리 variant 는 그 위치에 level 이 있어야 한다(`order-validation.js:16-41`). 반품 옵션의 위치는 `service_zone.fulfillment_set.location`(`confirm-return-request.js:67`).
- 코어 라우트에 `/store/orders/:id/returns*`·`/admin/orders/:id/returns*`·`…/returnable` 이 없다(`@medusajs/medusa/dist/api/{store,admin}/orders/[id]/` 실측) — 복제가 override 가 되지 않는다. PR 2 차단 prefix(`/store/returns` 등)와도 안 겹친다.
- 고객 인증은 미들웨어(`authenticate('customer', ['session', 'bearer'])`, `api/middlewares.ts:148-151` confirm-purchase 와 같은 꼴), 소유 확인은 라우트가 `order.customer_id === auth_context.actor_id` 로 한다(`confirm-purchase/route.ts`). `/admin/*` 는 Medusa 가 기본 인증한다.
- core 쪽 재료: `readLineQuantities(trx, salesOrderId)` 의 SKU 층 `delivered`(배송완료 소포 = `dispatched` 출고 시도 × `delivered` 추적, 회수 제외), `completedSetUnits(line, sku => …)`(구성 SKU 마다 floor(수량 ÷ qtyPerUnit) 의 최솟값, 구성이 안 굳었으면 0, `line-sales-units.ts`), `readParcelClaimEligibility(db, salesOrderId)` 의 소포별 `deliveredAt`. 입점사 상자(직배)는 출고 시도가 아니라 `delivered` 에 안 잡힌다(`partner_completed` 는 «배송완료가 아니다», `line-quantities.sql.ts:107`).
- Medusa 줄 ↔ core 판매 라인: `sales_order_lines.channel_order_item_id`(nullable, `(sales_order_id, channel_order_item_id)` 부분 unique — `inventory.schema.ts:1492-1505`). 주문: `sales_orders(sales_channel = 'medusa', channel_order_id = Medusa order id)`.
- core 내부 라우트 본: `SalesOrdersInternalController`(클래스 단위 `@InternalOnly()`, `internal/sales-orders`) → `SalesOrderLookupService` → `SalesOrderLookupReader`. 호출 본: channel-adapter `core-sales-order-lookup.client.ts`(Bearer `CORE_INTERNAL_KEY`, timeout 10s).
- Medusa env 에 core 주소·키가 없다(`deployments/lcnine/services/infra/services.ts:773-830` `medusaEnv`). `coreInternalKey`·`url('core')` 는 같은 파일에 이미 있다(:384, :395).

## 이름 붙은 결정

- **N1. Medusa 의 `fulfilled_quantity` 는 «반품이 잡은 수량»만큼만 올린다.** 반품 요청 직전 줄마다 `topUp = max(0, (requested + received + dismissed + 이번 수량) − fulfilled)` 를 `registerFulfillment` 로 올리고, 올린 값을 반품 metadata 에 남겨 반품 취소 때 `cancelFulfillment` 로 되돌린다. 갈래 셋 중 이것만 부작용이 없다: ⓐ core 출고를 Medusa fulfillment 로 전부 투영하면 주문 취소(`All fulfillments must be canceled`)·부분취소(`item-update` 하한)가 라이브 전 주문에서 깨진다. ⓑ `createOrderFulfillmentWorkflow` 를 반품 때 부르면 Medusa 재고 level 을 깎고 provider 를 부른다. ⓒ `registerFulfillment` 는 order 모듈 공개 메서드이고 주문 변경 이력에 남는다. 설계 §6 «Medusa 가 배송완료일·소포를 아는지 확인»의 답이다 — Task 2 가 설계 §4.2 에 이 결과를 적는다.
- **N2. core 자격 API 는 «청구를 빼기 전» 사실만 준다** — 줄마다 `deliveredUnits`(배송완료 판매 단위)와 `lastDeliveredAt`. 반품으로 빠진 수량은 Medusa 가 자기 반품 기록(`return_requested/received/dismissed`)으로 뺀다. 반품 기록의 주인이 Medusa 라서다(D1). K6 `claimable` 을 쓰면 PR 5 가 그걸 새 반품 예정 기록에 다시 이을 때 **두 번 빠진다.** 판정: `returnable = min(deliveredUnits, item.quantity) − (requested + received + dismissed)`. `item.quantity` 쪽 min 은 배송 뒤 부분취소로 Medusa 수량이 줄어든 경우를 막는다.
- **N3. 이 PR 은 medusa 만이 아니다** — core 내부 라우트 하나와 infra env 둘(`CORE_SERVICE_URL`·`CORE_INTERNAL_KEY`)이 같이 간다. 설계 §8 표의 PR 3 «사는 곳»을 `medusa · core(내부 API) · infra` 로 고친다(Task 2).
- **N4. 고객 기한은 KST 달력 7일.** `lastDeliveredAt` 의 KST 날짜 + 7일의 23:59:59.999 KST 까지. 한 줄이 여러 소포로 왔으면 **마지막** 배송완료 기준(고객에게 유리한 쪽). CS 는 기한을 넘겨도 되지만 `windowOverrideReason` 이 필수이고 반품 metadata 에 남는다(D5). **CS 도 수량은 못 넘긴다**(§4.0).
- **N5. 요청은 `requestId` 로 멱등이다.** 같은 주문에 `metadata.almondReturn.requestId` 가 같은 반품이 있으면 새로 만들지 않고 그것을 돌려준다(상태 무관). 본문 해시가 다르면 `request_id_conflict`. 요청·취소 모두 부분취소와 **같은 잠금**(`orderCancelLockKey`)을 쥔다 — 한 주문에 열린 주문 변경은 하나뿐이다(설계 §4.2).
- **N6. 반품 하나에 사유 하나.** 모든 품목이 같은 `reason_id` 를 갖는다. 택배비 부담 주체(`'customer' | 'seller'`)는 반품 metadata 에 확정값으로 남는다: 사유 표의 값, 사유가 `operator`(기타)면 CS 가 준 값(필수). 고객은 `customerSelectable: false` 사유를 못 고른다.
- **N7. 응답 계약** — 업무 거절 400 `{ type: 'not_allowed', code: 'return_rejected', reason, message }`, 주문·반품이 없거나 남의 것이면 404(존재를 흘리지 않는다), core 가 답하지 않으면 502 `{ type: 'core_unavailable', message }`(재시도 안내, 설계 §4.2). 그 밖은 던져 500.
- **N8. 조회 라우트를 같이 둔다** — `GET …/returnable` 이 줄마다 반품 가능 수량과 기한 끝을 준다. 판정 함수를 그대로 쓰므로 PR 7·8 화면이 같은 규칙을 따로 짜지 않는다.

## Global Constraints

- 사는 곳: `apps/medusa`, `apps/core`(내부 라우트 하나), `deployments/lcnine/services/infra/services.ts`(env 둘), `apps/medusa/.env.template`. **마이그레이션 없음, 이벤트 계약 변경 없음, channel-adapter 변경 없음.**
- 배포: core 와 Medusa 가 같은 `sst deploy` 에 실린다. 순서 제약 없음 — core 라우트가 먼저 없으면 Medusa 반품 요청이 502 로 닫히고(개통 전이라 호출자 0), Medusa 가 먼저 없으면 라우트가 놀 뿐이다. **PR 2 와 같은 배포이거나 그 뒤**여야 한다(반품 옵션·사유·기본 라우트 차단).
- 개통 플래그 없음(§4.0): 셀메이트 시기에는 `deliveredUnits` 가 전부 0 이라 요청이 `not_delivered` 로 거절된다.
- Medusa 확장 규칙(CLAUDE.md «Medusa»): 코어 라우트 override 금지(새 경로에 복제), 워크플로 훅 등록 없음, 모듈 서비스 교체 없음.
- core 레이어: Controller → Service(2~3줄) → Reader. 트랜잭션은 `dbService.run(fn, tx)`. `any`·`as` 금지(Medusa 쪽은 기존 파일 관례를 따른다).
- 반품 metadata 키 `almondReturn`, 모양 `ReturnRequestRecord`(Task 3). PR 6 정산이 `feeBearer` 를 여기서 읽는다.
- 잠금 timeout 60초(`locking.execute(orderCancelLockKey(orderId), fn, { timeout: 60 })`).
- core 클라이언트 timeout 5000ms, 경로 `POST ${CORE_SERVICE_URL}/internal/sales-orders/return-eligibility`, 헤더 `Authorization: Bearer ${CORE_INTERNAL_KEY}`. env 는 **호출 때** 읽는다(테스트가 env 로 가짜 core 를 꽂는다).
- 게이트: `npm run type-check`, `npx jest apps/core/src/modules/sales-order/internal scripts/security`, core 통합(`DATABASE_URL` 주입, `describeIfDb`), `(cd apps/medusa && npm run test:unit)`, `scripts/local/run-medusa-integration.sh --testPathPattern '<패턴>'`(postgres·redis 둘 다), `(cd apps/medusa && npx tsc --noEmit -p tsconfig.json)` 에서 이 PR 파일 에러 0.

## Review Focus

1. **이미 돌려받은 수량을 또 반품** — 2개 중 1개 반품을 수령(received)한 뒤 같은 줄 2개 반품 요청은 `quantity_exceeds_returnable`(코어 검증은 통과시킨다 — requested 만 뺀다). Task 2 단위 테스트 + Task 3 통합 테스트(`receiveItemReturnRequest` 로 수령까지 진행 뒤).
2. **같은 요청이 두 번 온다(더블클릭·재시도)** — 같은 `requestId` 로 두 번 부르면 반품 1개, `fulfilled_quantity` 는 한 번만 오른다. 동시에 두 번(`Promise.all`)도 같다. Task 3 통합 테스트.
3. **확정 전 실패가 흔적을 남긴다** — 반품 배송 방법 단계에서 던지면(반품 옵션 삭제로 재현) 열린 주문 변경 0, 반품 행은 canceled 이거나 없음, `fulfilled_quantity` 원래대로. 이어서 부분취소가 성공한다. Task 3 통합 테스트.
4. **반품 취소 뒤 부분취소** — 반품 요청 → 취소 → 같은 줄 전량 부분취소가 성공한다(`fulfilled_quantity` 가 되돌아가지 않으면 `item-update` 하한에 막힌다). Task 5 통합 테스트.
5. **반품이 주문 배송 상태를 바꾸지 않는다** — 반품 요청 뒤 주문 `fulfillment_status` 가 요청 전과 같다(admin-web 고객 탭 배지). Task 3 통합 테스트.

---

### Task 1: core — 줄별 배송완료 판매 단위·마지막 배송완료 시각 내부 API

**Files:**
- Create: `apps/core/src/modules/sales-order/internal/return-eligibility.dto.ts`
- Create: `apps/core/src/modules/sales-order/internal/return-eligibility.ts` (순수 조립)
- Create: `apps/core/src/modules/sales-order/internal/return-eligibility.reader.ts`
- Create: `apps/core/src/modules/sales-order/internal/return-eligibility.service.ts`
- Modify: `apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.ts` (핸들러 하나)
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts` (providers 둘, `SalesOrderLookupService` 옆)
- Test: `apps/core/src/modules/sales-order/internal/return-eligibility.spec.ts`, `return-eligibility.reader.integration.spec.ts`, `sales-orders-internal.controller.spec.ts`(케이스 추가)

**Interfaces:**
- Produces:
  - DTO `ReturnEligibilityRequestDto { @IsIn(['medusa']) salesChannel: 'medusa'; @IsString() @MaxLength(255) externalOrderId: string }`.
  - `export interface ReturnEligibilityLine { channelOrderItemId: string; deliveredUnits: number; lastDeliveredAt: string | null }` (ISO 문자열)
  - `export interface ReturnEligibilityResponse { found: boolean; lines: ReturnEligibilityLine[] }`
  - `export function toReturnEligibilityLines(lines: Array<{ channelOrderItemId: string | null; quantities: LineQuantities }>, parcels: ParcelClaimEligibility[]): ReturnEligibilityLine[]` — `channelOrderItemId` 가 null 인 줄은 뺀다. `deliveredUnits = completedSetUnits(quantities, sku => sku.delivered)`. `lastDeliveredAt` = 그 판매 라인 소포들의 `deliveredAt` 최댓값, 없으면 null. 순서는 입력 순.
  - `export async function readReturnEligibility(trx: DbTx, externalOrderId: string): Promise<ReturnEligibilityResponse>` — `sales_orders` 에서 `sales_channel = 'medusa' and channel_order_id = $1` 한 행, 없으면 `{ found: false, lines: [] }`. 있으면 `readLineQuantities`·`readParcelClaimEligibility` 와 그 주문 판매 라인의 `id, channel_order_item_id` 를 읽어 `toReturnEligibilityLines`.
  - `ReturnEligibilityReader.read(externalOrderId: string, tx?: DbTx)` = `dbService.run(trx => readReturnEligibility(trx, externalOrderId), tx)`; `ReturnEligibilityService.read(dto)` 가 위임.
  - 라우트 `POST /internal/sales-orders/return-eligibility`, 200, 본문 `ReturnEligibilityResponse`. 클래스 단위 `@InternalOnly()` 가 이미 덮는다.
- Consumes: `readLineQuantities`, `LineQuantities`(`line-quantities.reader.ts`), `completedSetUnits`(`line-sales-units.ts`), `readParcelClaimEligibility`, `ParcelClaimEligibility`.

- [ ] **Step 1: 순수 조립 단위 테스트를 쓴다** (`return-eligibility.spec.ts`, `LineQuantities` 를 손으로 만든다)

```ts
it('단품 3개 중 2개 배송완료 → deliveredUnits 2, 마지막 배송완료 시각', () => {
  expect(toReturnEligibilityLines([{ channelOrderItemId: 'ordli_1', quantities: line('L1', [{ sku: 'S1', qtyPerUnit: 1, delivered: 2 }]) }],
    [parcel('L1', '2026-10-20T01:00:00.000Z'), parcel('L1', '2026-10-22T05:00:00.000Z')]))
    .toEqual([{ channelOrderItemId: 'ordli_1', deliveredUnits: 2, lastDeliveredAt: '2026-10-22T05:00:00.000Z' }]);
});
it('세트(구성품 둘, 1개당 1·2) 중 한 구성품만 배송완료 → 0', /* S1 delivered 1, S2 delivered 0 → 0 */);
it('구성이 안 굳은 줄(qtyPerUnit null) → 0', /* … */);
it('channelOrderItemId 가 null 인 줄은 빠진다', /* … */);
it('소포가 없는 줄은 lastDeliveredAt null', /* … */);
```

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/internal/return-eligibility.spec.ts` → FAIL(모듈 없음).
- [ ] **Step 3: `toReturnEligibilityLines` 구현** — 위 Interfaces 그대로. 산술은 `completedSetUnits` 에 맡긴다.
- [ ] **Step 4: 통합 테스트를 쓴다** (`return-eligibility.reader.integration.spec.ts`, `describeIfDb`, `inRollbackTx(makeDb(...))`, 픽스처 `seedWorld`·`seedDeliveredLine`·`seedComponentSku` — `claim-facts.integration.spec.ts` 와 같은 꼴). 시드 뒤 같은 tx 에서 `sales_orders.sales_channel = 'medusa'`, `channel_order_id = 'order_test_1'`, 라인 `channel_order_item_id = 'ordli_1'` 로 갱신한다.
  - `'배송완료 소포 둘(1+1) → deliveredUnits 2, lastDeliveredAt 은 readParcelClaimEligibility 의 최댓값'`
  - `'배송 안 된 소포(delivered: false)는 세지 않는다'` → 0, null
  - `'회수된 소포(recallParcel)는 세지 않는다'`
  - `'입점사 상자(seedSupplierShare)만 있는 줄 → 0'` (설계 §4.3 직배 제외)
  - `'다른 채널(naver) 주문은 found false'`, `'없는 주문 → { found: false, lines: [] }'`
- [ ] **Step 5: `readReturnEligibility`·Reader·Service·DTO·핸들러·모듈 등록 구현.**
- [ ] **Step 6: 컨트롤러 단위 케이스 추가** — `sales-orders-internal.controller.spec.ts` 에 `returnEligibility` 가 서비스 결과를 그대로 돌려주는 케이스.
- [ ] **Step 7: 통과 확인** — `npx jest apps/core/src/modules/sales-order/internal scripts/security libs/authorization` PASS, `DATABASE_URL=… npx jest apps/core/src/modules/sales-order/internal/return-eligibility.reader.integration.spec.ts` PASS(`npm run test:core:integration:local` 로 띄운 DB), `npm run type-check` 0.
- [ ] **Step 8: 커밋** — `K8 PR3 — core 가 Medusa 줄마다 배송완료 판매 단위와 마지막 배송완료 시각을 내부 API 로 준다`

---

### Task 2: Medusa — core 자격 클라이언트, 순수 판정, env 배선, 설계 교정

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/core-return-eligibility.ts`
- Create: `apps/medusa/src/workflows/orders/returns/plan-return-request.ts`
- Create: `apps/medusa/src/workflows/orders/returns/return-window.ts`
- Modify: `deployments/lcnine/services/infra/services.ts` (`medusaEnv` 에 `CORE_SERVICE_URL: url('core')`, `CORE_INTERNAL_KEY: coreInternalKey.value` — 서버 간 키 묶음 `MEMBERSHIP_INTERNAL_KEY` 옆)
- Modify: `apps/medusa/.env.template` (서버 간 키 묶음에 `CORE_SERVICE_URL=http://localhost:3001`, `CORE_INTERNAL_KEY=` + «core 의 같은 이름 env 와 같아야 한다» 한 줄)
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` (§4.2 «반품 가능 수량과 기한의 근거는 core» 문단에 N1·N2 결과, §8 PR 3 행 «사는 곳» → `medusa · core(내부 API) · infra`)
- Test: `apps/medusa/src/workflows/orders/returns/__tests__/plan-return-request.unit.spec.ts`, `return-window.unit.spec.ts`, `core-return-eligibility.unit.spec.ts`

**Interfaces:**
- Produces:
  - `export type CoreReturnEligibility = { found: boolean; lines: Array<{ channelOrderItemId: string; deliveredUnits: number; lastDeliveredAt: Date | null }> }`
  - `export class CoreEligibilityUnavailable extends Error`
  - `export async function fetchCoreReturnEligibility(orderId: string): Promise<CoreReturnEligibility>` — env 누락·non-2xx·timeout·모양 불일치(배열 아님, 수가 아닌 `deliveredUnits`, 파싱 안 되는 날짜) 전부 `CoreEligibilityUnavailable`. `fetch` + `AbortSignal.timeout(5000)`.
  - `export function returnWindowEndsAt(deliveredAt: Date): Date` (N4)
  - `export type ReturnRequestedBy = 'customer' | 'operator'`
  - `export type ReturnRejectReason = 'order_canceled' | 'item_not_in_order' | 'not_delivered' | 'quantity_exceeds_returnable' | 'window_closed' | 'window_override_reason_required' | 'reason_not_found' | 'reason_not_selectable' | 'fee_bearer_required' | 'request_id_conflict' | 'return_option_missing' | 'return_already_received' | 'not_our_return'`
  - `export class ReturnRequestRejected extends Error { constructor(readonly reason: ReturnRejectReason, message: string) }`
  - `export type ReturnableOrderItem = { id: string; quantity: number; fulfilled: number; returnRequested: number; returnReceived: number; returnDismissed: number }`
  - `export type ReturnableLine = { itemId: string; returnableQuantity: number; windowEndsAt: Date | null }`
  - `export function describeReturnable(items: ReturnableOrderItem[], core: CoreReturnEligibility): ReturnableLine[]` — N2 공식, 음수는 0. core 줄이 없으면 0·null.
  - `export function planReturnRequest(input: { orderStatus: string; items: ReturnableOrderItem[]; core: CoreReturnEligibility; requested: Array<{ itemId: string; quantity: number }>; requestedBy: ReturnRequestedBy; reason: { value: string; feeBearer: ReturnFeeBearer | null; customerSelectable: boolean } | null; operatorFeeBearer?: 'customer' | 'seller'; windowOverrideReason?: string; now: Date }): { items: Array<{ itemId: string; quantity: number }>; fulfillmentTopUp: Array<{ itemId: string; quantity: number }>; feeBearer: 'customer' | 'seller'; windowOverridden: boolean }` — 판정 순서: 주문 취소 → 사유(없음 → `reason_not_found`, 고객이 `customerSelectable` false → `reason_not_selectable`, `feeBearer` null(표 밖 사유) → `reason_not_found`, `operator` 인데 `operatorFeeBearer` 없음 → `fee_bearer_required`) → 품목(주문에 없음 → `item_not_in_order`, `returnableQuantity` 0 이고 core `deliveredUnits` 0 → `not_delivered`, 넘침 → `quantity_exceeds_returnable`) → 기한(`now > windowEndsAt` 인 품목이 하나라도: 고객 → `window_closed`, CS 이고 `windowOverrideReason` 공백 → `window_override_reason_required`, 아니면 `windowOverridden: true`). `fulfillmentTopUp` 은 N1 공식, 0 인 줄은 뺀다.
- Consumes: `ReturnFeeBearer`(`returns/return-reasons.ts`, PR 2).

- [ ] **Step 1: 기한 테스트** — `returnWindowEndsAt(new Date('2026-10-20T15:30:00.000Z'))`(KST 10-21 00:30) → `2026-10-28T14:59:59.999Z`; `new Date('2026-10-20T14:59:59.000Z')`(KST 10-20 23:59) → `2026-10-27T14:59:59.999Z`. jest 는 UTC 로 뜨므로 런타임 TZ 에 기대지 않는 산술(+9h 고정)로 구현한다.
- [ ] **Step 2: 판정 테스트** — 최소 아래를 `it` 하나씩:
  - `'배송완료 2, 주문 수량 2, 반품 0 → 2개 요청 통과, topUp 2(fulfilled 0)'`
  - `'수령 1(received 1, requested 0, fulfilled 1) 뒤 2개 요청 → quantity_exceeds_returnable'` (Review Focus 1)
  - `'배송 뒤 부분취소로 item.quantity 1, deliveredUnits 2 → 1 이 상한'`
  - `'core 줄 없음 또는 deliveredUnits 0 → not_delivered'`
  - `'고객, 기한 지남 → window_closed / CS, 사유 없이 → window_override_reason_required / CS, 사유와 함께 → windowOverridden true, 수량 상한은 그대로'`
  - `'고객이 기타 → reason_not_selectable / CS 기타, operatorFeeBearer 없음 → fee_bearer_required / CS 기타 + seller → feeBearer seller'`
  - `'단순 변심 → feeBearer customer, 상품 하자 → seller'`
  - `'fulfilled 가 이미 반품 점유보다 크면 topUp 0 이고 목록에서 빠진다'`
  - `describeReturnable`: `'음수는 0, windowEndsAt 은 lastDeliveredAt 기준'`
- [ ] **Step 3: 클라이언트 테스트** — `global.fetch` 를 jest mock 으로: 200 정상 → 날짜가 `Date`; 401·500·`AbortError`·`{ lines: 'x' }` → `CoreEligibilityUnavailable`; env 없음 → `CoreEligibilityUnavailable` 이고 fetch 0회; 요청 본문 `{ salesChannel: 'medusa', externalOrderId }`·헤더 `Bearer` 확인.
- [ ] **Step 4: 실패 확인** — `(cd apps/medusa && npx jest --testPathPattern 'returns/__tests__/(plan-return-request|return-window|core-return-eligibility)')` FAIL.
- [ ] **Step 5: 세 파일 구현.**
- [ ] **Step 6: infra·`.env.template`·설계 문서 수정.**
- [ ] **Step 7: 통과 확인** — 같은 jest PASS, `(cd apps/medusa && npm run test:unit)` PASS, `npm run type-check` 0(infra 파일 포함).
- [ ] **Step 8: 커밋** — `K8 PR3 — Medusa 가 core 에 반품 자격을 묻고, 수량·기한·사유를 한 함수가 판정한다`

---

### Task 3: Medusa — 반품 요청 오케스트레이터

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/load-return-order.ts`
- Create: `apps/medusa/src/workflows/orders/returns/request-order-return.ts`
- Create: `apps/medusa/integration-tests/http/fixtures/return-fixture.ts` (`FakeCore`, 고객 헤더)
- Test: `apps/medusa/integration-tests/http/return-request.spec.ts`

**Interfaces:**
- Produces:
  - `export const RETURN_REQUEST_METADATA_KEY = 'almondReturn'`
  - `export type ReturnRequestRecord = { requestId: string; requestHash: string; requestedBy: ReturnRequestedBy; reasonValue: string; feeBearer: 'customer' | 'seller'; windowOverride: { reason: string; actorId: string | null } | null; fulfillmentTopUp: Array<{ itemId: string; quantity: number }>; fulfillmentTopUpReverted?: boolean }`
  - `export function readReturnRequestRecord(metadata: unknown): ReturnRequestRecord | null`
  - `export type ReturnOrder = { id: string; status: string; customerId: string | null; items: ReturnableOrderItem[]; returns: Array<{ id: string; status: string; record: ReturnRequestRecord | null }> }`
  - `export async function loadReturnOrder(container: MedusaContainer, orderId: string): Promise<ReturnOrder | null>` — `query.graph` 로 `items.detail.{fulfilled_quantity,return_requested_quantity,return_received_quantity,return_dismissed_quantity}`·`returns.{id,status,metadata}`. 수는 `toNumber`(`partial-cancel/amount.ts`).
  - `export type RequestOrderReturnInput = { orderId: string; requestId: string; items: Array<{ itemId: string; quantity: number }>; reasonValue: string; note?: string; requestedBy: ReturnRequestedBy; customerId?: string; operatorFeeBearer?: 'customer' | 'seller'; windowOverrideReason?: string; actorId?: string; now?: Date }`
  - `export type RequestOrderReturnResult = { returnId: string; requestId: string; status: string; items: Array<{ itemId: string; quantity: number }>; feeBearer: 'customer' | 'seller'; windowOverridden: boolean }`
  - `export class ReturnOrderNotFound extends Error`
  - `export async function requestOrderReturn(container: MedusaContainer, input: RequestOrderReturnInput): Promise<RequestOrderReturnResult>`
  - 픽스처: `class FakeCore { constructor(port = 39132); start(); stop(); setEligibility(orderId: string, lines: Array<{ channelOrderItemId: string; deliveredUnits: number; lastDeliveredAt: string | null }>): void; failWith(status: number | null): void; calls: Array<{ externalOrderId: string; authorization: string | undefined }> }`, `export const CORE_PORT = 39132`, `export async function customerHeaders(container, c: Commerce): Promise<{ customerId: string; headers: { headers: Record<string, string> } }>`(customer 생성 + `actor_type: 'customer'` JWT + publishable key), `export async function assignOrderToCustomer(container, orderId, customerId)`(`orderModule.updateOrders`).
- Consumes: Task 2 의 `fetchCoreReturnEligibility`·`planReturnRequest`·`ReturnRequestRejected`; PR 2 의 `findReturnShippingOptionId`·`RETURN_REASONS`·`readReturnFeeBearer`·`RETURN_REASON_CUSTOMER_SELECTABLE_KEY`; `orderCancelLockKey`(`settlement/order-payments.ts`); 코어 `beginReturnOrderWorkflow`·`requestItemReturnWorkflow`·`createReturnShippingMethodWorkflow`·`confirmReturnRequestWorkflow`·`cancelReturnRequestWorkflow`.

`requestOrderReturn` 순서(잠금 안, 이 순서가 Review Focus 2·3 을 정한다):
1. `loadReturnOrder` — 없거나 `requestedBy === 'customer'` 인데 `customerId` 불일치 → `ReturnOrderNotFound`.
2. 같은 `requestId` 기록이 있으면: 해시(품목 정렬·사유·`operatorFeeBearer`) 같으면 그 반품을 결과로, 다르면 `request_id_conflict`.
3. `fetchCoreReturnEligibility` → 사유 행(`listReturnReasons({ value })`) → `planReturnRequest`.
4. 반품 옵션 id(`findReturnShippingOptionId`)와 그 위치 id. 없으면 `logger.error('[return-request] 반품 배송 옵션이 없다 — seed-shipping 확인')` 뒤 `return_option_missing`(설계 §4.2 «시드 누락이 조용히 깨지지 않게»).
5. `fulfillmentTopUp` 이 있으면 `registerFulfillment`.
6. `beginReturnOrderWorkflow({ order_id, location_id, created_by: actorId, metadata: { almondReturn: record } })` → `requestItemReturnWorkflow`(품목마다 `reason_id`, `internal_note` 없이 `note`) → `createReturnShippingMethodWorkflow({ custom_amount: 0 })` → `confirmReturnRequestWorkflow({ confirmed_by: actorId })`.
7. 5 이후 6 안에서 던지면: 반품 id 가 생겼으면 `cancelReturnRequestWorkflow`, 5 에서 올린 만큼 `orderModule.cancelFulfillment`, 둘 다 실패를 삼키고 원래 오류를 던진다.

- [ ] **Step 1: `FakeCore`·고객 헤더 픽스처를 쓴다** — `FakeWallet` 과 같은 꼴(node `http`, 응답 기본은 `{ found: false, lines: [] }`).
- [ ] **Step 2: 실패하는 통합 테스트를 쓴다** — `medusaIntegrationTestRunner({ inApp: true, env: { WALLET_BASE_URL, WALLET_API_KEY, CORE_SERVICE_URL: 'http://127.0.0.1:39132', CORE_INTERNAL_KEY: 'test-core-key' } })`, `beforeAll`: `setupCommerce`, `seedShipping` 대신 `ensureReturnShippingOption`·`ensureReturnReasons`(PR 2). 오케스트레이터를 in-process 로 부른다:
  - `'배송완료 2 중 1개 단순 변심 → 반품 requested, 품목 1·사유 change_of_mind, metadata.almondReturn.feeBearer customer, fulfilled 1, NOT_PAID 결제 컬렉션 0'`
  - `'반품 fulfillment 가 almond 로 생기고 반품 location_id 가 반품 옵션 위치'`
  - `'수령 뒤(begin/receive/confirmReceive) 같은 줄 2개 → quantity_exceeds_returnable'` (Review Focus 1)
  - `'같은 requestId 두 번 → 반품 1개, fulfilled 1 / Promise.all 두 번도 같다 / 다른 본문 → request_id_conflict'` (Review Focus 2)
  - `'반품 옵션을 지운 뒤 → return_option_missing, 열린 주문 변경 0, fulfilled 0'`
  - `'확정 단계에서 던지면 → 반품 canceled 또는 없음, 열린 주문 변경 0, fulfilled 0, 이어서 partialCancelOrder 성공'` (Review Focus 3) — `jest.spyOn(require('@medusajs/medusa/core-flows'), 'confirmReturnRequestWorkflow').mockImplementationOnce(() => ({ run: () => Promise.reject(new Error('boom')) }))`. `inApp: true` 라 앱이 같은 모듈 레지스트리를 쓰고, `@swc/jest` 의 CJS 출력은 호출 때 속성을 읽으므로 spy 가 걸린다. 가장 깊은 실패 지점(반품도 있고 출고 수량도 올린 뒤)이라 되돌리기 전부를 본다.
  - `'요청 전후 주문 fulfillment_status 같다'` (Review Focus 5)
  - `'core 500 → CoreEligibilityUnavailable, 반품 0'`, `'core found false → not_delivered'`
- [ ] **Step 3: 실패 확인** — `scripts/local/run-medusa-integration.sh --testPathPattern return-request` FAIL.
- [ ] **Step 4: `load-return-order.ts`·`request-order-return.ts` 구현.** 재고 관리 variant 가 반품 위치 level 검증에 걸리면(`Cannot request item return at location`) 픽스처가 variant 를 그 위치에 연결하게 고치고, 라이브도 위치가 하나라는 근거(설계 §4.4-4)를 주석에 남긴다.
- [ ] **Step 5: 통과 확인** — 같은 통합 PASS, `(cd apps/medusa && npm run test:unit)` PASS.
- [ ] **Step 6: 커밋** — `K8 PR3 — 반품 요청은 core 자격으로 판정하고, 반품이 잡는 수량만 Medusa 에 출고로 올린 뒤 0원 반품 배송으로 확정한다`

---

### Task 4: Medusa — 반품 요청·조회 라우트(store·admin)

**Files:**
- Create: `apps/medusa/src/api/store/orders/[id]/returns/route.ts` (POST)
- Create: `apps/medusa/src/api/store/orders/[id]/returnable/route.ts` (GET)
- Create: `apps/medusa/src/api/admin/orders/[id]/returns/route.ts` (POST)
- Create: `apps/medusa/src/api/admin/orders/[id]/returnable/route.ts` (GET)
- Create: `apps/medusa/src/api/orders-returns/parse-return-input.ts` (store·admin 공용 본문 파서)
- Create: `apps/medusa/src/api/orders-returns/return-error-response.ts` (N7 매핑 한 곳)
- Modify: `apps/medusa/src/api/middlewares.ts` (`'/store/orders/:id/returns'`·`'/store/orders/:id/returnable'` 에 `authenticate('customer', ['session', 'bearer'])`, method 없이 — 하위 `/:return_id/cancel` 까지 덮는다)
- Test: `apps/medusa/src/api/orders-returns/__tests__/parse-return-input.unit.spec.ts`, `return-error-response.unit.spec.ts`, `apps/medusa/integration-tests/http/return-routes.spec.ts`

**Interfaces:**
- Produces:
  - 본문(snake_case, 기존 라우트 관례): store `{ request_id, items: [{ item_id, quantity }], reason, note? }`, admin 은 + `fee_bearer?: 'customer' | 'seller'`, `window_override_reason?: string`.
  - `export function parseReturnRequestBody(body: unknown, scope: 'store' | 'admin'): Omit<RequestOrderReturnInput, 'orderId' | 'requestedBy' | 'customerId' | 'actorId' | 'now'>` — 빈 `request_id`·빈 `items`·정수 아닌/0 이하 수량·**같은 `item_id` 중복**·문자열 아닌 `reason` → `MedusaError(INVALID_DATA)`. store 범위에서 `fee_bearer`·`window_override_reason` 이 오면 **INVALID_DATA**(고객이 CS 권한을 흉내 내지 못하게).
  - `export function sendReturnError(res: MedusaResponse, error: unknown): boolean` — `ReturnRequestRejected` → 400 N7, `ReturnOrderNotFound` → 404 `{ type: 'not_found', message }`, `CoreEligibilityUnavailable` → 502 N7. 처리했으면 true, 아니면 false(호출자가 다시 던진다).
  - 응답: POST 200 `RequestOrderReturnResult` 를 snake_case 로(`return_id`·`request_id`·`status`·`items[{ item_id, quantity }]`·`fee_bearer`·`window_overridden`). GET 200 `{ items: [{ item_id, returnable_quantity, window_ends_at }] }`(`describeReturnable`, ISO 또는 null).
  - store 는 `customerId = req.auth_context.actor_id`, `requestedBy: 'customer'`; admin 은 `requestedBy: 'operator'`, `actorId = req.auth_context.actor_id`. GET store 도 소유 확인(아니면 404).
- Consumes: Task 3 `requestOrderReturn`·`loadReturnOrder`·`ReturnOrderNotFound`, Task 2 `describeReturnable`·`fetchCoreReturnEligibility`.

- [ ] **Step 1: 파서·오류 매핑 단위 테스트** — 위 규칙마다 하나. store 범위의 `fee_bearer` 거절 포함.
- [ ] **Step 2: 라우트 통합 테스트** (`return-routes.spec.ts`, Task 3 픽스처):
  - `'로그인 없이 POST /store/orders/:id/returns → 401, 반품 0'`
  - `'남의 주문 → 404, 반품 0'` / `'남의 주문 GET returnable → 404'`
  - `'본인 주문 → 200, fee_bearer customer'`
  - `'고객 본문에 fee_bearer → 400'`
  - `'기한 지난 주문: 고객 400 reason window_closed / admin 사유 없이 400 window_override_reason_required / admin 사유 있으면 200 window_overridden true'`
  - `'admin 기타 + fee_bearer seller → 200, metadata feeBearer seller'`
  - `'core 500 → 502 core_unavailable'`
  - `'GET returnable — 수령 뒤 수치가 준다'`
  - `'PR 2 차단과 안 겹친다: POST /store/returns 는 여전히 400 default_return_route_blocked'`
- [ ] **Step 3: 실패 확인** — 단위 jest + `run-medusa-integration.sh --testPathPattern return-routes` FAIL.
- [ ] **Step 4: 라우트·파서·매핑·미들웨어 구현.** 라우트 파일마다 부분취소 라우트처럼 맨 위 주석에 경로·호출자·응답 계약.
- [ ] **Step 5: 통과 확인** — 단위·통합 PASS.
- [ ] **Step 6: 커밋** — `K8 PR3 — 고객·CS 반품 요청과 반품 가능 수량 조회 라우트(로그인·소유·기한 넘김 사유)`

---

### Task 5: Medusa — 반품 취소 오케스트레이터와 라우트

**Files:**
- Create: `apps/medusa/src/workflows/orders/returns/cancel-order-return.ts`
- Create: `apps/medusa/src/api/store/orders/[id]/returns/[return_id]/cancel/route.ts`
- Create: `apps/medusa/src/api/admin/orders/[id]/returns/[return_id]/cancel/route.ts`
- Test: `apps/medusa/integration-tests/http/return-cancel.spec.ts`

**Interfaces:**
- Produces:
  - `export type CancelOrderReturnInput = { orderId: string; returnId: string; requestedBy: ReturnRequestedBy; customerId?: string; actorId?: string }`
  - `export type CancelOrderReturnResult = { returnId: string; status: 'canceled' }`
  - `export async function cancelOrderReturn(container: MedusaContainer, input: CancelOrderReturnInput): Promise<CancelOrderReturnResult>` — 잠금 안에서:
    1. 주문·반품 로드. 반품이 그 주문 것이 아니거나 고객 불일치 → `ReturnOrderNotFound`. `almondReturn` 기록 없음 → `not_our_return`.
    2. 이미 canceled: 기록의 `fulfillmentTopUpReverted` 가 true 가 아니면 3-③ 만 하고 결과. 이미 true 면 그대로 결과(멱등).
    3. 받은 품목이 하나라도 있으면 `return_already_received`. 아니면 ① 취소 안 된 반품 fulfillment 마다 `cancelFulfillmentWorkflow({ id })` ② `cancelReturnWorkflow({ return_id, canceled_by: actorId })` ③ `fulfillmentTopUp` 이 있으면 `orderModule.cancelFulfillment({ order_id, items })` 뒤 `orderModule.updateReturns({ id, metadata: { …, almondReturn: { …record, fulfillmentTopUpReverted: true } } })`.
  - 라우트: `POST /store/orders/:id/returns/:return_id/cancel`(고객, 본문 없음), `POST /admin/orders/:id/returns/:return_id/cancel`. 200 `{ return_id, status: 'canceled' }`, 오류는 `sendReturnError`.
- Consumes: Task 3 `loadReturnOrder`·`readReturnRequestRecord`·`ReturnOrderNotFound`, Task 2 `ReturnRequestRejected`, Task 4 `sendReturnError`; 코어 `cancelFulfillmentWorkflow`·`cancelReturnWorkflow`.

- [ ] **Step 1: 실패하는 통합 테스트**:
  - `'요청 → 고객 취소 → 반품 canceled, 반품 fulfillment canceled_at 있음, fulfilled 0, return_requested 0'`
  - `'취소 뒤 같은 줄 전량 partialCancelOrder 성공'` (Review Focus 4)
  - `'두 번 취소 → 둘 다 200, cancelFulfillment 한 번'`
  - `'③ 직전에 끊긴 취소(반품 canceled + fulfillmentTopUpReverted 없음)를 다시 부르면 fulfilled 만 되돌린다'` — `cancelReturnWorkflow` 를 테스트에서 직접 부르고 라우트 호출
  - `'수령 뒤 취소 → 400 return_already_received'`
  - `'남의 주문의 반품 / 다른 주문 id 로 → 404'`
- [ ] **Step 2: 실패 확인** — `run-medusa-integration.sh --testPathPattern return-cancel` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 같은 통합 PASS, Task 3·4 통합도 다시 PASS, `(cd apps/medusa && npm run test:unit)` PASS.
- [ ] **Step 5: 커밋** — `K8 PR3 — 도착 전 반품 취소(반품 fulfillment·반품·올린 출고 수량을 차례로 되돌린다)`

---

## 배포 노트 (PR 본문에 옮긴다)

- **PR 2(#1147)와 같은 배포 또는 그 뒤.** 이 PR 은 PR 2 브랜치 위에 쌓였다 — PR 2 머지 뒤 develop 으로 base 를 바꾼다.
- 마이그 없음. core·Medusa·infra env 가 한 `sst deploy` 에 실린다. 새 env 는 `medusaEnv` 에서 store·admin 두 서비스에 같이 들어간다.
- 개통 전에는 휴면이다: 셀메이트 시기 라이브의 `deliveredUnits` 는 전부 0 → 고객·CS 요청 모두 `not_delivered`. 고객에게 보이는 버튼은 PR 8, CS 화면은 PR 7.
- Medusa 주문 변경 이력에 `FULFILL_ITEM`(반품 요청마다)이 생긴다 — fulfillment 레코드·재고·배송 상태는 그대로(N1).
- 롤백(이전 task definition) 안전: 옛 코드는 반품 metadata 를 안 읽고, 새 라우트가 사라질 뿐이다. 이미 만든 반품은 Medusa 기본 라우트가 막혀 있어 PR 6 전까지 손댈 길이 없다 — 개통 전이라 0건이다.
- 배포 뒤 확인: ① `POST /internal/sales-orders/return-eligibility`(키 없이) → 401 ② Medusa 로그에 `CORE_INTERNAL_KEY` 미설정 오류 없음 ③ 아무 라이브 주문으로 `GET /admin/orders/:id/returnable` → 200, 전 줄 0(셀메이트 시기 전제 확인).
