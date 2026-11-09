# 마켓 고객 취소요청 승인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 수집된 네이버·쿠팡 주문에 고객 취소요청이 붙으면 core 가 그 자리에서 멈출 수 있는 줄을 취소하고, 멈췄으면 channel-adapter 가 마켓에 승인을 보낸다.

**Architecture:** channel-adapter 가 수집 중 취소요청을 새 사실 `ChannelCancelRequested` 로 낸다. core 취소 커널의 새 문이 고객 취소와 같은 판정으로 줄을 취소하고, 기존 채널 취소 요청 행(`sales_order_amendments`, `settling`)과 `CancelChannelOrder` 명령(새 칸 `answers`)을 같은 트랜잭션에 남긴다. channel-adapter 가 그 명령으로 마켓 승인 API 를 부르고, 승인 뒤 수집된 줄 취소는 core 가 «누적 수량 상태»로 받아 no-op 으로 넘긴다.

**Tech Stack:** NestJS · Drizzle · Kafka(`@app/events`, outbox) · zod 이벤트 계약(`packages/event-contracts`) · Jest

**Spec:** `docs/superpowers/specs/2026-11-10-market-cancel-request-approval-design.md`

## Global Constraints

- 레이어·트랜잭션 규칙은 루트 `CLAUDE.md` 그대로 — `DbService.run(fn, tx)`, public 메서드는 `tx?: DbTx` 마지막 인자, `any`/`as` 금지(근거 주석 없이는).
- core 는 직접 발행하지 않는다 — 명령은 `this.commands.enqueue` (outbox). 취소 순서는 커널(`order-cancellation.ts`) 밖에서 조립하지 않는다(ADR-0049).
- 이벤트 계약 변경은 **소비자 먼저 배포**. 이 계획은 core·channel-adapter 를 같은 배포에 싣는다 — 네이버 채널이 라이브에서 꺼져 있어 새 사실이 나갈 일이 없으므로 안전하다. 네이버를 켜기 전에 둘 다 배포돼 있어야 한다.
- 돈을 건드리지 않는다. core·channel-adapter 모두 wallet 을 부르지 않는다. 마켓 요청 행에서 [계좌 송금으로 환불]은 거절한다.
- 승인 실행은 **관찰 모드 기본**: channel-adapter env `CHANNEL_CANCEL_APPROVAL_MODE` — 값 `observe`(기본·미설정) | `act`.
- 공개 레포 — 실주문 번호·테넌트 값을 코드·픽스처·커밋에 적지 않는다. 픽스처 id 는 `po-1`·`ord-1` 꼴.
- 검증 게이트: `npm run type-check` 0, `npx jest --maxWorkers=3` 실패 0. core 통합 스펙은 `npm run test:core:integration:local`.

## 스펙과 다르게 정한 것 (리뷰 때 확인)

- **«못 멈춤»은 행을 남기지 않는다(스펙 §5.2·§5.3a 대체).** 네이버는 우리 발송처리가 곧 거부이고, 쿠팡은 «자동처리(이미출고)»가 있어 사람이 닫을 일이 거의 없다. 인쇄 제작 중은 인쇄 gate 가 거절을 기존 인쇄 보드에 남긴다(`keepOnRefusal` 없이 부른다). 그 밖의 «못 멈춤»은 warn 로그로만 남는다. 그래서 «못 멈춤 행을 닫는 관측»(스펙 §5.3a 앞 세 줄)은 만들지 않는다 — 닫을 행이 없다.
- **승인 관찰 모드는 «영구 실패»로 끝낸다.** `observe` 면 channel-adapter 가 `failureCode: 'approval_observe_mode'`, `retryable: false` 로 정산 실패 사실을 낸다 → 요청 행 `refused` → 기존 정산 화면에 «판매자센터에서 승인 필요». 리컨실러가 관찰 모드에서 같은 명령을 계속 재발행하지 않게 하기 위해서다.
- 사실·명령 모양(스펙 §8 빌더 몫): 새 사실 `ChannelCancelRequested`, 명령은 새로 두지 않고 `CancelChannelOrder` 에 `answers` 칸을 더한다 — 재발행·실패 사실·정산 화면이 `meta.request.command` 하나로 돈다.
- 쿠팡: 승인 실행부(`stoppedShipment`)와 능력 축까지만. 쿠팡 관측은 #1245 의 source 가 이 계획의 `ChannelCancelRequested` 를 낸다.

