# K8 PR 5 — core 반품 예정 기록 + Medusa 반품 관측 + 접수 고객 이벤트 + K6 다시 잇기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medusa 에서 확정된 반품을 channel-adapter 가 관측해 core 에 알리고, core 는 «반품 예정» 기록을 만든다. 그 기록이 고객 «반품 접수» 이벤트를 내고, K6 청구 수량과 취소 상한에 들어간다. PR 6(도착·검수·정산)이 이 기록 위에서 돈다.

**Architecture:** ① 이벤트 계약에 새 사실 둘(`ChannelReturnRequested`·`ChannelReturnCancelled`, `orders.events.v1`)을 더하고, 쓰는 곳이 없는 `OrderReturnRequested` 를 지운다. ② channel-adapter `MedusaOrderSource` 가 주문의 `returns` 를 읽어 사후 관측 두 종류를 만든다. 지금 취소·환불이 타는 `claimFirstSeen` → 아웃박스 길을 그대로 탄다. ③ core 에 `customer_returns`·`customer_return_lines` 테이블과 상태 전이 함수 하나를 둔다. 소비자가 그 전이로 `expected`·`cancelled` 를 쓰고, 같은 트랜잭션에서 `SalesOrderClaimProgressed(requested)` 를 낸다. ④ K6 의 SKU 청구 합이 새 기록을 같이 센다. 취소 상한은 «남은 수량 − 반품이 잡은 수량»이 된다.

**Tech Stack:** NestJS + Drizzle(core·channel-adapter), `@app/events` 아웃박스, zod 계약(`packages/event-contracts`), Jest(unit·`describeIfDb` 통합), Medusa 2.13.4 HTTP 통합(`@medusajs/test-utils`, 전제 확인용 스펙 하나).

**Spec:** `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md` — §4.1(그림), §4.3(«반품 예정 기록», «Medusa→core 관측», «고객 이벤트», «K6 수량 사실»), §7(배포 순서), §8 PR 5. 결정 D1·D8·D9. PR 3 계획 N2(core 자격 API 는 청구 빼기 전 사실만 준다)를 깨지 않는다.

## 코드에서 확인한 것 (develop `c8c143b91`)

- **관측 길.** `MedusaOrderSource.buildLifecycleObservations`(`medusa-order.source.ts:257`)가 주문마다 `{ eventType, eventKey, payload, rawEvent }` 를 만든다. 오케스트레이터 `processLifecycleItem`(`order-poller.orchestrator.ts:775`)은 매핑(`wms_order_mappings`)이 있어야 내고, `claimFirstSeen(channel, 'order_lifecycle', '<externalOrderId>:<eventKey>')` 로 처음 본 관측만 같은 트랜잭션에서 아웃박스에 넣는다. 그때 `orderId`(= wmsOrderId)와 채널 키(`salesChannel`·`externalOrderId`)를 붙인다. 관측 타입은 판별 유니온 두 벌이다: `LifecycleObservation`(`channel-order-source.interface.ts:70`)과 `OrderLifecycleEventItem`(`channel-order-provider.interface.ts:83`).
- **증분 수집은 주문 `updated_at $gt since`**(`medusa.client.ts:1921-1938`)이다. `ORDER_FIELDS`(`:198`)에 `returns` 가 없다. 반품 확정·취소는 둘 다 주문 변경을 확정한다(`confirmOrderChange`, `@medusajs/order/dist/services/actions/cancel-return.js:53-66`). 확정하면 주문 `version` 이 오른다(`apply-order-changes.js:60-75`). 그러면 `updated_at` 도 움직일 것으로 보지만, 코드로는 확인하지 못했다. Task 1 이 실측으로 못 박는다.
- **Medusa 반품 행.** `return.status` 는 `open·requested·received·partially_received·canceled`, `requested_at`·`canceled_at` 은 nullable(`@medusajs/order/dist/models/return.js:22-24`)이다. 우리 반품 기록은 `return.metadata.almondReturn`(`ReturnRequestRecord`, `apps/medusa/src/workflows/orders/returns/load-return-order.ts:10-23`)에 있다. 칸은 `requestId`·`requestedBy: 'customer'|'operator'`·`reasonValue`(사유 6종 value)·`feeBearer: 'customer'|'seller'`·`windowOverride: { reason, actorId } | null` 이다. 확정 전에 실패한 반품은 `cancelReturnRequestWorkflow` 로 버린다. 그래서 `requested_at` 이 있는 반품만 «확정된 반품»이다.
- **옛 `OrderReturnRequested`**(`orders.stream.ts:214-231, 397-412, 660, 730`)는 발행자·소비자 0이다. 모양도 안 맞는다: `skuId` 필수, 사유 enum 이 옛 4종(`DEFECTIVE`·`SIZE_NOT_FIT`…). `ORDER_EVENTS.ORDER_RETURN_REQUESTED` 를 읽는 곳도 0이다(`grep -rn ORDER_RETURN_REQUESTED`).
- **계약 검증이 소비 순서를 정한다.** `SchemaValidationInterceptor` 는 전역 interceptor 라 `EventTypeGuard`(핸들러별 타입 필터)보다 먼저 돈다. 그리고 `orders.events.v1` 의 «모든» 메시지를 그 앱이 아는 스키마로 검증한다. 모르는 타입이면 warn 만 하고 통과시킨다(`schema-validation.interceptor.ts:68-73`). 이 토픽을 소비하는 앱은 셋이다: core, analytics(`datasets/orders/ingest/order-events.consumer.ts`), notification.
- **core 소비자**는 `OrderEventsConsumer`(`sales-order/consumers/order-events.consumer.ts`)다. 정산 실패처럼 판매주문 생애가 아닌 사실은 `order_events` 에 적지 않는다(`:305-320`). `order_events.event_type` 이 enum 이라, 적으려면 마이그가 필요하다.
- **고객 이벤트**는 지금 옛 반품 서비스의 private `enqueueClaimProgress`(`store-return-exchange.service.ts:571-614`)가 낸다. 판매주문을 읽어 medusa 주문이고 `customerId` 가 있을 때만 `SalesOrderClaimProgressed` 를 아웃박스에 넣는다. 멱등키는 `so-claim:<kind>:<requestId>:<stage>`. notification 이 `stage`·`requestedBy` 로 메일을 고른다(`order-event.consumer.ts:177-190`).
- **K6 청구 수량.** 청구는 (소포 × SKU) 단위다. 옛 반품·교환 항목은 `shipment_line_id`·`dispatch_attempt_id` 가 둘 다 있어야 센다(`claim-quantities.sql.ts:23-40`). SKU 합(`claimTotalsBySkuSql`)이 `claimable` 을 깎는다(`line-quantities.sql.ts:155-161`). 소포 자격은 `least(소포 수량 − 소포 청구, SKU claimable)`(`parcel-claim-eligibility.sql.ts:36`)이다. 즉 **SKU 합에 들어가면 옛 반품 길도 그 수량을 못 쓴다.** 새 반품 줄은 판매 라인·판매 단위만 안다(Medusa 줄 ↔ `sales_order_lines.channel_order_item_id`). SKU 로 옮기려면 굳은 구성(`sales_order_line_compositions.qty_per_unit`)을 곱한다. 구성이 없는 라인은 이미 `claimable` 이 0 이다(`:155`).
- **`remaining` 은 반품을 빼면 안 된다.** `lineRemainingSql` = 주문 − 취소. 읽는 곳 중 `channel-order-change.reader.ts:59` 는 그 값을 Medusa 줄 수량과 견주어 «채널이 수량을 바꿨나»를 판정한다. Medusa 반품은 `item.quantity` 를 줄이지 않는다. 그래서 `remaining` 이 반품을 빼면 반품 한 번에 주문 변경 판정이 틀어진다. `SalesOrderReturned.remainingQuantity`(계약 주석 «주문 − 취소 전부»)도 같은 값이다. 취소 요청의 상한 검사는 `remainingOf(prior, lineId)` 세 곳(`sales-orders.service.ts:1467` 상자 전 부분, `:1706` 상자 후, `:2121` `planCancellation` 상자 전)이 한다. Medusa 채널 취소(`channel-cancel-request.manager.ts:108,138`)는 `planCancellation` 을 지난다.
- 테이블 본은 `inventory.schema.ts` 다. 판매주문 계열 테이블이 여기 있고 `wmsTables`(`:3789`)에 넣어야 `DbTx` 가 본다. 옛 반품 테이블은 `returnExchangeTables`(`:5325`)라는 따로 묶음이다(PR 10 이 지운다).

