# K7 PR 1 — 커널 껍데기: 문 다섯 개가 `OrderCancellation` 을 부르고, 채널은 이름이 아니라 능력으로 읽는다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 취소의 문들이 «와우프레스 → 사전검사 → 확정 → 실패 기록» 순서를 각자 짜지 않고 커널 `OrderCancellation` 을 부르게 하고, V1/V2 를 «상자 전/후» 이름으로 바꾸고, 채널 판정을 능력 표 하나로 모은다. **동작은 바뀌지 않는다**(스펙 §7-1).

**Architecture:** `sales-order/order-cancellation/` 에 커널(요청 `request`·통보 `notice`·커밋 뒤 `afterCommit`)과 채널 취소 능력 표를 둔다. 커널은 지금 문들에 흩어진 순서를 **그대로 옮겨** 부른다 — 안쪽의 `SalesOrdersService.cancel`·`ChannelCancelRequestService`·와우프레스 취소 모듈은 이 PR 에서 바뀌지 않는다. 바꾸는 순서(PR 2)·출고 명령(PR 3)·환불 방침(PR 4)이 들어올 자리를 만드는 PR 이다.

**Tech Stack:** NestJS(core), Drizzle, Jest(unit + `REQUIRE_*_DB` 통합 — 스크래치 DB `k6_it`).

**Spec:** `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md` (§4·§5.1~5.3·§5.4 이름·§5.7·§5.8·§5.9·§6 D8·§7-1).

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. core 가 돈을 쥔 주문(`3pl`)의 관리자 취소는 PR 4 까지 문(`adminCancelRequest`)에 남는다.** 그 경로는 부분취소와 환불 검토 기록(`manual_pending`)을 한 트랜잭션에 묶는데, 커널은 와우프레스를 트랜잭션 밖에서 먼저 부르므로 지금 모양 그대로는 커널에 못 들어온다. PR 4(환불 방침)가 그 기록을 커널의 «나중에 결정»으로 바꾸며 옮긴다. 가드 허용 목록에 이 문이 남는다(줄어드는 방향만). 라이브 0건.
- **N2. 수신 트랜잭션을 가진 채널 취소 컨슈머는 커널을 두 번 부른다** — 트랜잭션 안 `notice(…, tx)`, 커밋 뒤 `afterCommit(followUp)`. 이벤트 중복 기록(`order_events`)과 취소가 한 트랜잭션이어야 해서다. 컨슈머는 «커밋 뒤 할 일이 있다»만 알고 그게 와우프레스라는 건 모른다. PR 2 가 와우프레스 순서를 다시 볼 때 이 두 번째 호출을 없앨 수 있는지 판단한다.
- **N3. 채널 수량 감소의 «안 보낸 인쇄 붙잡기»(`print_orders` 직접 UPDATE, `holdUnsentPrint`)는 PR 2(D7)까지 `ChannelOrderChangeManager` 에 남는다.** 줄 전체 제거·셀메이트 출고처럼 커널을 부르지 않는 대기 갈래에서도 붙잡기 때문이다. 가드 허용 목록.
- **N4. 무통장 승인의 «와우프레스 record 먼저, 확정 나중» 순서는 이 PR 에서 그대로다**(D6 은 PR 2).
- **N5. 이름:** 상자 유무 판정 `hasBoxedFulfillment`, 갈래 `cancelBeforeBoxingFull`·`cancelBeforeBoxingPartial`·`cancelAfterBoxing`, 계획 `planAfterBoxing`, 재전송 `findAfterBoxingReplay`·`afterBoxingRequestHash`, 파일 `boxed-cancellation-units.ts`. «shipment» 를 쓰지 않는다 — K6 의 `shipmentPhase: 'before_shipment' | 'after_shipment'` 는 «출고 전/후»라 뜻이 겹친다.
- **N6. 대조 가드는 «명령으로 취소» 하나만 대조한다**(`automatedCancellation` ↔ `cancel === 'command'`) — channel-adapter 표에 나머지 능력(돈 정산·상계·셀프취소·wallet 결제)의 칸이 없다. 본편은 #1123.

## Global Constraints

