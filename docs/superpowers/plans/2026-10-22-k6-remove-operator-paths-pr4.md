# K6 PR 4 — 판매주문 기록을 우회하는 관리자 경로 셋 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자 «미처리 취소»(`POST /shipments/:id/cancellations`), FO 취소(`POST /fulfillments/:id/cancel`), 수동 배송완료(`POST /fulfillments/:id/deliver`)와 그 화면 버튼을 지워, 취소는 판매주문 취소로만·배송은 추적으로만 기록되게 한다(스펙 §8 D1·D10·D11).

**Architecture:** 라우트·서비스 메서드·admin-web 훅/버튼을 삭제한다. `ShipmentPlanningService.cancelOutstanding` 은 판매주문 V2 취소가 부르는 내부 단계로 남긴다. FO 취소가 유일한 생산자였던 `FulfillmentCancelled` 는 생산자가 0 이 되므로 계약·no-op 소비자째 지운다. `FulfillmentDelivered` 는 추적 경로(`ShipmentDeliveryTrackingService`)가 계속 발행하므로 남긴다. 옛 경로가 되살아나면 빨개지는 가드 spec 둘을 둔다.

**Tech Stack:** NestJS(core·channel-adapter), Next.js(admin-web), zod 이벤트 계약(`packages/event-contracts`), Jest.