## 이름 붙은 결정

- **N1. 새 사실 이름 둘, 옛 `OrderReturnRequested` 는 지운다** — `ChannelReturnRequested`·`ChannelReturnCancelled`. 옛 계약을 고쳐 쓰는 길도 있었다. 그러면 옛 스키마를 가진 소비자 셋(core·analytics·notification)이 새 payload 를 검증하다 throw 한다. 전역 interceptor 가 타입 필터보다 먼저 돌기 때문이다. 그 경우 설계 §7 의 «소비자 선배포»가 필요하다. 새 이름이면 옛 소비자는 warn 하고 통과한다. 그래서 배포 순서 제약이 사라지고, 설계 §8 표의 «소비자 선배포»도 지운다(Task 6). 이름의 `Channel…` 은 같은 토픽의 `ChannelOrderSettlementFailed` 와 같은 축이다(채널이 낸 사실). 철자 `Cancelled` 는 `OrderCancelled` 와 core enum 관례를 따른다. Medusa 칸 `canceled_at` 은 원래 이름 그대로 읽는다.
- **N2. 옛 core 가 새 사실을 «조용히 삼키는» 창은 반품 0건이라 무해하다.** 옛 core 는 모르는 타입을 처리하지 않고 넘긴다(`EventTypeGuard`). 그런데 channel-adapter 는 관측을 한 번만 낸다(`claimFirstSeen`). 그래서 core 가 새 핸들러 없이 그 메시지를 받으면 영영 잃는다. 이 위험은 한 배포 안의 롤링 몇 분뿐이고, 그동안 Medusa 반품은 0건이다. 셀메이트 시기에는 배송완료 수량이 0 이라 요청이 전부 거절되기 때문이다(D9, PR 3). 배포 직전에 라이브 Medusa `return` 행 수를 다시 본다(Merge Danger).
- **N3. 상태 enum 은 설계 §4.3 사다리 전부를 지금 만든다** — `expected·arrived·inspected·held·refund_pending·settled·cancelled`. 이 PR 이 쓰는 전이는 `→ expected` 와 `expected → cancelled` 뿐이다. 그래도 K6 상태 목록(N5)은 enum 칼럼을 문자열 파라미터와 비교한다. 그래서 enum 에 없는 값을 목록에 넣으면 `invalid input value for enum` 이 난다. 값을 PR 6 에서 더하면 PR 6 이 목록 고치기를 잊는 순간 도착한 반품이 청구에서 빠진다. 같은 수량에 두 번 환불이 열린다(반목표).
- **N4. 전이는 함수 하나가 직전 상태 CAS 로 소유한다** — `transitionCustomerReturn`. `update … where id = ? and status in (from) returning`, 0행이면 false. 옛 core 반품의 «읽고 나서 쓰기»를 되풀이하지 않는다(설계 §4.3). PR 6 의 도착·검수 전이가 같은 함수를 쓴다.
- **N5. K6 는 새 기록을 «SKU 합»에만 더한다. 소포 합에는 더하지 않는다.** 새 줄은 소포를 모른다. 그래도 소포 자격이 `least(…, SKU claimable)` 이라, SKU 합에 들어가면 옛 반품 길도 그 수량을 못 쓴다. 진행 중 = `expected·arrived·inspected·held·refund_pending`, 소진 = `settled`. 기존 `return_active`·`return_consumed` 칸에 합친다(소비자 칸 모양 그대로). 옛 반품 테이블 읽기는 PR 10 까지 남는다. 그래서 두 길의 반품이 서로를 뺀다. PR 3 자격 API 는 `delivered` 만 읽으므로 두 번 빠지지 않는다(PR 3 N2).
- **N6. `remaining` 은 그대로 두고, 취소 «상한»만 반품을 뺀다** — 설계 §4.3 «`lineRemainingSql` 도 정산된 반품을 빼게 한다»를 고친다. 이유는 «코드에서 확인한 것»의 `remaining` 항목이다. 대신 `LineQuantities.returnHeld`(취소되지 않은 반품 줄의 판매 단위 합)를 두고, 상한 검사 세 곳이 `remaining − returnHeld` 를 쓴다. **정산 전 반품도 뺀다** — 반품 중인 수량은 PR 3 에서 Medusa 가 이미 부분취소를 거절한다. core 가 먼저 막아야 명령이 나가지 않는다(설계 §4.3 마지막 문장). 도착 전 환불은 취소가 아니라 PR 6 의 «선환불»이다.
- **N7. 반품 하나 = core 기록 하나, 유일키는 Medusa return id.** 같은 관측이 두 번 오면(재전달·replay) `onConflictDoNothing` 으로 기존 기록을 돌려주고 이벤트를 다시 넣지 않는다. 고객 이벤트의 `requestId` 는 core 기록 id(uuid)다. 옛 반품의 `return_requests.id` 와 같은 칸이고 멱등키 모양도 같다.
- **N8. 고객 이벤트는 이 PR 에서 `requested` 하나.** `collected`(도착)·`completed`(정산)와 `SalesOrderReturned` 는 그 전이를 만드는 PR 6 이 낸다. 취소에는 고객 이벤트 단계가 없다(계약 `stage` 3종) — 내지 않는다.
- **N9. 관측하지 않는 반품.** `requested_at` 이 없는 반품(open, 확정 전), `metadata.almondReturn` 이 없거나 모양이 어긋난 반품, 품목이 0인 반품은 관측에서 뺀다. 빼면서 warn 로그를 남긴다. 기본 반품 쓰기 라우트는 PR 2 가 막았으므로, 정상이면 이런 반품은 생기지 않는다.