## Review Focus

1. **한 주문의 여러 상품주문을 따로 요청** — 각 요청이 한 번씩 core 취소·명령 하나가 되고, 전부 끝나면 `naver-order.source.ts` 가 «전 라인 취소 → full `OrderCancelled`» 를 낸다. 이미 줄마다 다 취소된 주문의 full 취소가 no-op 이어야 한다 → Task 3 테스트 `full OrderCancelled after every line was cancelled line-by-line is a no-op`.
2. **같은 요청의 재관측** (폴링이 같은 클레임을 다시 봄, Kafka 재배달) — 판매주문 취소·명령이 두 번 생기면 안 된다 → Task 4 테스트 `same channelRequestRef twice yields one amendment row and one command`.
3. **이미 core 에 판매주문이 생기기 전의 요청** (컷오버 직전 1시간 주문) — no-op, 실패 아님 → Task 4 테스트 `request for an order core does not have is ignored`.
4. **수집된 주문이 나중에 `paymentState: 'pending'` 이 되는 것** (클레임이 붙은 순간 `resolvePaymentState` 가 pending 을 낸다) — 이미 있는 판매주문이 격리·수정으로 잘못 가면 안 된다 → Task 5 테스트 `collected order that gains a cancel claim emits ChannelCancelRequested and is not quarantined`.
5. **마켓이 «이미 승인됨»으로 답함** (사람이 판매자센터에서 먼저 누름) — 실패가 아니라 성공 → Task 6 테스트 `naver already-approved response counts as success`.

---