**Spec:** `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md` (§4.1, §6.2, §8 D1·D10·D11, §9-4). ADR: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md`.

## Global Constraints

- 마이그레이션 없음. 스키마 enum(`fulfillment_orders.status` 의 `completed` 등)은 건드리지 않는다 — 값 삭제는 destructive(ADR-0005 §5)이고 이 PR 의 목적이 아니다.
- `ShipmentPlanningService.cancelOutstanding`·`CancelShipmentOutstandingDto`·`applyDraftCancellation`·대기 취소 재개(`CANCEL_REPLAN_PENDING`) 경로는 그대로 둔다 — 판매주문 취소(`sales-orders.service.ts:1858`)와 리컨실러가 쓴다.
- `FulfillmentDelivered`(계약·`fulfillmentDeliveredV1OutboxEvent`·channel-adapter 소비자·`CoreFulfillmentDelivered` inbox 갈래)는 남긴다 — 생산자가 추적 경로에 하나 더 있다(`shipment-delivery-tracking.service.ts:456`).
- admin-web 이력 탭의 이벤트 라벨 `FulfillmentCancelled: '취소'`(`history-tab.tsx:47`)는 남긴다 — 이미 쌓인 아웃박스 행이 계속 보인다.
- 새 HTTP 라우트 없음. 지우는 라우트의 `scripts/security/pii-routes.ts` 줄(58·59·64)은 같이 지운다(`pii-routes.spec.ts`).
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0, `npm run test:admin-web` 실패 0.

## Review Focus

- **판매주문 V2 취소가 여전히 상자 미처리분을 줄인다** — 라우트 삭제가 `cancelOutstanding` 내부 경로를 건드리지 않았는지. 기존 `shipment-planning.integration.spec.ts`·`outbound-v2-scenarios.integration.spec.ts` 가 통과해야 한다(Task 1 Step 5 에서 돌린다).
- **FO 상세 화면이 `adminAvailableActions` 에 `cancel`·`deliver` 없이도 직배 버튼(`forwardDropShip`·`completeDropShip`)을 그대로 보인다** — Task 2 의 `computeAdminAvailableActions` spec 에 직배 FO 단언을 둔다.
- **channel-adapter 가 `FulfillmentCancelled` 핸들러 없이 같은 토픽의 `FulfillmentShipped`·`FulfillmentDelivered` 를 계속 받는다** — 토픽 구독은 남은 `@On(FULFILLMENT_STREAM, …)` 이 유지한다. Task 3 의 소비자 spec 이 두 핸들러 존재를 단언한다.
- **롤아웃 중 옛 core 가 낸 `FulfillmentCancelled` 가 새 channel-adapter 에 도착** — `EventTypeGuard` 가 매칭 핸들러 없는 메시지를 걸러 조용히 넘어간다(옛 핸들러도 로그만 찍는 no-op 이었다). 배포 전 게이트 G2 로 대기 행 0 을 확인한다.
- **admin-web 출고 상세의 «분할» 대화상자** — 지금 `split`·`cancel` 이 한 수량 선택 블록(`shipment-actions.tsx:436`, `:598`)을 공유한다. `cancel` 을 빼도 분할 대화상자 문구·검증이 그대로여야 한다(Task 4 에서 `operation-ui.spec.ts` 로 확인).

---

## 배포

- 배포 단위: **Core · channel-adapter · admin-web**. 마이그레이션 없음. 2b·3a·3b(#1116·#1118·#1119)와 같은 배포면 그 절차 먼저.
- 순서는 무관하다(SST 한 스택). 잠깐 «버튼은 있는데 라우트 404» 창이 생길 수 있으나 셋 다 라이브 사용 흔적이 G1 로 확인된 경로만 지운다.
- **배포 전 게이트(터널은 사용자):**
  - **G1 사용 흔적** — FO 취소 버튼이 라이브에서 쓰였는지. 최근 30일에 행이 있으면 배포 전에 사용자에게 보인다(«쓰임새를 아는 사람이 없다»는 D11 전제를 다시 연다).
    ```sql
    SELECT count(*) AS total,
           count(*) FILTER (WHERE created_at > now() - interval '30 days') AS last_30d,
           max(created_at) AS last_at
    FROM event.outbox_events WHERE event_type = 'FulfillmentCancelled';
    ```
  - **G2 대기 행** — `SELECT count(*) FROM event.outbox_events WHERE event_type = 'FulfillmentCancelled' AND status <> 'PUBLISHED';` 기대 0.
  - **G3 운영자 상자 취소** — `SELECT count(*) FROM shipment_operations WHERE type = 'cancel' AND idempotency_key NOT LIKE 'sales-order-cancel:%';` 기대 0(라이브는 V2 상자 미사용). 0 이 아니면 운영자 취소가 남긴 상자가 있다는 뜻이라 사람이 먼저 본다.
  - **G4 판매주문 없는 출고주문**(최종 리뷰 뒤 추가, 사용자 결정 (c)) — `SELECT count(*) AS total, count(*) FILTER (WHERE status NOT IN ('shipped','completed','canceled')) AS open, max(created_at) AS last_at FROM fulfillment_orders WHERE sales_order_id IS NULL;` `open` 기대 0. 0 이 아니면 그 FO 는 이 배포 뒤 취소할 길이 없으니 배포 전에 사람이 처리를 정한다. `total`·`last_at` 은 수동 생성 화면을 실제로 쓰던 흔적이다.
- `npm run deploy:preflight -- --stage live` 가 이벤트 계약 변경(`fulfillments.stream.ts`)을 보여 준다 — 기대한 변경이다.

---

### Task 1: 운영자 «미처리 취소» 라우트 제거 (D1) + 호출자 가드

**Files:**
- Modify: `apps/core/src/modules/fulfillment/controllers/shipment-planning.controller.ts:~170-203` (`cancelOutstanding` 핸들러와 그 위 `@PiiResponse`·`@ApiOperation` 데코레이터 블록, 남는 미사용 import)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts:603` 위 — JSDoc 한 줄: 호출자는 판매주문 V2 취소뿐(D1)
- Modify: `apps/core/src/modules/fulfillment/services/box-withdrawal.service.ts:112` 주석의 호출자 목록 — «전체 취소(판매주문 취소 → `cancelOutstanding`)»로
- Modify: `scripts/security/pii-routes.ts:64`
- Create: `apps/core/src/modules/fulfillment/controllers/removed-operator-routes.spec.ts`
- Create: `apps/core/src/modules/fulfillment/services/cancel-outstanding-callers.guard.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `removed-operator-routes.spec.ts` 의 헬퍼 `routesOf(controller: Type): string[]` — `"POST :id/cancellations"` 꼴(메서드 대문자 + 공백 + 경로). Task 2 가 같은 파일에 케이스를 더한다.

- [ ] **Step 1: 실패하는 테스트 둘**

`removed-operator-routes.spec.ts` — Nest 메타데이터(`PATH_METADATA`, `METHOD_METADATA` from `@nestjs/common/constants`, `RequestMethod`)로 컨트롤러 프로토타입의 모든 핸들러 라우트를 모은다.

```ts
describe('K6 PR4 — 판매주문 기록을 우회하던 관리자 라우트는 없다 (D1·D10·D11)', () => {
  it('ShipmentPlanningController 에 POST :id/cancellations 가 없다 (D1)', () => {
    expect(routesOf(ShipmentPlanningController)).not.toContain('POST :id/cancellations');
    // 헬퍼가 실제로 라우트를 읽는지 — 남는 라우트 하나로 확인
    expect(routesOf(ShipmentPlanningController)).toContain('GET :id');
  });
});
```

`cancel-outstanding-callers.guard.spec.ts` — `cancellation-write.guard.spec.ts` 의 `walk` 방식(`apps/core/src` 아래, `*.spec.ts`·`__support__`·`__fixtures__` 제외)으로 `/\.cancelOutstanding\(/` 를 찾는다.

```ts
it('cancelOutstanding 은 판매주문 취소만 부른다 — 운영자 라우트가 되살아나면 빨갛다 (K6 D1)', () => {
  expect(filesCalling(/\.cancelOutstanding\(/)).toEqual([
    'apps/core/src/modules/sales-order/services/sales-orders.service.ts',
  ]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/controllers/removed-operator-routes.spec.ts apps/core/src/modules/fulfillment/services/cancel-outstanding-callers.guard.spec.ts`
Expected: 라우트 spec FAIL(`POST :id/cancellations` 포함), 가드 spec FAIL(목록에 `shipment-planning.controller.ts` 포함)

- [ ] **Step 3: 컨트롤러 핸들러·`pii-routes.ts:64` 삭제, 주석 둘 갱신**

- [ ] **Step 4: 통과 확인 + 영향 spec**

Run: `npx jest apps/core/src/modules/fulfillment scripts/security libs/authorization`
Expected: PASS. 컨트롤러 핸들러를 직접 부르던 spec(`shipment-planning.controller.spec.ts`, `outbound-v2-authorization.spec.ts`)이 깨지면 그 케이스를 지운다 — 서비스 `cancelOutstanding` 을 부르는 spec(`shipment-planning.service.spec.ts:127` 등)은 그대로 둔다.

- [ ] **Step 5: 통합 회귀(판매주문 V2 취소 경로)**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts apps/core/src/modules/fulfillment/services/outbound-v2-scenarios.integration.spec.ts apps/core/src/modules/sales-order/line-quantities/line-quantities.integration.spec.ts`
(스크래치 DB `k6_it` 재사용. 브랜치 시작 때 `DATABASE_URL=…/k6_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts` 로 develop 마이그를 따라잡고, 같은 세 파일을 한 번 돌려 기준선 실패를 scratchpad 에 둔다 — «새 실패 0» 은 그 대비.)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment scripts/security/pii-routes.ts
git commit -m "feat(core): 운영자 «미처리 취소» 라우트를 지운다 — 상자 미처리분은 판매주문 취소로만 줄어든다 (K6 D1)"
```

---

### Task 2: FO 취소·수동 배송완료 라우트와 서비스 메서드 제거 (D10·D11)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/controllers/fulfillments.controller.ts:~56-115` (`deliver`·`cancel` 핸들러와 각자의 `@PiiResponse` 블록)
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` — `markDelivered`(:592-650), `cancel`(:659-705) 삭제; `computeAdminAvailableActions`(:711) 에서 `'cancel'`·`'deliver'` 제거; 남는 미사용 import(`FulfillmentDeliveredPayload`·`FulfillmentCancelledPayload` 등)
- Modify: `apps/core/src/modules/fulfillment/dto/fulfillment-order-response.dto.ts:249` — `adminAvailableActions` 의 Swagger 설명/예시에 `cancel`·`deliver` 가 있으면 뺀다
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts` — `markDelivered guard`(:874), `legacy markDelivered`(:888), sweep 의 markDelivered 케이스(:929), `service.cancel`(:967) 케이스 삭제; `computeAdminAvailableActions` 단언 갱신
- Modify: `scripts/security/pii-routes.ts:58-59`
- Modify: `apps/core/src/modules/fulfillment/controllers/removed-operator-routes.spec.ts` (Task 1)

**Interfaces:**
- Consumes: Task 1 의 `routesOf(controller)`
- Produces: `FulfillmentsService` 에 `markDelivered`·`cancel` 없음. `FULFILLMENT_EVENTS.CANCELLED` 의 core 안 사용처 0(Task 3 이 키를 지운다).

- [ ] **Step 1: 실패하는 테스트**

`removed-operator-routes.spec.ts` 에 추가:

```ts
it('FulfillmentsController 에 POST :id/cancel·POST :id/deliver 가 없다 (D10·D11)', () => {
  const routes = routesOf(FulfillmentsController);
  expect(routes).not.toContain('POST :id/cancel');
  expect(routes).not.toContain('POST :id/deliver');
  expect(routes).toContain('GET :id/outbox-events');
});
```

`fulfillments.service.spec.ts` 의 `computeAdminAvailableActions` describe 를 이 단언으로 갱신(기존 케이스의 FO 모양 재사용):
- 진행 중 일반 FO → `[]`
- `shipped` FO → `[]`
- 직배 FO `directShipStatus: null` → `['forwardDropShip']`, `'forwarded'` → `['completeDropShip']`

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/controllers/removed-operator-routes.spec.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts`
Expected: FAIL(라우트 존재, 액션 목록에 `cancel`/`deliver`)

- [ ] **Step 3: 핸들러·메서드·액션·`pii-routes.ts:58-59` 삭제, 옛 메서드 spec 케이스 삭제**

`workflowGate` 의 연산 이름 `'fulfillment.mark_delivered'`·`'fulfillment.cancel'` 은 이 두 메서드에서만 쓰인다 — 게이트 쪽 목록에 등록돼 있으면 같이 지운다(`grep -rn "fulfillment.mark_delivered\|'fulfillment.cancel'" apps libs`).

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment scripts/security libs/authorization && npm run type-check`
Expected: PASS, type-check 에러 0

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment scripts/security/pii-routes.ts
git commit -m "feat(core): FO 취소·수동 배송완료 라우트를 지운다 — 취소는 주문으로, 배송은 추적으로만 (K6 D10·D11)"
```

---

### Task 3: `FulfillmentCancelled` 계약·소비자 삭제 + ADR·문서

**Files:**
- Modify: `packages/event-contracts/streams/fulfillments.stream.ts` — `FulfillmentCancelledPayload`(:114), `FulfillmentCancelledSchema`(:216), `events.FulfillmentCancelled`(:273), `FulfillmentEventTypes.CANCELLED`(:292) 삭제
- Modify: `apps/core/src/modules/fulfillment/events.ts:29` — `FULFILLMENT_EVENTS.CANCELLED` 삭제
- Modify: `apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts:112-135` — `handleFulfillmentCancelled` 삭제, 파일 머리 주석에 «`FulfillmentCancelled` 는 K6 PR4 에서 생산자(FO 취소)와 함께 지워졌다» 한 줄
- Modify: 그 소비자의 spec(있으면 — `grep -rln handleFulfillmentCancelled apps/channel-adapter`)
- Modify: `apps/ugc-service/src/reviews/rewards/order-cancellation.consumer.ts:11` 주석 — `FulfillmentCancelled` 는 이제 계약에도 없다
- Modify: `docs/event-specifications.md` — `FulfillmentCancelled` 절 삭제 또는 «K6 PR4 에서 제거» 표시
- Modify: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md:143` — PR 4 를 «(이 PR)»로, 실제 결정(아래 Step 3) 반영

**Interfaces:**
- Consumes: Task 2 — core 안 `FulfillmentCancelled` 생산자 0
- Produces: 저장소 어디에도 `FulfillmentCancelled` 문자열이 남지 않는다(예외: admin-web `history-tab.tsx:47` 라벨, 과거 문서·계획 파일).

- [ ] **Step 1: 실패하는 테스트**

channel-adapter 소비자 spec(없으면 `fulfillment-events.consumer.spec.ts` 생성)에:

```ts
it('FULFILLMENT_STREAM 핸들러는 Shipped·Delivered 둘뿐이다 — FulfillmentCancelled 는 계약째 지워졌다 (K6 D11)', () => {
  const handled = handlersOf(FulfillmentEventsConsumer); // @On 메타데이터에서 eventType 목록
  expect(handled.sort()).toEqual(['FulfillmentDelivered', 'FulfillmentShipped']);
});
```

`@On` 이 남기는 메타데이터 키는 `libs/events/src/consumers/decorators.ts` 에서 확인해 `handlersOf` 를 쓴다. 기존 핸들러가 둘 외에 더 있으면 실제 목록으로 고정한다.

계약 쪽:

```ts
it('FULFILLMENT_STREAM 에 FulfillmentCancelled 가 없다', () => {
  expect(Object.keys(FULFILLMENT_STREAM.events)).not.toContain('FulfillmentCancelled');
});
```
(같은 spec 파일에 둔다.)

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/consumers`
Expected: FAIL

- [ ] **Step 3: 계약·상수·핸들러 삭제, 주석·문서·ADR 갱신**

ADR-0047 PR 4 항목에 적을 것:
- 세 라우트·admin-web 버튼·훅 삭제. `cancelOutstanding` 은 판매주문 V2 취소의 내부 단계로 남고 가드가 호출자를 고정.
- `FulfillmentCancelled` 는 유일한 생산자(FO 취소)와 함께 계약에서 삭제, 소비자는 no-op 이었다.
- `FulfillmentDelivered` 는 추적 경로가 계속 발행해 남는다. FO `completed` 는 새로 만들어지지 않는다(유일한 작성자가 `markDelivered`) — enum 값은 남긴다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter packages apps/ugc-service && npm run type-check && grep -rn "FulfillmentCancelled" apps libs packages --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: jest PASS, type-check 0, grep 결과는 `history-tab.tsx:47` 한 줄뿐

- [ ] **Step 5: Commit**

```bash
git add packages/event-contracts apps/core/src/modules/fulfillment/events.ts apps/channel-adapter apps/ugc-service docs
git commit -m "feat(events): 생산자가 사라진 FulfillmentCancelled 를 계약·소비자째 지운다 (K6 PR4)"
```

---

### Task 4: admin-web 버튼·훅·클라이언트 제거

**Files:**
- Modify: `apps/admin-web/src/features/order/fulfillments/detail/shipment-actions.tsx` — `Action` 유니온의 `'cancel'`(:54), 라벨(:68), `useCancelShipmentOutstanding` 사용(:32, :109, :143), 제출 갈래(:290-~330), 버튼(:386-~395), 공유 조건(:436 `action === 'split' || action === 'cancel'` → `action === 'split'`, :598)
- Modify: `apps/admin-web/src/features/order/fulfillments/components/detail/index.tsx` — `useCancelFulfillment`·`canCancel`·`handleCancel`·취소 버튼, 그것만 쓰던 `TERMINAL_STATUSES`/import
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts` — `useCancelShipmentOutstanding`(:544-565), `useDeliverFulfillment`(:924-933), `useCancelFulfillment`(:935-948)
- Modify: `apps/admin-web/src/lib/services/orders/index.ts:81,86,118` — 재수출
- Modify: `apps/admin-web/src/lib/api/domains/orders/fulfillment-order.client.ts` — `cancelShipmentOutstanding`(:145-~160), FO 취소(:212-~220), 배송완료 메서드(있으면)
- Modify: `apps/admin-web/src/lib/services/orders/operation-policy.ts` — `FulfillmentAdminAction` 의 `'cancelOutstanding'`, `ACTION_SCOPE.cancelOutstanding`
- Modify: `apps/admin-web/src/lib/services/orders/operation-policy.spec.ts`, `apps/admin-web/src/features/order/fulfillments/detail/operation-ui.spec.ts` — `cancelOutstanding` 케이스
- Modify: 남는 DTO 타입(요청 타입 `CancelShipmentOutstanding*` 등)이 다른 곳에서 안 쓰이면 삭제

**Interfaces:**
- Consumes: 없음(백엔드 변경과 독립)
- Produces: admin-web 에 세 라우트를 부르는 코드 0

- [ ] **Step 1: 실패하는 테스트**

`operation-policy.spec.ts` 에:

```ts
it('미처리 취소는 화면 액션이 아니다 (K6 D1)', () => {
  // @ts-expect-error — 'cancelOutstanding' 은 FulfillmentAdminAction 에서 빠졌다
  canShowFulfillmentAction('cancelOutstanding', ['fulfillment.warehouse.operate']);
});
```
(`@ts-expect-error` 가 «쓸모없는 지시문»이 되면 tsc 가 빨갛다 — 런타임 단언이 아니라 타입 단언이다. admin-web tsc 는 `npm run test:admin-web` 과 별개로 돌린다.)

admin-web 은 컴포넌트 테스트를 못 돌리므로(순수 함수로 판정) 화면 제거는 Step 4 의 grep 으로 확인한다.

- [ ] **Step 2: 실패 확인**

Run: `(cd apps/admin-web && npx tsc --noEmit -p .)`
Expected: FAIL — `Unused '@ts-expect-error' directive`

- [ ] **Step 3: 화면·훅·클라이언트·정책 삭제**

- [ ] **Step 4: 통과 확인**

Run: `(cd apps/admin-web && npx tsc --noEmit -p .) && npm run test:admin-web && grep -rn -E "/cancellations\`|/fulfillments/.*/(cancel|deliver)\b|useCancelFulfillment|useDeliverFulfillment|useCancelShipmentOutstanding|cancelOutstanding" apps/admin-web/src | grep -v membership`
Expected: tsc 0, test PASS(`mutation-guard.gate.spec.ts`·`screen-access.gate.spec.ts` 포함), grep 결과 없음

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web
git commit -m "feat(admin-web): «미처리 수량 취소»·FO 취소 버튼과 훅을 지운다 (K6 D1·D11, D10 훅)"
```

---

## 전체 게이트 (마지막 태스크 뒤)

- `npm run type-check` — 0 (워크트리 환경 에러 web-push·tauri 3건은 기준선)
- `npx jest --maxWorkers=2` — 실패 0
- `npm run test:admin-web` — 실패 0
- PR 본문에 «배포» 절(위 G1~G3 확정 SQL, 배포 단위 Core·channel-adapter·admin-web, 마이그 없음)

**곁에서 찾은 것(이 PR 밖):** `FulfillmentReturned` 도 생산자 0 인 채 계약에 남아 있다(`ugc order-cancellation.consumer.ts:11` 이 2026-09-08 에 실측). 같은 방식으로 지울 수 있으나 K6 범위가 아니다.

## 최종 리뷰 뒤 추가 (Task 5, 사용자 결정 2026-10-22)

최종 리뷰 Important 1: 판매주문 없는 수동 FO 는 D1·D11 뒤 되돌릴 길이 없다. 사용자 결정 (c) — 만들지 않는다.
- core `FulfillmentsService.createV2` 첫머리에서 `salesOrderId` 없으면 400 `FULFILLMENT_REQUIRES_SALES_ORDER`, `items`·`lines` 는 트랜잭션 전에 `SALES_ORDER_ITEMS_DERIVED_FROM_MATCHING`. items·lines 갈래와 사전 점검의 items 분기 삭제.
- admin-web «출고주문 생성 (수동)» 메뉴·라우트·화면 권한 줄·폼·`useCreateFulfillmentOrder`·`createStandalone`·죽은 `fulfillments.client.create` 와 요청 타입 삭제.
- 테스트: `fulfillments.service.spec.ts` «salesOrderId 없는 출고주문은 만들지 않는다» (items·lines·빈 요청).