## Global Constraints

- 사는 곳: `packages/event-contracts`, `apps/channel-adapter`, `apps/core`(테이블 둘 + 마이그 하나), `apps/medusa/integration-tests`(스펙 하나, 코드 변경 없음), 문서(`docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md`, `apps/channel-adapter/CLAUDE.md`).
- 마이그: `npm run db:generate:core -- --name add-customer-returns`. **expand, `migrate → deploy`.** 새 enum 값을 같은 마이그 SQL 안에서 쓰지 않는다(뷰 없음 — PR 4 의 `unsafe use of new value` 함정에 안 걸린다).
- core 레이어: 소비자(@On 핸들러) → `CustomerReturnService`(2~3줄) → `CustomerReturnManager`(검증·쓰기·이벤트). 트랜잭션은 `dbService.run(fn, tx)`, 공개 메서드 마지막 인자 `tx?: DbTx`. `@InjectTypedDb<typeof wmsSchema>()`. `db.query.*`·`any`·`as` 금지. 오류는 `@app/shared` 의 `NotFoundError`·`BadRequestError`·`ConflictError`.
- 계약: 새 payload 의 채널 키(`salesChannel`·`externalOrderId`)는 **필수**다(옛 lifecycle 계약은 #656 이전 메시지 때문에 optional 이었다). 사유 6종 상수 `CUSTOMER_RETURN_REASONS = ['change_of_mind','defective','not_as_described','wrong_item','damaged_in_shipping','other']`. Medusa `RETURN_REASONS` value 와 같은 순서·값이다(`apps/medusa/src/workflows/orders/returns/return-reasons.ts`).
- 관측 키: `return:<returnId>:requested`, `return:<returnId>:cancelled`. 한 주문의 관측 순서는 반품 `requested_at` 오름차순이고, 같은 반품은 requested 가 cancelled 보다 앞이다.
- K6 상태 목록은 `claim-statuses.ts` 에만 둔다(SQL 에 상태 문자열을 다시 쓰지 않는다).
- 게이트:
  - `npm run type-check` 0.
  - `npx jest packages/event-contracts apps/channel-adapter/src/services/order-collection apps/core/src/modules/sales-order` 실패 0. 통합은 skip 된다.
  - core 통합: scratch DB 에 `DATABASE_URL` 주입. 로컬 core DB 는 마이그 이력이 어긋나 공용 러너가 migrate 에서 멈춘다(PR 3·4 와 같다). 대상은 `customer-return`·`line-quantities`·`channel-cancel-request` 디렉터리.
  - `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-observation-fields\.spec'`(postgres·redis 둘 다).

## Review Focus

1. **확정과 취소가 한 폴링 주기에 같이 보인다**(5분 안에 요청 → 취소). 관측이 requested → cancelled 순으로 둘 다 나가고, core 기록은 `cancelled` 로 끝난다. 접수 이벤트는 하나 나간다. Task 3 단위(관측 순서) + Task 5 통합(연달아 기록).
2. **같은 사실이 두 번 온다**(Kafka 재전달·DLQ replay). 기록 1행, `SalesOrderClaimProgressed` 아웃박스 1행. 취소도 두 번째는 no-op 이다. Task 5 통합.
3. **반품이 걸린 수량을 취소한다.** 배송완료 2 중 1개 반품(`expected`)인 줄에 2개 부분취소를 요청하면 `planCancellation`(상자 후 갈래 `planAfterBoxing`)이 `Cancellation quantity 2 exceeds remaining 1` 로 거절한다. 반품을 취소하면 2개가 통과한다. Task 6 통합.
4. **반품 하나가 «채널이 수량을 바꿨다»로 읽히지 않는다.** 반품 기록이 있어도 `readLineQuantities(…).remaining` 은 그대로고, `returnHeld` 만 오른다. Task 6 통합.
5. **세트 상품 반품은 구성품마다 센다.** 구성(A×2, B×1) 1벌 반품이면 A 의 `claimable` 은 2, B 는 1 줄어든다. 옛 반품과 새 반품이 같은 줄에 있으면 둘 다 뺀다. Task 6 통합.

---

### Task 1: 전제 확인 — Medusa 관리자 주문 조회가 반품을 싣고, 반품 확정·취소가 주문 `updated_at` 을 민다

코드 변경 없이 스펙 하나다. 이 스펙이 빨가면 **멈추고 보고한다** — 폴러가 반품을 못 보는 것이라 Task 3 의 설계가 바뀐다.

**Files:**
- Create: `apps/medusa/integration-tests/http/return-observation-fields.spec.ts`

**Interfaces:**
- Consumes: PR 3 의 `requestOrderReturn`·`cancelOrderReturn`, `return-cancel.spec.ts` 의 주문 준비 꼴(`ownedOrder`·반품 옵션·사유 시드). 관리자 헤더는 `return-routes.spec.ts` 의 관리자 호출 꼴을 따른다.

- [ ] **Step 1: 스펙 작성** — `it('반품 확정·취소가 관리자 주문 조회에 보이고 updated_at 을 민다')`:
  - 반품 전 `GET /admin/orders/:id?fields=id,updated_at` 의 `updated_at` 을 `t0` 로 잡는다.
  - 요청(1개, `change_of_mind`)을 확정한다.
  - `GET /admin/orders?fields=<아래>&updated_at[$gt]=<t0>` 에 그 주문이 있다.
  - `returns[0].requested_at` 이 non-null, `returns[0].metadata.almondReturn.requestId` 가 요청 키, `returns[0].items[0]` 이 `{ item_id: <줄 id>, quantity: 1 }`.
  - 그 응답의 `updated_at` 을 `t1` 로 잡는다. 취소한 뒤 `updated_at[$gt]=<t1>` 조회에 그 주문이 다시 있다. `returns[0].status === 'canceled'`, `canceled_at` non-null.
  - fields 는 `id,updated_at,returns.id,returns.status,returns.requested_at,returns.canceled_at,returns.metadata,returns.items.item_id,returns.items.quantity` — Task 3 이 `ORDER_FIELDS` 에 더하는 것과 같은 일곱 칸.
- [ ] **Step 2: 실행** — `scripts/local/run-medusa-integration.sh --testPathPattern 'http/return-observation-fields\.spec'` → PASS. 빨가면 멈추고 응답 본문과 함께 보고한다.
- [ ] **Step 3: Commit** — `test(medusa): 반품 확정·취소가 관리자 주문 조회와 updated_at 에 보이는지 못 박는다 (K8 PR5)`

### Task 2: 계약 — `ChannelReturnRequested`·`ChannelReturnCancelled`, 옛 `OrderReturnRequested` 삭제

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts`
- Test: `packages/event-contracts/streams/orders.stream.spec.ts`

**Interfaces:**
- Produces (모두 `orders.stream.ts` 에서 export):
  - `CUSTOMER_RETURN_REASONS`(Global Constraints 값), `type CustomerReturnReason`.
  - `interface ChannelReturnRequestedPayload { orderId: string; salesChannel: SalesChannel; externalOrderId: string; returnId: string; requestId: string; reason: CustomerReturnReason; feeBearer: 'customer' | 'seller'; requestedBy: 'customer' | 'operator'; windowOverrideReason?: string; requestedAt: string; items: Array<{ channelOrderItemId: string; quantity: number }> }`. 주석: `orderId` 는 channel-adapter 의 wmsOrderId, 정본은 채널 키다(#656). `requestId` 는 Medusa 반품 기록의 멱등 키.
  - `interface ChannelReturnCancelledPayload { orderId: string; salesChannel: SalesChannel; externalOrderId: string; returnId: string; cancelledAt: string }`.
  - `ORDER_STREAM.events` 에 두 이벤트. `OrderReturnRequested`(interface·schema·events 항목)와 `ORDER_EVENTS.ORDER_RETURN_REQUESTED` 는 지운다.

- [ ] **Step 1: 실패하는 테스트** — `describe('ChannelReturnRequested / ChannelReturnCancelled')`:
  - 정상 payload 가 `ORDER_STREAM.events.ChannelReturnRequested.schema.parse` 를 통과한다.
  - `items: []`·`quantity: 0`·`reason: 'SIZE_NOT_FIT'`·`salesChannel` 누락은 각각 throw.
  - `requestedAt`·`cancelledAt` 은 ISO datetime 이 아니면 throw.
  - `ORDER_STREAM.events` 에 `OrderReturnRequested` 키가 없다.
  - 계약에 스키마 접근 꼴이 따로 있으면 기존 spec 의 꼴을 따른다.
- [ ] **Step 2: 실행** — `npx jest packages/event-contracts/streams/orders.stream.spec.ts` → FAIL.
- [ ] **Step 3: 구현** — 스키마는 `z.object`(strict 아님, 이 파일 관례). `items` 는 `.min(1)`, `quantity` 는 `int().positive()`.
- [ ] **Step 4: 실행** — 같은 명령 PASS, `npm run type-check` 0(지운 이름을 읽는 곳이 없음을 확인).
- [ ] **Step 5: Commit** — `feat(event-contracts): 채널 반품 확정·취소 사실, 쓰지 않던 OrderReturnRequested 삭제 (K8 PR5)`

### Task 3: channel-adapter — Medusa 반품을 관측해 `orders.events.v1` 로 낸다

**Files:**
- Create: `apps/channel-adapter/src/services/order-collection/medusa-return-observations.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (`MedusaOrder.returns?`, `ORDER_FIELDS` 일곱 칸 — Task 1 과 같은 목록)
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-order.source.ts` (`buildLifecycleObservations` 끝에 반품 관측을 붙인다, `Logger` 하나)
- Modify: `channel-order-source.interface.ts`·`channel-order-provider.interface.ts` (판별 유니온에 두 가지씩)
- Modify: `order-poller.orchestrator.ts` (`processLifecycleItem` 의 적재 분기 — `if/else` 를 `eventType` 별 분기로)
- Modify: `apps/channel-adapter/src/order-event-routing.ts` (`ORDER_STREAM_EVENT_TYPES` 에 두 타입)
- Modify: `apps/channel-adapter/CLAUDE.md` (§4 «발행하는 Kafka 스트림» 표의 `orders.events.v1` 줄에 두 이벤트)
- Test: `medusa-return-observations.spec.ts`, `order-poller.orchestrator.spec.ts`(케이스 추가)

**Interfaces:**
- Consumes: Task 2 의 두 payload 타입.
- Produces:
  - `export type MedusaReturn = { id?: string; status?: string; requested_at?: string | null; canceled_at?: string | null; metadata?: Record<string, unknown> | null; items?: Array<{ item_id?: string; quantity?: number }> }`. `MedusaOrder.returns?: MedusaReturn[]`.
  - `export function medusaReturnObservations(order: MedusaOrder): { observations: LifecycleObservation[]; skipped: Array<{ returnId: string; reason: 'unconfirmed' | 'no_record' | 'no_items' }> }`. 순수 함수다. source 가 `skipped` 를 warn 으로 남긴다(N9).
  - 관측 payload 는 `Omit<…Payload, 'orderId' | 'salesChannel' | 'externalOrderId'>`. 채널 키는 오케스트레이터가 붙인다(취소·환불과 같다).

- [ ] **Step 1: 실패하는 테스트** — `medusa-return-observations.spec.ts`:
  - `it('확정된 반품 하나 → requested 관측 하나')`: eventKey `return:ret_1:requested`. payload 는 `{ returnId: 'ret_1', requestId, reason: 'change_of_mind', feeBearer: 'customer', requestedBy: 'customer', requestedAt, items: [{ channelOrderItemId: 'item_1', quantity: 1 }] }`.
  - `it('취소된 반품 → requested 다음 cancelled')`: 두 관측, 순서 그대로. 두 번째 payload `{ returnId, cancelledAt: <canceled_at> }`.
  - `it('CS 가 기한을 넘긴 반품은 windowOverrideReason 을 싣는다')`: `requestedBy: 'operator'` → payload `requestedBy: 'operator'`, `windowOverrideReason: '고객 사정'`.
  - `it('requested_at 이 없는 반품·almondReturn 이 없거나 사유가 6종 밖인 반품·품목 0 반품은 관측하지 않고 skipped 에 이유를 남긴다')`: 각각 `unconfirmed`·`no_record`·`no_items`.
  - `it('반품이 여럿이면 requested_at 오름차순')`.
  - `it('returns 칸이 없는 옛 응답 → 관측 0, skipped 0')`.
- [ ] **Step 2: 실패하는 테스트** — `order-poller.orchestrator.spec.ts` 에 두 케이스. 기존 취소·환불 적재 케이스와 같은 꼴이다.
  - `ChannelReturnRequested` 관측 → `enqueue({ eventType: 'ChannelReturnRequested', payload: { orderId: <wmsOrderId>, salesChannel: 'medusa', externalOrderId, …관측 payload } })`.
  - 같은 관측을 두 번 처리하면 enqueue 는 한 번(`claimFirstSeen`).
  - `ChannelReturnCancelled` 도 같은 꼴.
- [ ] **Step 3: 실행** — `npx jest apps/channel-adapter/src/services/order-collection` → 새 케이스 FAIL.
- [ ] **Step 4: 구현** — 위 Files 대로. `ORDER_FIELDS` 변경은 해시 입력(`changes`)을 바꾸지 않는다. `raw` 만 커진다. 기존 `medusa-order-collection.spec.ts` 의 해시 고정 케이스가 그대로 초록인지로 확인한다.
- [ ] **Step 5: 실행** — 같은 명령 PASS, `npm run type-check` 0.
- [ ] **Step 6: Commit** — `feat(channel-adapter): Medusa 반품 확정·취소를 관측해 orders.events.v1 로 낸다 (K8 PR5)`

### Task 4: core 스키마 — `customer_returns`·`customer_return_lines` + 마이그

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`salesOrderLines` 정의 뒤, `wmsTables` 에 둘, 타입 export)
- Create: `apps/core/drizzle/<timestamp>_add-customer-returns.sql` + `drizzle/meta/` (생성물)
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return.types.ts`
- Test: `apps/core/src/modules/sales-order/customer-return/customer-return.types.spec.ts`

**Interfaces:**
- Produces:
  - `customerReturnStatusEnum = pgEnum('customer_return_status', ['expected','arrived','inspected','held','refund_pending','settled','cancelled'])` (N3).
  - `customerReturnReasonEnum = pgEnum('customer_return_reason', [6종])`. 스키마 파일은 `@packages` 를 import 하지 않으므로 값을 손으로 쓴다. 일치는 테스트가 지킨다.
  - `customerReturns` 칸:

    | 칸 | 타입 · 제약 |
    | --- | --- |
    | `id` | uuid pk defaultRandom |
    | `salesOrderId` | uuid FK `salesOrders.id` restrict, notNull |
    | `channelReturnId` | varchar(255) notNull, **unique** `uq_customer_returns_channel_return` |
    | `channelRequestId` | varchar(255) notNull |
    | `status` | enum, default `'expected'` |
    | `reason` | reason enum, notNull |
    | `feeBearer` | varchar(16) notNull, check `in ('customer','seller')` |
    | `requestedBy` | varchar(16) notNull, check `in ('customer','operator')` |
    | `windowOverrideReason` | text, null |
    | `requestedAt` | timestamptz notNull |
    | `cancelledAt` | timestamptz, null |
    | `createdAt` · `updatedAt` | timestamptz defaultNow |

    인덱스는 `idx_customer_returns_sales_order`.
  - `customerReturnLines` 칸:

    | 칸 | 타입 · 제약 |
    | --- | --- |
    | `id` | uuid pk |
    | `customerReturnId` | uuid FK cascade, notNull |
    | `salesOrderLineId` | uuid FK `salesOrderLines.id` restrict, notNull |
    | `channelOrderItemId` | varchar(255) notNull |
    | `quantity` | integer notNull, check `> 0` |

    unique `(customer_return_id, sales_order_line_id)`, 인덱스 `idx_customer_return_lines_sales_order_line`.
  - `customer-return.types.ts`: `type CustomerReturnStatus = (typeof customerReturnStatusEnum.enumValues)[number]`, `type CustomerReturn = InferSelectModel<typeof customerReturns>`, `type CustomerReturnLine`.

- [ ] **Step 1: 실패하는 테스트** — `customer-return.types.spec.ts`:
  - `customerReturnReasonEnum.enumValues` 가 `CUSTOMER_RETURN_REASONS` 와 같다.
  - `customerReturnStatusEnum.enumValues` 가 N3 의 일곱 값과 같은 순서다.
- [ ] **Step 2: 실행** — `npx jest apps/core/src/modules/sales-order/customer-return/customer-return.types.spec.ts` → FAIL.
- [ ] **Step 3: 스키마 작성 → `npm run db:generate:core -- --name add-customer-returns`** — 생성 SQL 을 읽고 확인한다:
  - `CREATE TYPE` 둘·`CREATE TABLE` 둘·FK·check·unique 만 있다.
  - 다른 테이블의 `ALTER`/`DROP` 이 섞여 있으면 스키마 드리프트다. `git rm` 하고 원인을 보고한다.
- [ ] **Step 4: 빈 DB 부트스트랩** — scratch DB 에 `DATABASE_URL` 을 주고 `npx drizzle-kit migrate --config apps/core/drizzle.config.ts` → `migrations applied successfully`.
- [ ] **Step 5: 실행** — Step 2 PASS, `npm run type-check` 0.
- [ ] **Step 6: Commit** — 스키마 + SQL + meta 한 커밋(CLAUDE.md «Daily cycle» 5번): `feat(core): 반품 예정 기록 테이블 customer_returns·lines (K8 PR5)`

### Task 5: core — 사실을 받아 기록하고 «반품 접수» 고객 이벤트를 낸다

**Files:**
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return-transition.ts`
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return.manager.ts`
- Create: `apps/core/src/modules/sales-order/customer-return/customer-return.service.ts`
- Create: `apps/core/src/modules/sales-order/common/claim-progress.ts` (옛 서비스의 `enqueueClaimProgress` 본문을 옮긴다)
- Modify: `apps/core/src/modules/sales-order/services/store-return-exchange.service.ts` (private 메서드가 새 함수를 부른다 — 동작 그대로)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` (핸들러 둘)
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts` (providers 둘)
- Test: `customer-return.manager.integration.spec.ts`(`describeIfDb`), `order-events.consumer` 기존 spec 이 있으면 위임 케이스 추가

**Interfaces:**
- Consumes: Task 2 payload, Task 4 테이블·타입.
- Produces:
  - `transitionCustomerReturn(trx: DbTx, p: { id: string; from: readonly CustomerReturnStatus[]; to: CustomerReturnStatus; set?: Partial<Pick<CustomerReturn, 'cancelledAt'>> }): Promise<boolean>`. `updatedAt` 도 같이 쓴다. PR 6 이 `set` 의 Pick 을 넓힌다.
  - `enqueueSalesOrderClaimProgress(publisher: PublisherFor<typeof CORE_ORDER_STREAM>, tx: DbTx, claim: Pick<SalesOrderClaimProgressedPayload, 'kind' | 'stage' | 'requestId' | 'requestedBy'> & { salesOrderId: string; occurredAt: Date }): Promise<void>`. 옛 본문 그대로다(medusa·customerId 없으면 건너뜀, 멱등키 `so-claim:<kind>:<requestId>:<stage>`).
  - `CustomerReturnManager.recordRequested(fact: ChannelReturnRequestedPayload, tx?: DbTx): Promise<{ customerReturnId: string; created: boolean }>`.
  - `CustomerReturnManager.recordCancelled(fact: ChannelReturnCancelledPayload, tx?: DbTx): Promise<{ customerReturnId: string; changed: boolean }>`.
  - `CustomerReturnService` 는 같은 이름 둘을 위임한다.
- 규칙(manager):
  - **판매주문:** `sales_orders(sales_channel, channel_order_id) = (fact.salesChannel, fact.externalOrderId)` 를 manager 의 private 조회로 찾는다(`SalesOrdersService` 에 기대지 않는다). 없으면 `NotFoundError`.
  - **줄:** 줄마다 `sales_order_lines(sales_order_id, channel_order_item_id)` 로 푼다. 못 풀거나 `quantity > line.quantity` 면 `BadRequestError`(어느 줄인지 문장에).
  - **기록:** 기록 insert 는 `onConflictDoNothing({ target: channelReturnId })`. 0행이면 기존 id 를 읽어 `{ created: false }` 를 돌려주고, 줄·이벤트를 쓰지 않는다(N7). 새로 만들었으면 줄을 넣고 `enqueueSalesOrderClaimProgress({ kind: 'return', stage: 'requested', requestId: <기록 id>, requestedBy: fact.requestedBy === 'operator' ? 'admin' : 'customer', occurredAt: new Date(fact.requestedAt) })` 까지 한 트랜잭션에서 한다.
  - **취소:** 기록이 없으면 `NotFoundError`(requested 가 먼저 온다 — 같은 파티션 키·같은 폴링 순서). 이미 `cancelled` 면 `{ changed: false }`. 그 밖에는 `transitionCustomerReturn(from ['expected'], to 'cancelled', set { cancelledAt })`. false 면 `ConflictError`(`expected` 가 아닌 반품의 취소 — Medusa 와 core 가 어긋났다. DLQ 에 남겨 사람이 본다).
- 소비자: `@On(ORDER_STREAM, 'ChannelReturnRequested')`·`@On(ORDER_STREAM, 'ChannelReturnCancelled')`, `@RetryPolicy({ nonRetryableErrors: [NotFoundError, BadRequestError] })`. 로그 한 줄 뒤 서비스로 위임한다. `order_events` 에 적지 않는다(정산 실패 핸들러와 같은 이유).

- [ ] **Step 1: 실패하는 통합 테스트** — `customer-return.manager.integration.spec.ts`. 판매주문·줄은 기존 `__support__` 픽스처로 만든다(`channel_order_item_id` 세팅).
  - `it('requested → expected 기록 1 + 줄 + 접수 이벤트 1')`: 아웃박스 `SalesOrderClaimProgressed` payload 의 `stage 'requested'`·`requestId = 기록 id`·`requestedBy 'customer'`.
  - `it('같은 사실 두 번 → 기록 1·줄 1·이벤트 1, 두 번째 created false')`.
  - `it('operator 접수는 requestedBy admin, windowOverrideReason 저장')`.
  - `it('모르는 Medusa 줄 → BadRequestError, 아무것도 안 씀')`, `it('모르는 주문 → NotFoundError')`.
  - `it('cancelled → status cancelled·cancelledAt, 두 번째는 changed false')`.
  - `it('requested 직후 cancelled(Review Focus 1) → cancelled, 접수 이벤트 1')`.
  - `it('arrived 인 기록의 cancelled → ConflictError, 상태 그대로')`. 픽스처가 status 를 직접 `arrived` 로 쓴다.
- [ ] **Step 2: 실행** — `DATABASE_URL=<scratch> npx jest apps/core/src/modules/sales-order/customer-return` → FAIL.
- [ ] **Step 3: 구현** — 위 Files 대로. 옛 서비스는 `enqueueClaimProgress` 안에서 새 함수만 부른다. 그래서 옛 반품 통합 스펙이 동작 그대로임을 지킨다.
- [ ] **Step 4: 실행** — Step 2 PASS. 옛 반품 이벤트 스펙(`grep -rln "SalesOrderClaimProgressed" apps/core/src --include=*.spec.ts`)도 PASS. `npx jest apps/core/src/modules/sales-order` 실패 0, `npm run type-check` 0.
- [ ] **Step 5: Commit** — `feat(core): 채널 반품 확정·취소를 반품 예정 기록으로, 접수 고객 이벤트는 새 기록에서 (K8 PR5)`

### Task 6: core K6 — 새 기록을 청구 수량과 취소 상한에 잇는다 + 설계 문서 고치기

**Files:**
- Modify: `apps/core/src/modules/sales-order/line-quantities/claim-statuses.ts` (목록 둘)
- Modify: `apps/core/src/modules/sales-order/line-quantities/claim-quantities.sql.ts` (`claimTotalsBySkuSql` 에 새 갈래 — 소포 합은 그대로, N5)
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantities.sql.ts` (`lineReturnHeldSql`)
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantities.reader.ts` (`LineQuantities.returnHeld`)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`PriorCancellationContext.cancelableByLine`, `cancelableOf`, 상한 검사 세 곳)
- Modify: `apps/core/src/modules/sales-order/line-quantities/__support__/claim-facts.fixtures.ts` (`insertCustomerReturn` 헬퍼)
- Modify: `docs/superpowers/specs/2026-10-26-k8-returns-on-medusa-design.md`
- Test: `claim-facts.integration.spec.ts`, `line-quantities.integration.spec.ts`, `channel-cancel-request/cancellation-plan.integration.spec.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 4 테이블·`CustomerReturnStatus`.
- Produces:
  - `CUSTOMER_RETURN_ACTIVE_STATUSES = ['expected','arrived','inspected','held','refund_pending'] as const satisfies readonly CustomerReturnStatus[]`.
  - `CUSTOMER_RETURN_CONSUMED_STATUSES = ['settled'] as const satisfies …`. 주석: 둘의 합집합이 «취소되지 않은 반품»이다.
  - SKU 합 새 갈래: (반품 줄 × `sales_order_line_compositions`) 를 `composition.sales_order_line_id = line.sales_order_line_id` 로 잇는다. `return_active`/`return_consumed` = `line.quantity * composition.qty_per_unit`(상태별), `exchange_active` 0. 옛 갈래 합과 `union all` 한 뒤 (라인, SKU) 로 합한다. 별칭·`::int` 규칙은 파일 머리 주석대로.
  - `lineReturnHeldSql(salesOrderLineId: SQLWrapper): SQL<number>`. 취소되지 않은 반품 줄 수량 합(판매 단위), 없으면 0. `lineCanceledQuantitySql` 처럼 칼럼 이름을 바꾼 파생 테이블로 감싼다(그 함수 주석의 바깥 참조 함정).
  - `LineQuantities.returnHeld: number`. 주석: «반품이 잡은 판매 단위 — 취소 상한에서만 뺀다. `remaining` 은 반품을 모른다(N6)».
  - `cancelableOf(prior: PriorCancellationContext, salesOrderLineId: string): number` = `remaining − returnHeld`. `remainingOf` 와 같은 «없으면 throw». `:1467`·`:1706`·`:2121` 의 상한 검사만 이것으로 바꾼다. 메시지 숫자도 이 값이다. `:1481`·`:1685`·`:2089`·`leavesNothing` 은 그대로 둔다(전체취소 몫·«남는 것 없음» 판정은 반품과 무관하게 주문 − 취소로 센다).

- [ ] **Step 1: 실패하는 통합 테스트**
  - `claim-facts.integration.spec.ts` 의 SKU 층 describe:
    - `it('expected customer return reduces claimable, cancelled does not')`.
    - `it('settled customer return counts as consumed')`.
    - `it('customer return on a set line reduces each component by qty_per_unit')`: A×2·B×1 구성, 1벌 반품 → A claimable −2, B −1.
    - `it('old and customer returns on one line both reduce claimable')`.
    - 소포 describe: `it('customer return caps parcel claimable through the sku pool')` — 소포 2, 새 반품 1 → 소포 claimable 1, `claimTotalsByParcelSql` 의 claimed 는 0.
  - `line-quantities.integration.spec.ts`: `it('customer return raises returnHeld and leaves remaining unchanged')` — Review Focus 4. `cancelled` 반품은 `returnHeld` 0.
  - `cancellation-plan.integration.spec.ts`: `it('상자 후 부분 — 반품이 잡은 수량은 취소 상한에서 빠진다')` — Review Focus 3. 배송완료 2, `expected` 반품 1 → `planCancellation(lines qty 2)` 가 `BadRequestException('Cancellation quantity 2 exceeds remaining 1')` 을 던진다(상자 후 갈래 `:1706` 의 기존 문구). 반품을 `cancelled` 로 바꾼 뒤엔 같은 요청이 계획을 돌려준다.
- [ ] **Step 2: 실행** — `DATABASE_URL=<scratch> npx jest apps/core/src/modules/sales-order/line-quantities apps/core/src/modules/sales-order/channel-cancel-request` → 새 케이스 FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces 대로. `LineQuantities` 를 손으로 만드는 spec 픽스처가 type-check 에서 빨개지면 `returnHeld: 0` 을 더한다.
- [ ] **Step 4: 실행** — Step 2 PASS. `npx jest apps/core/src/modules/sales-order apps/core/src/modules/print-order` 실패 0(가드 `line-quantity-read.guard.spec.ts` 포함). `npm run type-check` 0. core 통합 `sales-order` 전체를 scratch DB 로 돌려 develop 대비 새 실패 0(PR 4 가 적은 기존 실패 2건은 inventory 쪽).
- [ ] **Step 5: 설계 문서 고치기** — §4.3 끝에 «**PR 5 에서 확정한 결과.**» 블록을 더한다. N1(새 사실 이름·옛 계약 삭제·소비자 선배포 불필요), N3(enum 사다리 전부), N5(SKU 합만), N6(`remaining` 은 그대로, 취소 상한만 — 같은 절의 «`lineRemainingSql` 도…» 문장을 이 결과로 고친다), N8(이 PR 은 `requested` 만)을 한 줄씩 적는다. §4.1 그림의 이벤트 이름을 `ChannelReturnRequested` 로, §8 표 PR 5 비고 «소비자 선배포»를 «expand(`migrate → deploy`), 배포 순서 제약 없음 — N1·N2»로 고친다.
- [ ] **Step 6: Commit** — `feat(core): K6 청구 수량과 취소 상한이 반품 예정 기록을 센다, 설계에 PR5 결과 (K8 PR5)`

---

## Merge Danger (PR 본문용 메모)

- **배포:** expand, `migrate → deploy`(테이블 둘·enum 둘). 이벤트 순서 제약은 없다(N1). 옛 core 가 롤링 중 새 사실을 삼키는 창은 반품 0건이라 무해하다(N2). 배포 직전 라이브 Medusa `select count(*) from "return"` 이 0 인지 본다(PR 2 의 배포 전 집계와 같은 자리).
- **동작 변경:** core 취소 상한이 반품이 잡은 수량을 뺀다. 라이브 반품 0건이라 지금 바뀌는 주문은 없다.
- **롤백:** 이전 task definition 으로 돌려도 안전하다. 옛 코드는 새 테이블을 안 읽고, 새 사실은 warn 으로 넘긴다. 남는 테이블은 비어 있다.