### Task 1: 이벤트 계약 — `ChannelCancelRequested` 사실 · `CancelChannelOrder.answers` · 줄 취소 수량의 뜻

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts` (페이로드 인터페이스 근처 `ChannelReturnRequestedPayload` 옆, zod 스키마 근처 `ChannelReturnRequestedSchema` 옆, 레지스트리 `ChannelReturnRequested: event<…>` 옆)
- Modify: `packages/event-contracts/streams/channel-orders-command.stream.ts` (`CancelChannelOrderPayload`, `CancelChannelOrderSchema`)
- Modify: `apps/channel-adapter/src/order-event-routing.ts` (발행 목록에 새 이벤트)
- Test: `packages/event-contracts/streams/orders.stream.spec.ts`, 같은 폴더에 `channel-orders-command.stream.spec.ts` 가 없으면 생성

**Interfaces:**
- Produces:
  ```ts
  export interface ChannelCancelRequestedPayload {
    orderId: string;                 // channel-adapter wmsOrderId (ChannelReturnRequested 와 같은 축)
    salesChannel: SalesChannel;
    externalOrderId: string;
    /** 마켓의 승인 단위 참조. core 는 해석하지 않는다. 네이버=productOrderId, 쿠팡=receiptId */
    channelRequestRef: string;
    /** 마켓이 판매자 승인을 기다리는가. false = 이미 승인돼 처리 중(네이버 CANCELING 등) */
    needsApproval: boolean;
    requestedAt: string;             // ISO 8601
    items: Array<{ channelOrderItemId: string; quantity: number }>; // quantity = 이번 요청 수량, 양수
  }
  // CancelChannelOrderPayload 에 추가
  answers?: { channelRequestRef: string; needsApproval: boolean };
  requestedBy: 'operator' | 'customer' | 'wallet-refund-approval' | 'channel-customer';
  ```
- `OrderCancelledPayload.cancelledLines[].quantity` 의 주석을 «그 줄의 채널 누적 취소 수량(상태)»으로 고친다. 타입은 그대로. 이 칸을 내는 곳은 `naver-order.source.ts` 하나뿐이고 네이버는 라이브에서 돈 적이 없다(스펙 §1).

- [ ] **Step 1: 실패하는 계약 테스트 작성** — `ChannelCancelRequested` 가 위 페이로드를 통과하고, `items` 가 비었거나 `quantity <= 0` 이거나 `channelRequestRef` 가 빈 문자열이면 거절. `CancelChannelOrder` 가 `answers` 있는/없는 페이로드 둘 다 통과하고 `requestedBy: 'channel-customer'` 를 받는다. 테넌트 계약 스펙(`event-tenancy.spec.ts`)이 새 이벤트를 테넌트 이벤트로 본다.
- [ ] **Step 2: 실패 확인** — `npx jest packages/event-contracts/streams` → 새 테스트 FAIL
- [ ] **Step 3: 계약 구현** — 위 Interfaces 그대로. `order-event-routing.ts` 목록에 `'ChannelCancelRequested'`.
- [ ] **Step 4: 통과 확인** — `npx jest packages/event-contracts/streams apps/channel-adapter/src/order-event-routing` → PASS, `npm run type-check` → 0
- [ ] **Step 5: 커밋** — `git commit -m "feat(event-contracts): 마켓 고객 취소요청 사실과 CancelChannelOrder.answers"`

### Task 2: 채널 능력 축 — «고객 취소요청에 승인을 보낼 수 있다»

**Files:**
- Modify: `apps/core/src/modules/sales-order/order-cancellation/channel-cancellation-capability.ts`
- Modify: `apps/channel-adapter/src/services/channel-capabilities.ts` (`FulfillmentCapability`)
- Test: `apps/core/src/modules/sales-order/order-cancellation/channel-cancellation-capability.parity.spec.ts`, `channel-cancellation-capability.spec.ts`

**Interfaces:**
- Produces: core `ChannelCancellationCapability.answersCustomerCancelRequest: boolean` — `naver: true`, `coupang: true`, `medusa: false`, `'3pl': false`. channel-adapter `FulfillmentCapability.approvesCustomerCancelRequest: boolean` — 같은 값(`3pl` 은 `integration: 'none'` 의 fulfillment 에 `false`).

- [ ] **Step 1: parity 테스트 확장** — 모든 채널에서 `answersCustomerCancelRequest === getChannelFulfillmentCapabilities(ch).approvesCustomerCancelRequest`. 기존 `cancel === 'command' ⇔ automatedCancellation` 단언은 그대로.
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/order-cancellation/channel-cancellation-capability` → FAIL(칸 없음)
- [ ] **Step 3: 두 표에 칸 추가**
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run type-check` 0
- [ ] **Step 5: 커밋** — `feat: 채널 능력에 고객 취소요청 승인 축`

### Task 3: core — 채널 줄 취소를 «누적 수량 상태»로 받고, 마켓 요청 행을 닫는다

**Files:**
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts` (`cancelForChannel`)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (줄별 이미 취소된 수량을 읽는 public 메서드 — 기존 private `loadPriorCancellationContext`·`cancelableOf` 를 재사용)
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settler.ts`
- Test: `apps/core/src/modules/sales-order/order-cancellation/market-channel-cancellation.integration.spec.ts` (생성, `describeIfDb`), 필요하면 `order-cancellation.spec.ts`

**Interfaces:**
- Produces:
  - `SalesOrdersService.cancelledQuantities(salesOrderId: string, lineIds: string[], tx: DbTx): Promise<Map<string, number>>` — 줄별 지금까지 취소된 수량.
  - `ChannelCancelSettler.settleLinesCancelled(salesOrderId: string, channelLines: Array<{ channelOrderItemId: string; quantity: number }>, tx: DbTx): Promise<number>` — `requestedBy` 가 `channel-customer:` 로 시작하는 `settling` 요청 행 중, 행의 모든 줄이 채널 누적 취소 수량으로 덮인 행을 `applied` 로. 닫은 행 수를 돌려준다.
- `cancelForChannel` 의 새 규칙(부분, `lines` 있음): 각 줄 목표 = 채널 누적 수량, 실제 취소 = `목표 − 이미 취소`(0 이하면 그 줄 생략). 전부 생략이면 `salesOrders.cancel` 을 부르지 않는다. 그 뒤 항상 `settleLinesCancelled`. 전체(`lines` 없음): 판매주문의 모든 줄이 이미 전량 취소돼 있으면 `salesOrders.cancel` 을 부르지 않고 `settleCancelled` + `settleLinesCancelled`(전 줄).

- [ ] **Step 1: 실패하는 통합 테스트 작성** (네이버 판매주문 픽스처, 줄 A qty 3·줄 B qty 2)
  - `line cancel arriving after core already cancelled the same quantity is a no-op` — core 가 A 3 취소 → `OrderCancelled{cancelledLines:[{A,3}]}` → 예외 없음, A 취소 합계 3 그대로.
  - `line cancel with a larger cumulative quantity cancels only the difference` — core 가 A 1 취소 → 채널 A 누적 3 → A 취소 합계 3.
  - `full OrderCancelled after every line was cancelled line-by-line is a no-op` — A 3·B 2 각각 취소 → full `OrderCancelled` → 예외 없음, 취소 행 수 변화 없음.
  - `market request row closes when the collected cancel covers it` — 마켓 요청 행(settling, A 3) → `OrderCancelled{[{A,3}]}` → 행 `applied`.
  - `market OrderCancelled on a shipped line does not throw` — A 출고 완료 → `OrderCancelled{[{A,3}]}` → 컨슈머 핸들러가 던지지 않는다(출고 뒤 후속 효과로 남는다). 던진다면 이 태스크에서 막는다(스펙 반목표 «DLQ»).
- [ ] **Step 2: 실패 확인** — `npm run test:core:integration:local -- market-channel-cancellation` → 첫 테스트 400 `cancelQuantityExceeds` 로 FAIL (스펙은 `channel-cancel-request.integration.spec.ts` 처럼 `DATABASE_URL` 기반 `describeIfDb`·rollback-only 로 쓴다)
- [ ] **Step 3: 구현** — 위 규칙. `cancelForChannel` 의 «줄 단위 취소(마켓)는 요청과 무관» 주석·분기를 고친다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx jest apps/core/src/modules/sales-order --maxWorkers=3` PASS
- [ ] **Step 5: 커밋** — `feat(core): 채널 줄 취소를 누적 수량 상태로 받고 마켓 요청 행을 닫는다`