- **동작 변경 없음.** 같은 입력이 같은 HTTP 상태·같은 문구·같은 행을 만든다. 예외 하나: D8(능력 표에 없는 채널 문자열은 `core` 로 떨어지지 않고 `Error` — `sales_channel` enum 네 값은 전부 표에 있어 라이브 영향 0).
- 400 거절 문구는 지금 문구를 글자 그대로 쓴다. 커널은 `@app/shared` 의 `BadRequestError` 등을 던진다(Service 규칙) — 문이 던지던 `BadRequestException` 과 상태·메시지가 같다.
- 커널은 `WalletRefundClient` 를 import 하지 않는다(스펙 G4).
- 와우프레스 `cancelForOrder(…, 'gate')` 는 트랜잭션 **밖**에서 부른다(외부 HTTP — 잠금을 쥔 채 기다리지 않는다). 지금 문들과 같다.
- 채널 이름 리터럴(`'medusa'`·`'naver'`·`'coupang'`·`'3pl'`)은 능력 표 파일에만 둔다 — 커널 디렉터리, `channel-cancel-request/`, `self-cancel-block.ts` 에서. 스토어프론트 고객 조회의 `'medusa'`(`findSoOrThrow({ channelOrderId, salesChannel: 'medusa' })` 등)와 환불 계산기의 `'medusa'`(K8)는 범위 밖.
- 통합 테스트는 스크래치 DB `k6_it`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`(아래 «통합(`k6_it`)»). 꺼져 있으면 `docker start almondyoung-server-postgres-1`. 마이그 없음. 워크트리엔 `node_modules` 심링크.
- 기준선: 브랜치 시작 때 `k6_it` 에서 `apps/core/src/modules/sales-order/**/*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다. 🔴 `channel-cancel-request.integration.spec.ts` 단발 실패는 공유 DB 동시 실행 의심 — 재실행으로 판정.
- 검증 게이트: `npm run type-check` 에러 0(로컬 환경 에러 — web-push·tauri 미설치 — 은 기준선), `npx jest` 실패 0(로컬 node_modules 누락분은 기준선), 통합(`k6_it`) 기준선 외 실패 0.

## Review Focus

- **고객 «인쇄 빼고 취소» 2단계** — 제작 중 인쇄 + 다른 상품 → `PRINT_PARTIAL_CANCEL_AVAILABLE`(409), `excludePrint` 재요청 → 인쇄·디지털 줄을 뺀 부분 취소, 남은 게 인쇄뿐 → `PrintInProductionError`. `store-sales-orders.service.spec.ts:463-520` 이 실제 커널을 통해 그대로 초록이어야 한다(Task 3).
- **채널 취소 재수신** — 이미 처리한 이벤트는 취소를 다시 하지 않고 `afterCommit` 만 `redeliveredSince` 와 함께 부른다. `order-events.consumer.spec.ts:432-492` 의 `redeliveredSince` 단언이 실제 커널로 그대로 통과해야 한다(Task 4).
- **채널 수량 감소 거절 뒤 남는 것** — 거절이면 취소 기록은 되돌려지고(savepoint) 인쇄 붙잡기(`cancel_refused`·`PRINT_HELD_FOR_DECREASE`)는 남는다. `channel-order-change.integration.spec.ts:369-381` 을 통과시키고, 거절 케이스에 «`sales_order_cancellations` 행 수 불변» 단언을 더한다(Task 4).
- **판매자센터 주문의 관리자 취소에 Idempotency-Key 가 없을 때** — 지금은 판매자센터 문구가 먼저 나온다. 커널은 능력 판정 → 키 확인 순서를 지킨다. Task 3 커널 spec 에 케이스(`naver`, `sourceKey: undefined` → `'네이버 판매자센터에서 취소해 주세요.'`).
- **모르는 채널** — `cancellationCapabilityOf('cafe24')` 는 `core` 가 아니라 던진다. Task 1 spec.

---

## 배포

- 배포 단위: **Core 만.** 마이그 없음. 게이트 없음(동작 변경 없음). `npm run deploy:preflight -- --stage live`.
- 롤백: 이 PR 이전 Core 로 되돌려도 안전하다(쓰는 행의 모양이 같다).

---

### Task 1: 채널 취소 능력 표 — 이름 대신 능력, 모르면 던진다

**Files:**
- Create: `apps/core/src/modules/sales-order/order-cancellation/channel-cancellation-capability.ts`
- Create: `apps/core/src/modules/sales-order/order-cancellation/channel-cancellation-capability.spec.ts`
- Create: `apps/core/src/modules/sales-order/order-cancellation/channel-cancellation-capability.parity.spec.ts`
- Delete: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-route.ts`, `channel-cancel-route.spec.ts`
- Modify: `channel-cancel-request/channel-cancel-request.manager.ts:17,64-70,122-124` · `services/store-sales-orders.service.ts:42,149-150,341,364,521` · `services/self-cancel-block.ts:35`

**Interfaces:**
- Consumes: 없음
- Produces:
  ```ts
  export type SalesChannelName = (typeof inventoryTables.salesOrders.$inferSelect)['salesChannel']; // 'medusa'|'naver'|'coupang'|'3pl'
  export interface ChannelCancellationCapability {
    cancel: 'command' | 'seller_center' | 'core';
    settlesMoney: 'channel' | 'core';
    acceptsAlreadyRefundedOffset: boolean;
    customerSelfCancel: boolean;
    paidByWalletIntent: boolean;
    sellerCenterLabel: string | null;
  }
  export function cancellationCapabilityOf(salesChannel: string): ChannelCancellationCapability; // 표에 없으면 Error
  export function channelsWhere(pred: (c: ChannelCancellationCapability) => boolean): SalesChannelName[];
  export function sellerCenterMessage(salesChannel: string): string; // 지금 문구 그대로
  export const CHANNEL_CANCELLATION_CAPABILITIES: Readonly<Record<SalesChannelName, ChannelCancellationCapability>>;
  ```

- [ ] **Step 1: 실패하는 테스트** — `channel-cancellation-capability.spec.ts`:

```ts
it.each([
  ['medusa', { cancel: 'command', settlesMoney: 'channel', acceptsAlreadyRefundedOffset: true, customerSelfCancel: true, paidByWalletIntent: true, sellerCenterLabel: null }],
  ['naver', { cancel: 'seller_center', settlesMoney: 'channel', acceptsAlreadyRefundedOffset: false, customerSelfCancel: false, paidByWalletIntent: false, sellerCenterLabel: '네이버' }],
  ['coupang', { cancel: 'seller_center', settlesMoney: 'channel', acceptsAlreadyRefundedOffset: false, customerSelfCancel: false, paidByWalletIntent: false, sellerCenterLabel: '쿠팡' }],
  ['3pl', { cancel: 'core', settlesMoney: 'core', acceptsAlreadyRefundedOffset: false, customerSelfCancel: false, paidByWalletIntent: false, sellerCenterLabel: null }],
])('%s', (ch, cap) => expect(cancellationCapabilityOf(ch)).toEqual(cap));
it('표에 없는 채널은 core 로 떨어지지 않고 던진다 (D8)', () =>
  expect(() => cancellationCapabilityOf('cafe24')).toThrow('Unknown sales channel for cancellation: cafe24'));