### Task 4: core — 고객 취소요청 문 (판정 → 취소 → 요청 행 + 승인 명령)

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts` (`CancelRequester` 에 `{ kind: 'channel-customer'; channelRequestRef: string; needsApproval: boolean }`)
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts` (`request` 의 route 판정·`requesterLabel`·`cancelledByOf`·명령 조립·`switchToManualRefund` 거절)
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts` (새 문)
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.types.ts`
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` (`@On(ORDER_STREAM, 'ChannelCancelRequested')`)
- Test: `apps/core/src/modules/sales-order/order-cancellation/market-cancel-request.integration.spec.ts` (생성, `describeIfDb`)

**Interfaces:**
- Consumes: Task 1 `ChannelCancelRequestedPayload`, Task 2 `answersCustomerCancelRequest`, Task 3 settler.
- Produces:
  ```ts
  // order-cancellation.types.ts
  export type ChannelCustomerCancelRequest = {
    salesChannel: SalesChannelName; externalOrderId: string;
    channelRequestRef: string; needsApproval: boolean;
    items: Array<{ channelOrderItemId: string; quantity: number }>;
  };
  export type ChannelCustomerCancelOutcome =
    | { kind: 'stopped'; view: CancelRequestView }
    | { kind: 'replayed'; view: CancelRequestView }
    | { kind: 'not_stoppable'; reason: string }
    | { kind: 'order_unknown' };
  // OrderCancellation
  receiveChannelCustomerRequest(req: ChannelCustomerCancelRequest): Promise<ChannelCustomerCancelOutcome>;
  ```
- 규칙:
  - 판매주문을 채널 키로 찾고 없으면 `order_unknown`(로그만).
  - `answersCustomerCancelRequest` 가 false 인 채널이면 던진다(계약 위반 — 버그).
  - `sourceKey = 'channel-request:' + channelRequestRef`. 같은 키의 행이 있으면 `replayed`.
  - 채널 줄 번호 → 판매주문 줄 해석, 못 찾은 줄이 있으면 `not_stoppable`.
  - 판정은 `operatorGate` 와 같은 순서(`cancelRequests.precheck` → 인쇄 gate `cancelForOrder(id,'gate',lines)` — `keepOnRefusal` 없이, 거절은 인쇄 보드에 남는다) → `cancelRequests.request({ requester: channel-customer, lines, sourceKey })`.
  - `isDomainRefusal(error)` 또는 인쇄 거절이면 `not_stoppable`(warn 로그, 행·명령 없음). 그 밖의 예외는 던진다.
  - `request()` 의 route 판정: `route === 'seller_center'` 이어도 requester 가 `channel-customer` 이고 `answersCustomerCancelRequest` 면 통과. 명령에 `answers: { channelRequestRef, needsApproval }`, `requestedBy: 'channel-customer'`, `refundMode: 'auto'`.
  - `requesterLabel` = `channel-customer:<ref>`, `cancelledByOf` = 채널 이름.
  - `switchToManualRefund`: 요청 행의 `requestedBy` 가 `channel-customer:` 면 `BadRequestError('마켓 주문의 환불은 마켓이 합니다 — 판매자센터에서 처리하세요.')`.
  - 컨슈머: `@RetryPolicy({ nonRetryableErrors: [NotFoundError, BadRequestError] })`, order_events 에 적지 않는다(`ChannelReturnRequested` 와 같은 이유).

- [ ] **Step 1: 실패하는 통합 테스트 작성** (네이버 판매주문, 줄 A qty 3·B qty 2, outbox 명령 행을 읽는 헬퍼는 `channel-cancel-request.integration.spec.ts` 의 것을 따른다)
  - `unboxed order: request cancels the lines and enqueues CancelChannelOrder with answers` — A 3 요청 → A 취소 3, 요청 행 `settling`, 명령 1건 `answers.channelRequestRef === 'po-A'`, `scope: 'partial'`.
  - `same channelRequestRef twice yields one amendment row and one command`
  - `request for an order core does not have is ignored` → `order_unknown`, 행 0.
  - `dispatched box: request is not stoppable and leaves no row` → `not_stoppable`, 행·명령 0, 판매주문 그대로.
  - `started batch, whole box requested: box exits the batch` — 결과 `stopped`, 상자 이탈 작업 생성(기존 `cancelOutstanding` 이탈 단언 재사용).
  - `started batch, part of the box requested: box waits for replan` — 상자 `recovery_required`·`CANCEL_REPLAN_PENDING`, 결과 `stopped`, 명령 1건.
  - `manual refund switch is refused on a market request row`
- [ ] **Step 2: 실패 확인** — `npm run test:core:integration:local -- market-cancel-request` → FAIL
- [ ] **Step 3: 구현** — 위 규칙.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx jest apps/core/src/modules/sales-order --maxWorkers=3` PASS(커널 가드 스펙 `order-cancellation.guard.spec.ts` 포함), `npm run type-check` 0
- [ ] **Step 5: 커밋** — `feat(core): 마켓 고객 취소요청을 요청 순간 취소하고 승인 명령을 낸다`

### Task 5: channel-adapter — 네이버 취소요청·일부 수량 취소 관측

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/naver-order-fields.ts` (클레임 칸)
- Modify: `apps/channel-adapter/src/adapters/naver/clients/naver-order.client.ts` (`getOrderDetails`·`queryProductOrders` 요청 본문에 `quantityClaimCompatibility: true`)
- Modify: `apps/channel-adapter/src/services/order-collection/naver-order.source.ts` (`buildLifecycle`)
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts`, `channel-order-provider.interface.ts`, `channel-order.translator.ts` (`ChannelReturnRequested` 와 같은 자리에 새 관측)
- Test: `naver-order.source.spec.ts`(있으면 확장, 없으면 생성), `naver-order-fields.spec.ts`, `naver-order.client.spec.ts`, 수집 오케스트레이터 스펙(격리 여부)

**Interfaces:**
- Consumes: Task 1 `ChannelCancelRequestedPayload`.
- Produces: `NaverProductOrderInfo` 에 `claimId?: string`, `claimType?: string`, `cancelClaimQuantity?: number`(`currentClaim.cancel.requestQuantity`). 필드명은 shadow 점검 전 추정 — 이 파일 머리 주석의 «필드명 확정의 단일 지점» 규칙을 따르고 추정임을 주석에 적는다. 없으면 throw 하지 않는다(선택 칸).
- 관측 규칙(`buildLifecycle`):
  - 계약에 남은 상품주문 중 `claimStatus ∈ CANCEL_IN_FLIGHT_CLAIMS` → `ChannelCancelRequested` 하나: `channelRequestRef = productOrderId`, `needsApproval = claimStatus === 'CANCEL_REQUEST'`, `items = [{ productOrderId, cancelClaimQuantity ?? quantity }]`, `eventKey = 'cancel-request:' + productOrderId + ':' + (claimId ?? 'na')`.
  - `productOrderStatus === 'PAYED'` 이고 `claimStatus === 'CANCEL_DONE'`(일부 수량 취소 완료) → 부분 `OrderCancelled`, `cancelledLines = [{ productOrderId, cancelClaimQuantity }]`, `eventKey = 'cancelled:' + productOrderId + ':' + cancelClaimQuantity`. 수량이 없으면 warn 하고 내지 않는다.
  - 기존 `CANCELED` 관측은 그대로(수량 = 줄 전량 = 누적).
  - 처음 수집 때 클레임이 붙은 주문을 만들지 않는 기존 동작(`resolvePaymentState` → `pending`)은 그대로.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `CANCEL_REQUEST on a collected productOrder emits ChannelCancelRequested with needsApproval true`
  - `CANCELING emits ChannelCancelRequested with needsApproval false`
  - `request quantity comes from currentClaim when present`
  - `PAYED with CANCEL_DONE emits a partial OrderCancelled with the claimed quantity`
  - `collected order that gains a cancel claim emits ChannelCancelRequested and is not quarantined` (오케스트레이터 수준 — 이미 매핑된 주문의 스냅샷이 `pending` 이 돼도 `collected_order_modification_not_accepted` 격리가 생기지 않는다)
  - 클라이언트: 두 조회 요청 본문에 `quantityClaimCompatibility: true`.