it('판매자센터 문구', () => {
  expect(sellerCenterMessage('naver')).toBe('네이버 판매자센터에서 취소해 주세요.');
  expect(sellerCenterMessage('coupang')).toBe('쿠팡 판매자센터에서 취소해 주세요.');
});
it('wallet intent 로 결제되는 채널', () => expect(channelsWhere((c) => c.paidByWalletIntent)).toEqual(['medusa']));
```

`channel-cancellation-capability.parity.spec.ts` (N6): channel-adapter `CHANNEL_CAPABILITIES`(`apps/channel-adapter/src/services/channel-capabilities.ts`, 상대 경로 import)와 대조.

```ts
it('채널 집합이 같다', () => expect(Object.keys(CHANNEL_CANCELLATION_CAPABILITIES).sort()).toEqual(Object.keys(CHANNEL_CAPABILITIES).sort()));
it.each(Object.keys(CHANNEL_CAPABILITIES))('%s — «명령으로 취소»가 channel-adapter 의 automatedCancellation 과 같다', (ch) =>
  expect(CHANNEL_CANCELLATION_CAPABILITIES[ch].cancel === 'command').toBe(CHANNEL_CAPABILITIES[ch].fulfillment.automatedCancellation));
```
파일 머리 주석에 «#1123 이 끝나면 이 파일을 지운다».

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/order-cancellation/channel-cancellation-capability` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — 표는 `Record<SalesChannelName, …>` 로 써서 enum 에 값이 늘면 tsc 가 빨갛게 한다. `cancellationCapabilityOf` 는 `Object.hasOwn` 으로 찾고 없으면 `new Error(\`Unknown sales channel for cancellation: ${salesChannel}\`)`. `sellerCenterMessage` 는 `${label ?? salesChannel} 판매자센터에서 취소해 주세요.`. 옛 `channel-cancel-route.ts` 의 머리 주석(«채널 어휘가 아니라 명령을 보낼 수 있는가») 원칙을 옮긴다.

- [ ] **Step 4: 호출자 바꾸기** (동작 그대로):
  - manager `request`: `channelCancelRoute(so.salesChannel)` → `cancellationCapabilityOf(so.salesChannel).cancel`.
  - manager `assertAlreadyRefundedAllowed`: `salesChannel !== 'medusa'` → `!cancellationCapabilityOf(salesChannel).acceptsAlreadyRefundedOffset`.
  - store `adminCancelRequest:149-150` 같은 치환. store `:521` `channelCancelRoute(…) === 'command'` → `.cancel === 'command'`(**`settlesMoney` 로 바꾸지 않는다** — 네이버 주문 문구가 바뀐다).
  - store `:341`·`:364` `eq(salesChannel, 'medusa')` → `inArray(salesChannel, channelsWhere((c) => c.paidByWalletIntent))`.
  - `self-cancel-block.ts:35` `facts.salesChannel !== 'medusa'` → `!cancellationCapabilityOf(facts.salesChannel).customerSelfCancel`.

- [ ] **Step 5: 통과 확인** — 위 두 spec + `self-cancel-block.spec.ts` + `store-sales-orders.service.spec.ts` + `channel-cancel-request.types.spec.ts` PASS. 통합(`k6_it`): `channel-cancel-request.integration.spec.ts`, `store-self-cancel.integration.spec.ts` PASS. `npm run type-check` 기준선.

- [ ] **Step 6: 커밋** — `git commit -m "refactor(core): 채널 취소 판정을 능력 표 하나로 — 모르는 채널은 core 로 떨어지지 않는다 (K7 PR1)"`

---