- [ ] **Step 2: 실패 확인** — `npx jest apps/channel-adapter/src/services/order-collection apps/channel-adapter/src/adapters/naver --maxWorkers=3` → FAIL
- [ ] **Step 3: 구현** — 위 규칙. 격리 테스트가 실패하면 오케스트레이터가 «이미 생성된 주문의 pending 스냅샷»을 수정 판정에서 빼도록 고친다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run type-check` 0
- [ ] **Step 5: 커밋** — `feat(channel-adapter): 네이버 취소요청과 일부 수량 취소를 관측한다`

### Task 6: channel-adapter — 승인 실행 (관찰 모드 기본)

**Files:**
- Create: `apps/channel-adapter/src/services/order-cancel/customer-cancel-approver.ts`
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts` (`execute` 맨 앞에서 `command.answers` 분기)
- Modify: 해당 모듈 providers (같은 폴더의 module 또는 `adapter.module.ts`)
- Test: `apps/channel-adapter/src/services/order-cancel/customer-cancel-approver.spec.ts`, `channel-order-cancel.manager.spec.ts`

**Interfaces:**
- Consumes: Task 1 `CancelChannelOrderPayload.answers`, Task 2 `approvesCustomerCancelRequest`, `NaverClaimClient.approveCancel(productOrderId)`, 쿠팡 반품 클라이언트의 `stoppedShipment` 호출(`coupang-return.client.service.ts`, 이름은 그 파일의 것).
- Produces:
  ```ts
  export type ApprovalResult =
    | { kind: 'approved' }
    | { kind: 'failed'; retryable: boolean; failureCode: string; message: string };
  export class CustomerCancelApprover {
    approve(command: CancelChannelOrderPayload & { answers: NonNullable<CancelChannelOrderPayload['answers']> }): Promise<ApprovalResult>;
  }
  ```