### Task 2: 이름 바꾸기 — V1/V2 를 «상자 전/후»로

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (N5 의 이름, `cancel()` 본문의 상자 전 전체취소를 `cancelBeforeBoxingFull` 로 추출, `cancelPartial` → `cancelBeforeBoxingPartial`)
- Rename: `services/v2-cancellation-units.ts` → `services/boxed-cancellation-units.ts` (+ `.spec.ts`), `services/sales-orders.v2-cancellation-composition.integration.spec.ts` → `services/sales-orders.boxed-cancellation-composition.integration.spec.ts`
- Modify(주석·메시지·테스트 이름): §4 의 V1/V2 언급 28곳 — `grep -rn "\bV[12]\b" apps/core/src/modules/sales-order --include=*.ts` 가 정본 목록. 취소 갈래를 뜻하는 것만 바꾼다. **출고 파이프라인 버전을 뜻하는 것은 그대로**(`sales-orders.service.ts:1345,1363` «V2 planning», `line-quantities.sql.ts:103`·`sales-orders.service.ts:2344` «V2 발송» — 출고 모듈의 `assertV2MutationAllowed` 와 같은 뜻).
- Create: `apps/core/src/modules/sales-order/order-cancellation/boxing-names.guard.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `SalesOrdersService` 의 private 이름(N5). 공개 표면(`cancel`·`planCancellation`·`validateCancellationReplay`)은 그대로.

- [ ] **Step 1: 실패하는 가드** — `boxing-names.guard.spec.ts`(`cancel-outstanding-callers.guard.spec.ts` 의 `walk` 방식, `apps/core/src` 전체 — spec 포함):

```ts
it('옛 V1/V2 취소 이름이 없다', () =>
  expect(filesMatching(/hasV2FulfillmentHistory|cancelV2Outstanding|planV2Outstanding|findV2CancellationReplay|v2CancellationRequestHash|v2-cancellation-units|\bcancelPartial\b/)).toEqual([]));
it('판매주문 코드가 취소 갈래를 V1/V2 로 부르지 않는다', () =>
  expect(filesMatching(/V[12]\s*(전체|부분)?\s*취소|V[12] (sales-order )?cancellation|V[12] 경로|V1 엔진|V2 fulfillment (item|SKU)|V2 (component )?progress|V2 outstanding|V2 «/, 'apps/core/src/modules/sales-order')).toEqual([]));
```

- [ ] **Step 2: 실패 확인** — FAIL(옛 이름 목록이 나온다).

- [ ] **Step 3: 바꾸기** — 식별자는 IDE 수준 rename. 예외 메시지의 «V2 fulfillment item …»은 «Boxed fulfillment item …», «V2 outstanding …»은 «Boxed outstanding …» 식으로 — 그 메시지를 단언하는 spec 을 같이 고친다(`grep -rn "V2 " apps/core/src --include=*.spec.ts`). 주석의 «V1 전체취소»는 «상자 전 전체취소», «V2 경로»는 «상자 후 경로». `channel-order-change.integration.spec.ts:417` 주석도.

- [ ] **Step 4: 통과 확인** — 가드 PASS, `npx jest apps/core/src/modules/sales-order` 기준선, 통합(`k6_it`) `apps/core/src/modules/sales-order/**/*.integration.spec.ts` 기준선 외 0, `type-check` 기준선.

- [ ] **Step 5: 커밋** — `git commit -m "refactor(core): 판매주문 취소 갈래 V1/V2 를 «상자 전/후»로 — V1 은 레거시가 아니라 현역이다 (K7 PR1)"`

---

### Task 3: 커널 — 요청(고객·운영자)

**Files:**
- Create: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.types.ts`
- Create: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts` (`@Injectable() class OrderCancellation`)
- Create: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.spec.ts`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts` (providers 에 `OrderCancellation`)
- Modify: `services/store-sales-orders.service.ts` — `processCancelRequest:944-1000` 의 «lines 계산 → precheck → gate → afterPrintCancel+request» 와 `linesWithoutPrint:280-306`, `adminCancelRequest:149-177` 의 채널 갈래를 커널로 옮긴다. 생성자 끝에 `private readonly cancellation: OrderCancellation`.
- Modify(생성자 인자만): `new StoreSalesOrdersService(` 를 부르는 spec 전부 — `grep -rln "new StoreSalesOrdersService(" apps/core/src` 가 정본. 같은 mock 들로 `new OrderCancellation(…)` 을 만들어 넘긴다(실제 커널을 통해 기존 단언이 그대로 통과해야 한다 — mock 커널 금지).

**Interfaces:**
- Consumes: Task 1 `cancellationCapabilityOf`·`sellerCenterMessage`
- Produces:
  ```ts
  // order-cancellation.types.ts
  export type CancelLine = { salesOrderLineId: string; quantity: number };
  export type CancellationRequest =
    | { requester: { kind: 'customer'; customerId: string }; salesOrderId: string; sourceKey: string | undefined;
        reasonCode?: string; reasonDetail?: string; excludePrint?: boolean }
    | { requester: { kind: 'operator'; actorId: string }; salesOrderId: string; sourceKey: string | undefined;
        reasonCode?: string; reasonDetail?: string; lines?: CancelLine[]; alreadyRefundedAmount?: number };
  // order-cancellation.ts
  constructor(
    db: DbService<typeof wmsSchema>,
    salesOrders: SalesOrdersService,
    cancelRequests: ChannelCancelRequestService,
    printOrders: PrintOrderReader,
    printCancellation: PrintOrderCancellationManager,
  ) // Task 4 가 끝에 settler·reader 를 더한다
  request(intent: CancellationRequest): Promise<CancelRequestView>;
  ```

**`request` 의 순서** — 지금 두 문의 순서를 합친 것. 바꾸지 않는다:
1. 판매주문을 읽는다(`NotFoundError` — 없으면).
2. `cancellationCapabilityOf(so.salesChannel).cancel`: `seller_center` → `BadRequestError(sellerCenterMessage(…))`. `core` → `Error(\`Sales channel ${so.salesChannel} does not take cancel commands\`)`(지금 manager 의 문구 — 고객은 셀프취소 차단이 먼저 막아 닿지 않고, 운영자는 N1 로 닿지 않는다).
3. `sourceKey` 가 없으면 `BadRequestError('Idempotency-Key header is required')`.
4. 같은 키의 요청 행(`cancelRequests.findBySourceKey`)이 있으면 그 view 를 돌려준다 — 와우프레스를 부르지 않는다.
5. 줄: 운영자는 `intent.lines`. 고객은 `excludePrint` 면 `linesWithoutPrint`(옮겨 온 그대로 — 살아 있는 인쇄 줄·디지털 줄을 뺀 전체 계획), 결과가 빈 배열이면 `PrintInProductionError`. 아니면 `undefined`.
6. `cancelRequests.precheck(so.id, lines, 운영자면 alreadyRefundedAmount)`.
7. 와우프레스 gate(트랜잭션 밖): 운영자 `cancelForOrder(so.id, 'gate', lines)`. 고객 `cancelForOrder(so.id, 'gate', lines, { keepOnRefusal: true })` — 거절이 `PrintInProductionError`/`PrintShippedError` 이고 `lines` 가 없고 `linesWithoutPrint` 가 비어 있지 않으면 `PrintPartialCancelAvailableError`.
8. `cancelRequests.request({ salesOrderId, lines?, requester, sourceKey, reasonCode, reasonDetail, alreadyRefundedAmount? })` — 실패하면 `printCancellation.noteSalesCancelFailed(printed, error)` 뒤 다시 던진다.

**문이 남기는 것:** 고객 `processCancelRequest` 는 키 재전송 읽기(`cancelRequests.findBySourceKey` → `buildActionsView`, 셀프취소 차단보다 먼저여야 이미 취소된 주문의 재전송이 400 이 아니다) · `timeout` · `selfCancelBlockOf` 를 지금처럼 하고 `this.cancellation.request(…)` 한 번, 그 뒤 `buildActionsView`. `Idempotency-Key` 확인은 커널(3)로 넘어가 문에서 지운다. 관리자 `adminCancelRequest` 는 `cancellationCapabilityOf(so.salesChannel).settlesMoney === 'channel'` 이면 `this.cancellation.request(…)` 한 번 뒤 `{ requestId, status, scope, convertedFromFull }`, 아니면(N1) 지금 core 갈래 그대로 — 그 갈래 위에 `// K7 PR4 전까지: core 가 돈을 쥔 주문은 문이 환불까지 한다(스펙 §5.5)`. `afterPrintCancel` 은 store 의 core 갈래가 계속 쓰므로 store 에도 남는다(PR 4 가 지운다).

- [ ] **Step 1: 실패하는 테스트** — `order-cancellation.spec.ts`(mock 의존성, 기존 `store-sales-orders.service.spec.ts:97` `makeContext` 의 mock 모양을 따른다):

```ts
it('판매자센터 주문은 키가 없어도 판매자센터 문구가 먼저다', async () => {
  // so.salesChannel = 'naver'
  await expect(k.request({ requester: { kind: 'operator', actorId: 'a' }, salesOrderId: 'so', sourceKey: undefined }))
    .rejects.toThrow('네이버 판매자센터에서 취소해 주세요.');
});
it('키가 없으면 400', async () =>
  await expect(k.request({ requester: { kind: 'operator', actorId: 'a' }, salesOrderId: 'so', sourceKey: undefined }))
    .rejects.toThrow('Idempotency-Key header is required'));       // so.salesChannel = 'medusa'
it('같은 키의 요청이 있으면 그 view 를 돌려주고 와우프레스를 부르지 않는다', async () => {
  // findBySourceKey → view
  expect(await k.request({ requester: { kind: 'customer', customerId: 'c' }, salesOrderId: 'so', sourceKey: 'k' })).toBe(view);
  expect(printCancel).not.toHaveBeenCalled();
  expect(cancelRequests.request).not.toHaveBeenCalled();
});
it('운영자 요청은 precheck → gate → request 순서로, 상계 금액을 precheck 와 request 에 넘긴다', async () => {
  await k.request({ requester: { kind: 'operator', actorId: 'a' }, salesOrderId: 'so', sourceKey: 'k', lines, alreadyRefundedAmount: 1000 });
  expect(callOrder).toEqual(['precheck', 'gate', 'request']);
  expect(cancelRequests.precheck).toHaveBeenCalledWith('so', lines, 1000);
  expect(cancelRequests.request).toHaveBeenCalledWith(expect.objectContaining({ requester: { kind: 'operator', actorId: 'a' }, alreadyRefundedAmount: 1000 }));
});
it('확정이 실패하면 인쇄 행에 남기고 다시 던진다', async () => {
  // cancelRequests.request rejects boom
  await expect(k.request(op)).rejects.toBe(boom);
  expect(printNote).toHaveBeenCalledWith(printed, boom);
});
```

- [ ] **Step 2: 실패 확인** — FAIL(모듈 없음).
- [ ] **Step 3: 구현** — 위 순서. 옮긴 코드의 주석(«인쇄 취소는 되돌릴 수 없어 그 전에 부른다», PR 4 넘길 것 1 등)을 같이 옮긴다.
- [ ] **Step 4: 문 바꾸기** — 위 «문이 남기는 것». spec 의 `new StoreSalesOrdersService(` 에 실제 커널.
- [ ] **Step 5: 통과 확인** — `order-cancellation.spec.ts`, `store-sales-orders.service.spec.ts`(특히 `:330` `cancelRequestByChannelOrder`·`:1277` `adminCancelRequest` describe — **단언은 고치지 않는다**), `self-cancel-block.spec.ts` PASS. 통합(`k6_it`): `store-self-cancel.integration.spec.ts`, `request-vs-gate.integration.spec.ts`, `channel-cancel-request.integration.spec.ts` PASS. `type-check` 기준선.
- [ ] **Step 6: 커밋** — `git commit -m "refactor(core): 고객·운영자 취소 요청이 커널 OrderCancellation 을 한 번 부른다 (K7 PR1)"`

---

### Task 4: 커널 — 통보(무통장 승인·채널 취소·채널 수량 감소)

**Files:**
- Create: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.reader.ts` — `ChannelOrderChangeReader` 의 `hasActivePrintOrder(:151)`·`cancellationNeedsFollowUp(:113)` 를 옮긴다(둘 다 `tryDecrease` 만 썼다). 의존성 없는 클래스(`new OrderCancellationReader()`).
- Modify: `order-cancellation.ts`, `order-cancellation.types.ts`, `order-cancellation.spec.ts`, `sales-order.module.ts`(providers 에 `OrderCancellationReader`)
- Modify: `services/store-sales-orders.service.ts:379-388` (`cancelByWalletIntentAfterRefund` 의 record+request → 커널), `consumers/order-events.consumer.ts:218-276`, `channel-order-change/channel-order-change.manager.ts:178-213`(`tryDecrease`), `channel-order-change/channel-order-change.reader.ts`(옮긴 두 메서드 삭제)
- Modify(생성자 인자만): `new OrderEventsConsumer(`·`new ChannelOrderChangeManager(`·`new OrderCancellation(` 를 부르는 spec 전부(`grep -rln` 이 정본) — 실제 커널.

**Interfaces:**
- Consumes: Task 3 `OrderCancellation`(생성자 끝에 `settler: ChannelCancelSettler`, `reader: OrderCancellationReader` 를 더한다), `CancelLine`
- Produces:
  ```ts
  export type CancellationNotice =
    | { source: 'wallet_refund_approval'; salesOrderId: string; intentId: string; reasonCode: string }
    | { source: 'channel_cancelled'; salesOrderId: string; lines: CancelLine[] | undefined; reasonCode?: string;
        reasonDetail?: string; cancelledBy?: string; occurredAt?: string; metadata: Record<string, unknown> }
    | { source: 'channel_decrease'; salesOrderId: string; line: CancelLine; reasonCode: string; occurredAt: string; sourceEventId: string };
  export type NoticeFollowUp = { salesOrderId: string; lines: CancelLine[] | undefined; redeliveredSince?: Date };
  export type NoticeOutcome =
    | { applied: true; requestView?: CancelRequestView; followUp?: NoticeFollowUp }
    | { applied: false; refusal: string };
  notice(intent: CancellationNotice, tx?: DbTx): Promise<NoticeOutcome>;
  afterCommit(followUp: NoticeFollowUp): Promise<void>;
  ```

**갈래별 규칙** — 지금 코드 그대로:
- `wallet_refund_approval`(tx 를 받으면 `Error` — 커널이 트랜잭션을 가진다): `cancelForOrder(id, 'record')` 뒤 `cancelRequests.request({ salesOrderId, requester: { kind: 'wallet-refund-approval', intentId }, sourceKey: \`wallet-refund-approval:${intentId}\`, reasonCode })`(N4). `{ applied: true, requestView }`. 문은 판매주문 찾기·`already_cancelled`/`already_shipped` 건너뛰기·로그를 지금처럼 하고 커널을 한 번 부른다.
- `channel_cancelled`(tx 필수, 없으면 `Error`): tx 안에서 `salesOrders.cancel(id, { reasonCode, reasonDetail, cancelledBy, occurredAt, lines?, metadata }, tx)` → `printCancellation.holdUnsent(id, lines, tx)` → 줄이 없으면(전체) `settler.settleCancelled(id, tx)`. `{ applied: true, followUp: { salesOrderId, lines } }`. `afterCommit` 은 `cancelForOrder(id, 'record', lines, { redeliveredSince })`. 컨슈머(N2): 트랜잭션 안 `notice` → 커밋 뒤 `afterCommit(followUp)`. 재수신 갈래(`alreadyProcessed`)는 `notice` 없이 `afterCommit({ salesOrderId, lines, redeliveredSince: first?.createdAt })`.
- `channel_decrease`(tx 필수): **커널이 savepoint 를 연다**(`tx.transaction(sp => …)`) — 그 안에서 `reader.hasActivePrintOrder(line)` 면 거절 `'print order on this line — decide on WowPress'`, `salesOrders.cancel(id, { lines: [line], cancelledBy: 'channel', reasonCode, occurredAt, metadata: { sourceEventId } }, sp)` 의 도메인 거절(`isDomainRefusal`)이면 거절 `errorDetail(error)`, `reader.cancellationNeedsFollowUp(id, sourceEventId, sp)` 가 문자열이면 거절 그 문자열. 거절이면 savepoint 를 되돌리고 `{ applied: false, refusal }`, 아니면 `{ applied: true }`. `isDomainRefusal`·`errorDetail` 은 `channel-change-blockers.ts` 에서 import. manager `tryDecrease` 는 `const o = await this.cancellation.notice({ source: 'channel_decrease', … reasonCode: CHANNEL_ORDER_MODIFIED_REASON }, tx); return o.applied ? applied : { …delta, outcome: 'pending', blockers: [{ code: 'CANCEL_NOT_IMMEDIATE', detail: o.refusal }] }` — `attempt` 는 주소 갈래만 쓴다. `holdUnsentPrint`(N3)는 manager 에 그대로.

- [ ] **Step 1: 실패하는 테스트** — `order-cancellation.spec.ts` 에:

```ts
it('채널 취소 통보는 tx 없이 부르면 던진다', async () =>
  await expect(k.notice({ source: 'channel_cancelled', salesOrderId: 'so', lines: undefined, metadata: {} })).rejects.toThrow());
it('채널 전체취소 통보 — 같은 tx 로 cancel → holdUnsent → settle, 커밋 뒤 할 일을 돌려준다', async () => {
  const o = await k.notice({ source: 'channel_cancelled', salesOrderId: 'so', lines: undefined, metadata: { sourceEventId: 'e' } }, tx);
  expect(callOrder).toEqual(['cancel', 'holdUnsent', 'settleCancelled']);
  expect(o).toEqual({ applied: true, followUp: { salesOrderId: 'so', lines: undefined } });
  expect(printCancel).not.toHaveBeenCalled();
});
it('채널 부분취소 통보는 정산을 닫지 않는다', async () => { /* lines 있음 → settleCancelled 미호출 */ });
it('afterCommit 은 record 로 재수신 시각을 넘긴다', async () => {
  await k.afterCommit({ salesOrderId: 'so', lines, redeliveredSince: t });
  expect(printCancel).toHaveBeenCalledWith('so', 'record', lines, { redeliveredSince: t });
});
it('무통장 승인 통보는 record 먼저, 확정 나중 (N4)', async () => {
  const o = await k.notice({ source: 'wallet_refund_approval', salesOrderId: 'so', intentId: 'i', reasonCode: 'CUSTOMER_REFUND_REQUEST' });
  expect(callOrder).toEqual(['record', 'request']);
  expect(cancelRequests.request).toHaveBeenCalledWith(expect.objectContaining({ sourceKey: 'wallet-refund-approval:i', requester: { kind: 'wallet-refund-approval', intentId: 'i' } }));
  expect(o).toEqual({ applied: true, requestView: view });
});
```

`channel-order-change.integration.spec.ts` 의 인쇄 거절 케이스(`:369` 근처)에 단언 하나: 거절 뒤 그 주문의 `sales_order_cancellations` 행 수가 거절 전과 같다.

- [ ] **Step 2: 실패 확인** — FAIL(`notice` 없음).
- [ ] **Step 3: 구현** — 위 규칙. 컨슈머의 주석(«와우프레스 호출은 트랜잭션 밖에서 한다…», «우리가 낸 취소 요청을 닫는다…»)을 커널 쪽으로 옮기고, 컨슈머에는 «커밋 뒤 할 일은 커널이 안다» 한 줄.
- [ ] **Step 4: 문 바꾸기** — 위 규칙. 컨슈머·manager·store 에서 `printCancellation`·`cancelSettler` 가 더 안 쓰이면 생성자에서 뺀다(spec 생성자도).
- [ ] **Step 5: 통과 확인** — `order-cancellation.spec.ts`, `order-events.consumer.spec.ts`(특히 `:432-492` — 단언은 고치지 않는다), `store-sales-orders.service.spec.ts:1559` `cancelByWalletIntentAfterRefund` PASS. 통합(`k6_it`): `channel-order-change.integration.spec.ts`, `channel-cancel-settling.integration.spec.ts`, `channel-cancel-request.integration.spec.ts` PASS. `type-check` 기준선.
- [ ] **Step 6: 커밋** — `git commit -m "refactor(core): 채널 취소·수량 감소·무통장 승인 통보도 커널을 부른다 (K7 PR1)"`

---

### Task 5: 호출자 가드와 ADR

**Files:**
- Create: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.guard.spec.ts`
- Create: `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md`
- Modify: `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md` (끝에 «진행» 절 — PR 1 한 줄)

**Interfaces:**
- Consumes: Task 3·4 의 파일 경로
- Produces: 없음

- [ ] **Step 1: 가드** — `cancel-outstanding-callers.guard.spec.ts` 의 `walk`(spec·`__support__`·`__fixtures__` 제외), `apps/core/src` 전체. 허용 목록 옆에 사유 주석(N1·N3·확정 내부):

```ts
const K = 'apps/core/src/modules/sales-order/order-cancellation/order-cancellation.ts';
const STORE = 'apps/core/src/modules/sales-order/services/store-sales-orders.service.ts';            // N1 — PR4 가 지운다
const MANAGER = 'apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts'; // 확정 내부
it('판매주문 취소 적용', () => expect(filesCalling(/\b(salesOrders|salesOrdersService)\.cancel\(/)).toEqual([MANAGER, K, STORE].sort()));
it('취소 계획', () => expect(filesCalling(/\.planCancellation\(/)).toEqual([MANAGER, K].sort()));
it('채널 취소 요청 확정·사전검사', () => expect(filesCalling(/cancelRequests\.(request|precheck)\(/)).toEqual([K, STORE].sort()));
it('와우프레스 취소 문', () => expect(filesCalling(/printCancellation\.(cancelForOrder|holdUnsent|noteSalesCancelFailed)\(/)).toEqual([K, STORE].sort()));
it('판매주문 코드의 print_orders 직접 UPDATE', () =>
  // 직접 형(.update(wmsTables.printOrders))과 별칭 형(const t = wmsTables.printOrders; … .update(t)) 둘 다.
  // «printOrders 를 언급하고 어딘가에서 update» 로 넓히면 sales-orders.service.ts 가 거짓 양성이다.
  expect(filesCalling(/\.update\((?:wmsTables|inventoryTables)\.printOrders\)|const (\w+) = (?:wmsTables|inventoryTables)\.printOrders;[\s\S]*?\.update\(\1\)/, 'apps/core/src/modules/sales-order'))
    .toEqual(['apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts'])); // N3 — PR2(D7)
it('커널은 Wallet 을 모른다', () =>
  expect(filesCalling(/WalletRefundClient|wallet-refund\.client/, 'apps/core/src/modules/sales-order/order-cancellation')).toEqual([]));
it('취소 경로에 채널 이름 리터럴이 없다', () =>
  expect(filesCalling(/'(medusa|naver|coupang|3pl)'/, [
    'apps/core/src/modules/sales-order/order-cancellation',
    'apps/core/src/modules/sales-order/channel-cancel-request',
    'apps/core/src/modules/sales-order/services/self-cancel-block.ts',
  ])
    .filter((f) => !f.endsWith('channel-cancellation-capability.ts'))).toEqual([]));
```
`filesCalling(pattern, roots?)` 는 루트 하나·여러 개를 받게 한다. 실제 목록이 위와 다르면 **목록을 맞추지 말고** 그 호출이 왜 남았는지 본다 — 커널을 거쳐야 할 호출이면 Task 3·4 로 돌아간다.

- [ ] **Step 2: 통과 확인** — 가드 PASS(Task 1~4 뒤라 처음부터 초록이어야 한다. 빨가면 위 원칙).
- [ ] **Step 3: ADR-0049** — K6 ADR-0047 의 꼴. 결정: 취소의 순서(판정·와우프레스·확정·기록)는 커널 하나가 소유하고 문은 의도만 넘긴다 / 요청과 통보의 구분 / 커널은 돈을 만지지 않는다 / 채널은 이름이 아니라 능력으로(#1123). 현재 상태: PR 1 뒤 남은 허용 목록(N1·N2·N3·N4)과 그걸 지울 PR. 스펙 링크.
- [ ] **Step 4: 스펙 «진행» 절** — `## 10. 진행` 에 `- PR 1 (이 PR): 커널 껍데기·이름·능력 표 — 동작 변경 없음(D8 제외).`
- [ ] **Step 5: 전체 게이트** — `npm run type-check` 기준선, `npx jest` 실패 기준선 외 0, 통합(`k6_it`) `apps/core/src/modules/sales-order/**/*.integration.spec.ts` 기준선 외 0.
- [ ] **Step 6: 커밋** — `git commit -m "test(core): 취소 호출자 가드와 ADR-0049 — 순서는 커널 하나가 소유한다 (K7 PR1)"`