- 규칙:
  - `CHANNEL_CANCEL_APPROVAL_MODE !== 'act'` → `failed`, `retryable: false`, `failureCode: 'approval_observe_mode'`, `message: '관찰 모드 — 판매자센터에서 취소를 승인하세요.'` (호출 없음, info 로그 «승인했을 것»).
  - `answers.needsApproval === false` → `approved`(호출 없음).
  - `approvesCustomerCancelRequest` 가 false 인 채널 → `failed`, `retryable: false`, `'channel_not_supported'`.
  - 네이버: `approveCancel(channelRequestRef)`. 마켓이 «이미 승인/처리됨»으로 답하면 `approved`. 4xx 그 밖 → `retryable: false`. 5xx·네트워크·429 → `retryable: true`.
  - 쿠팡: `stoppedShipment(receiptId = channelRequestRef, …)` — 같은 분류.
  - manager: `approved` → 기존 성공 경로처럼 `orderPoller.syncOrder(..., { force: true })`. `failed` → 기존 `fail(...)`. `checkCollected` 는 먼저 그대로 돈다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `observe mode reports approval_observe_mode without calling the market`
  - `act mode calls naver approveCancel with the request ref`
  - `naver already-approved response counts as success`
  - `needsApproval false succeeds without calling the market`
  - `naver 5xx is retryable, naver 4xx is not`
  - `coupang act mode calls stoppedShipment with the receipt id`
  - manager: `command with answers goes to the approver, not the Medusa executor`
- [ ] **Step 2: 실패 확인** — `npx jest apps/channel-adapter/src/services/order-cancel --maxWorkers=3` → FAIL
- [ ] **Step 3: 구현** — 네이버 «이미 승인됨» 응답의 판별 값은 `NaverClaimProcessResponse` 의 실패 항목 코드에서 읽는다. 공식 값을 모르면 코드 상수 하나로 두고 주석에 «shadow 점검에서 확정»을 적는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run type-check` 0, `npx jest --maxWorkers=3` 전체 실패 0
- [ ] **Step 5: 커밋** — `feat(channel-adapter): core 가 멈춘 마켓 취소요청에 승인을 보낸다 (관찰 모드 기본)`

### Task 7: 문서 — 런북·이슈 연결

**Files:**
- Modify: `docs/superpowers/specs/2026-11-10-market-cancel-request-approval-design.md` (§5.2·§5.3a 에 «스펙과 다르게 정한 것» 반영)
- Modify: `apps/channel-adapter` 의 env 문서가 있으면 `CHANNEL_CANCEL_APPROVAL_MODE` 한 줄(없으면 `customer-cancel-approver.ts` 머리 주석으로 충분)

- [ ] **Step 1: 스펙 갱신** — «못 멈춤은 행을 남기지 않는다», «관찰 모드는 영구 실패로 끝낸다».
- [ ] **Step 2: 철회 갈림 확인(스펙 §7)** — `apps/channel-adapter/src/services/order-reconcile/channel-order-reconcile.classifier.ts` 가 «마켓 줄 살아 있음 · core 줄 취소»를 불일치로 잡는지 읽고 결론 한 줄을 스펙 §7 에 적는다. 못 잡으면 코드를 고치지 말고 #1233 아래 sub-issue 를 만든다(이 계획 범위 밖).
- [ ] **Step 3: 커밋** — `docs: 마켓 취소요청 설계를 구현 결정에 맞춘다`
- [ ] **Step 4: 사람 작업 목록을 PR 본문에** — (1) 배포 뒤 네이버 개통(#1244) 때 실 주문 1건으로 «취소요청 → core 취소 → 관찰 모드 실패 → 판매자센터 수동 승인 → 취소완료 수집 → 행 applied» 확인 (2) 그 뒤 `CHANNEL_CANCEL_APPROVAL_MODE=act` 로 바꾸는 배포 (3) 쿠팡 문서 본문 재확인(스펙 §2).
