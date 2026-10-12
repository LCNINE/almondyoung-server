# 채널 주문 취소 PR-D — core → Medusa 취소 역투영 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** channel-adapter 가 core `SalesOrderCancelled` 를 받아 Medusa 주문을 취소하던 역투영(`CoreOrderCancelled` 인박스)을 지운다 — 채널 주문 취소는 이제 `CancelChannelOrder` 명령 하나로만 채널에 간다.

**Architecture:** 지우는 것은 두 조각이다. ① `FulfillmentEventsConsumer.handleCoreOrderCancelled`(Kafka `core.orders.events.v1` 구독 → 인박스 적재) ② `InboxWorkerService` 의 `CoreOrderCancelled` 분기(인박스 → `medusaClient.cancelOrder` / 마켓은 `manual_adjustment_required` 행). 이 앱에서 `core.orders.events.v1` 을 구독하는 `@On` 은 ①뿐이라, 지우면 channel-adapter 컨슈머 그룹이 그 토픽 구독 자체를 멈춘다(구독은 `@On` 에서 도출 — ADR-0029 §3). 되돌아오지 않게 가드 스펙 하나를 둔다.

**Tech Stack:** NestJS, `@app/events`(`@On`), Drizzle, Jest.

**Spec:** `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` §8(지우는 것)·§9-9(메아리)·§11(배포). 결정 기록 `docs/adr/0042-channel-order-cancel-is-initiated-by-the-channel.md`.

## 선행조건 (확인됨)

- **PR-C(#1026, `b96ac7f04`)가 라이브에 배포됐다** — 사용자 확인 2026-10-07. expand-contract 의 «사이에 배포 한 번»이 채워졌다(스펙 §11).
- **라이브 `CoreOrderCancelled` 인박스 `failed` = 0** — 2026-10-07 사용자 실행(published 153, pending·processing·failed 0). 스펙 §11 «PR-D 전 라이브 확인» 통과.

## 왜 지워도 Medusa 취소가 빠지지 않는가 (계획 단계 확인, 2026-10-07)

core 에서 `SalesOrderCancelled` 를 내는 `salesOrders.cancel(...)` 호출자는 넷뿐이다:

| 호출자 | Medusa 주문일 때 |
| --- | --- |
| `order-events.consumer.ts` `handleOrderCancelled` | 채널(Medusa)이 이미 취소한 것을 수집한 것 |
| `channel-cancel-request/channel-cancel-settler.ts` | 위 수집이 열린 요청을 닫는 것 — 역시 Medusa 가 먼저 |
| `channel-order-change/channel-order-change.manager.ts` `tryDecrease` | 채널 수정 수집(`cancelledBy: 'channel'`) — 채널이 먼저 |
| `store-sales-orders.service.ts` `adminCancelRequest` | `channelCancelRoute` 가 `'core'` 일 때만(medusa 는 `'command'`, 마켓은 `'seller_center'` 로 400) |

고객 취소(`processCancelRequest`)·wallet 환불 승인(`cancelByWalletIntentAfterRefund`)은 PR-C 에서 요청 경로로 옮겨 `salesOrders.cancel` 을 직접 부르지 않는다. 즉 **PR-C 이후 Medusa 주문의 `SalesOrderCancelled(full)` 는 전부 «Medusa 가 이미 취소됨» 의 메아리**다 — 역투영은 지금 `already_cancelled` 로 건너뛰는 일만 한다(스펙 §9-9).

## 동작 변화 (PR 본문에 옮길 것)

1. **channel-adapter 컨슈머 그룹이 `core.orders.events.v1` 구독을 멈춘다.** consumer lag 폴러는 선언된 토픽에서 대상을 도출하므로(`libs/events/src/consumers/consumer-lag.collector.ts`) 그 토픽의 lag 시리즈도 새 태스크에서 사라진다. 그 토픽의 남은 소비자는 ugc-service(`reviews/rewards/order-cancellation.consumer.ts`)다.
2. **마켓(네이버·쿠팡) 전체취소가 `channel_dispatch_operations` 에 `operation='cancel'`·`manual_adjustment_required` 행을 더는 만들지 않는다.** PR-C 이후 그 행은 «채널이 이미 취소한 주문»에만 찍히던 거짓 «수동 조정 필요»였다(운영자·고객 취소는 core 가 판매자센터 안내로 400). 옛 행은 그대로 남고 admin-web 출고 상세에 계속 보인다.
3. **배포 순간 남은 `CoreOrderCancelled` 인박스 행은 영원히 `pending`/`processing` 으로 남는다** — 새 워커의 claim 쿼리가 그 타입을 고르지 않는다. 위 표대로 전부 «이미 취소됨» 이라 처리해도 할 일이 없었다. 배포 뒤 개수만 센다(아래 «배포 뒤»).

## Global Constraints

- **`apps/medusa`·`apps/core`·`packages/event-contracts` 의 동작은 바꾸지 않는다.** contracts 는 주석 한 곳만(Task 3).
- `SalesOrderCancelled` 이벤트·스키마는 **남긴다** — ugc-service 가 소비한다.
- `channel_dispatch_operations` 스키마·`'cancel'` operation 값·admin-web 표시는 **남긴다** — 옛 행이 있다.
- `MedusaClient.cancelOrder` 는 **남긴다** — `services/order-cancel/channel-order-cancel.manager.ts` 가 쓴다.
- 마이그레이션 없음. 배포 순서 제약 없음(channel-adapter 단독).
- ⚠️ `inbox-worker.service.ts` 는 develop 부터 prettier 불통이다. **`npx prettier --write` 를 그 파일에 돌리지 말 것** — 지운 줄 말고 수백 줄이 diff 에 섞인다. 린트는 `npx eslint <파일>`(no `--fix`)로 본다.
- 응답·주석·커밋 메시지는 한국어.
- 게이트: `npm run type-check` 0 · `npx jest` 0(전체가 OOM 이면 `--maxWorkers=2`).

## Review Focus

1. **배포 롤링 중 옛 태스크가 적재한 `CoreOrderCancelled` 행** — 새 태스크가 집지 않아 `pending` 으로 남는다. 기대: 아무 일도 안 일어남(Medusa 는 이미 취소됨). Task 2 의 claim 쿼리 테스트가 «그 타입을 고르지 않음» 을 고정한다.
2. **누군가 «core 취소를 채널에 알리자» 며 `SalesOrderCancelled` 구독을 다시 붙임** — 기대: 메아리(채널 변경이 채널로 되돌아감)가 재발하지 않게 가드 스펙이 빨개진다. Task 1 의 가드가 고정한다.
3. **3pl 등 `'core'` 경로 주문의 취소** — 매핑이 우연히 있어도 채널에 아무것도 가지 않는다(전에는 `manual_adjustment_required` 행). 기대: core 취소·wallet 환불만. 코드 삭제로 성립하므로 별도 테스트 없음 — 위 표가 근거다.
4. **lag 대시보드에서 `channel-adapter-*` × `core.orders.events.v1` 시리즈가 끊김** — 기대: 장애가 아니라 구독 종료. PR 본문 «동작 변화 1» 로 알린다(코드 테스트 대상 아님).
5. **`CoreFulfillmentShipped`/`Delivered` 분기가 같은 파일에서 함께 깨짐** — 기대: 그대로 동작. Task 2 는 기존 `V1 Medusa compatibility projection` 의 shipped/delivered 테스트 둘을 남기고 돌린다.

---

### Task 1: `SalesOrderCancelled` 구독 제거 + 메아리 가드

**Files:**
- Modify: `apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts` (`handleCoreOrderCancelled` 와 그 문서 주석 135–195행, `CORE_ORDER_STREAM` import 18행)
- Modify: `apps/channel-adapter/src/consumers/fulfillment-events.consumer.spec.ts` (`describe('FulfillmentEventsConsumer.handleCoreOrderCancelled'` 96–135행, `BASE_PAYLOAD`·`makeService`·`SalesOrderCancelledPayload` import)
- Modify: `apps/channel-adapter/src/main.ts:84-87` (주석)
- Modify: `apps/channel-adapter/CLAUDE.md:128` (구독 표의 `core.orders.events.v1` 행)

**Interfaces:**
- Consumes: 없음
- Produces: `FulfillmentEventsConsumer` 에서 `handleCoreOrderCancelled` 메서드가 사라진다. Task 2 는 이것에 의존하지 않는다(인박스 행 타입 문자열만 공유).

- [ ] **Step 1: 가드 스펙을 먼저 쓴다 (실패해야 한다)**

`fulfillment-events.consumer.spec.ts` 에서 `describe('FulfillmentEventsConsumer.handleCoreOrderCancelled', ...)` 블록 전체(96–135행)를 아래로 **바꾼다**. 파일 맨 위 import 에 `fs`·`path` 를 더한다.

```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
```

```ts
/**
 * core 의 취소를 채널에 되돌려 보내던 역투영을 지웠다(#1016 35번 PR-D, ADR-0042).
 * 채널 쪽 취소는 `CancelChannelOrder` 명령만 낸다 — core 의 취소 «사실» 을 구독해 채널을 부르면
 * 채널이 먼저 한 취소·수정이 채널로 되돌아간다(스펙 §9-9 메아리).
 */
describe('channel-adapter 는 core 의 SalesOrderCancelled 를 구독하지 않는다', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
  }

  it('어느 소스도 SalesOrderCancelled 를 핸들러로 걸지 않는다', () => {
    const srcRoot = join(__dirname, '..');
    const offenders = sourceFiles(srcRoot).filter((file) => /'SalesOrderCancelled'/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('CoreOrderCancelled 인박스 행을 적재하는 소스가 없다', () => {
    const srcRoot = join(__dirname, '..');
    const offenders = sourceFiles(srcRoot).filter((file) =>
      /eventType:\s*'CoreOrderCancelled'/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
```

같은 파일에서 이제 쓰이지 않는 것을 지운다:
- `BASE_PAYLOAD` 상수(25–33행)
- `makeService` 함수(37–45행) — `makeServiceWithAdapter` 는 shipped/delivered 테스트가 쓰므로 남긴다
- import 의 `SalesOrderCancelledPayload`

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/consumers/fulfillment-events.consumer.spec.ts`
Expected: 새 describe 의 두 테스트가 FAIL — 첫째는 `offenders` 에 `.../consumers/fulfillment-events.consumer.ts`, 둘째도 같은 파일. shipped/delivered 테스트는 PASS.

- [ ] **Step 3: 핸들러를 지운다**

`fulfillment-events.consumer.ts` 에서:
- 135행의 `/** * Core SalesOrderCancelled 핸들러 ...` 문서 주석부터 `handleCoreOrderCancelled` 메서드 끝(195행 `}`)까지 통째로 지운다. 클래스를 닫는 `}` 는 남긴다.
- 18행 `import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams/orders.stream';` 를 지운다.
- `handleFulfillmentCancelled` 의 문서 주석(113–118행)에서 «주문 취소 projection은 SalesOrderCancelled의 단일 채널 경로가 담당한다.» 를 아래로 바꾼다:

```ts
  /**
   * 이행 취소 이벤트 핸들러
   *
   * V1 fulfillment cancellation은 외부 채널 명령을 소유하지 않는다.
   * 채널 주문 취소는 core 가 `CancelChannelOrder` 명령으로만 요청한다(ADR-0042).
   */
```

`'SalesOrderCancelled'` 가 이 파일에 남지 않았는지 본다:

Run: `grep -n "SalesOrderCancelled\|CoreOrderCancelled\|CORE_ORDER_STREAM" apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts`
Expected: 출력 없음

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/consumers/fulfillment-events.consumer.spec.ts`
Expected: 첫 가드 테스트 PASS. **둘째 가드(`CoreOrderCancelled` 적재)도 PASS** — 적재는 이 파일에만 있었다(인박스 워커는 `case 'CoreOrderCancelled'` 로 읽기만 하므로 `eventType: '…'` 패턴에 안 걸린다). shipped/delivered PASS.

- [ ] **Step 5: 주석·문서를 고친다**

`apps/channel-adapter/src/main.ts:84-87` 의 주석을 아래로 바꾼다(`core.orders.events.v1` 을 더는 구독하지 않는다):

```ts
    // 구독 목록 인자가 없다 — 소비 집합은 컨트롤러의 `@On` 에서 도출된다 (ADR-0029 §3).
    // 예전 이 자리의 `streams` 6개 목록은 실제 구독과 무관했다: 이 앱의 핸들러는
    // `users.events.v1` · `payments.events.v1` 도 구독한다.
    // 도출된 토픽 전량은 startConsumer 가 로그로 찍는다.
```

`apps/channel-adapter/CLAUDE.md` 의 «구독하는 Kafka 스트림 (Inbound)» 표에서 아래 행을 지운다:

```
| `core.orders.events.v1` | `SalesOrderCancelled` (cancellationScope=full 만) | Inbox → Medusa 주문 취소 동기화 |
```

- [ ] **Step 6: 타입·린트**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx eslint apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts apps/channel-adapter/src/consumers/fulfillment-events.consumer.spec.ts apps/channel-adapter/src/main.ts`
Expected: 에러 0 (경고는 이 PR 이 만든 것만 고친다)

- [ ] **Step 7: Commit**

```bash
git add apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts apps/channel-adapter/src/consumers/fulfillment-events.consumer.spec.ts apps/channel-adapter/src/main.ts apps/channel-adapter/CLAUDE.md
git commit -m "refactor(channel-adapter): core SalesOrderCancelled 구독을 지운다 — 채널 취소는 명령으로만, 메아리 가드 (#1016 35번 PR-D)"
```

---

### Task 2: 인박스 워커의 `CoreOrderCancelled` 분기 제거

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts` (`INBOX_WORKER_EVENT_TYPES` 51행, `case 'CoreOrderCancelled'` 572–636행, import 4행·30–33행)
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts` (407행 기대값, 751–910행의 취소 테스트 넷 + `cancelService` 헬퍼, 5행 `MedusaHttpError` import)

**Interfaces:**
- Consumes: Task 1 과 독립(같은 PR 로 배포된다)
- Produces: `INBOX_WORKER_EVENT_TYPES` 에서 `'CoreOrderCancelled'` 가 빠진다 → `InboxWorkerEventType` 유니온에서도 빠진다.

- [ ] **Step 1: claim 쿼리 기대를 뒤집는다 (실패해야 한다)**

`inbox-worker.service.spec.ts` 의 `'renders the atomic claim query with an IN list instead of an invalid ANY row cast'` 테스트(396행 근처)에서

```ts
    expect(claimSql.params).toContain('CoreOrderCancelled');
```

를 아래로 바꾼다:

```ts
    // 역투영 제거(#1016 35번 PR-D) — 배포 순간 남은 CoreOrderCancelled 행은 집지 않는다(전부 «이미 취소됨» 메아리).
    expect(claimSql.params).not.toContain('CoreOrderCancelled');
    expect(claimSql.params).toContain('CoreFulfillmentShipped');
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts -t "renders the atomic claim query"`
Expected: FAIL — `expect(received).not.toContain(expected)` / `'CoreOrderCancelled'`

- [ ] **Step 3: 분기를 지운다**

`inbox-worker.service.ts` 에서:

1. `INBOX_WORKER_EVENT_TYPES` 배열에서 `'CoreOrderCancelled',` 한 줄(51행)을 지운다.
2. `switch (eventType)` 안의 `case 'CoreOrderCancelled': { ... break; }` 블록(572행 `case` 부터 636행 닫는 `}` 까지)을 통째로 지운다. 바로 뒤 `default: throw new Error(\`Unsupported inbox event type: ...\`)` 는 남긴다.
3. 이제 안 쓰는 import 를 지운다 — 먼저 확인:

Run: `grep -n "channelDispatchOperations\|getChannelFulfillmentCapabilities\|ShipmentSalesChannel" apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts`
Expected: import 줄(4행, 31–32행)만 나온다

그러면 4행을

```ts
import { inboxEvents, wmsOrderMappings } from '../../schema';
```

로, 30–33행의

```ts
import {
  getChannelFulfillmentCapabilities,
  type ShipmentSalesChannel,
} from '../../services/channel-capabilities';
```

를 통째로 지운다. `wmsOrderMappings`·`withMedusaOrderProjectionLock` 은 shipped/delivered 분기가 쓰므로 남는다.

Run: `grep -n "CoreOrderCancelled\|PR-D\|역투영" apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts`
Expected: 출력 없음

- [ ] **Step 4: 죽은 테스트를 지운다**

`inbox-worker.service.spec.ts` 의 `describe('InboxWorkerService V1 Medusa compatibility projection', ...)` 안에서 아래를 지운다(shipped/delivered 테스트 둘 — `uses the verified Medusa mapping ...`(637행), `takes the shared PostgreSQL order lock ...`(694행) — 은 남긴다):

- 749–750행의 회귀 주석 두 줄과 `it('looks up the mapping by channelOrderId, not wmsOrderId', ...)`(751–797행)
- `function cancelService(cancelOrder: jest.Mock) { ... }`(799–830행 근처)
- `it.each([...])('옛 역투영은 $kind 를 지금처럼 건너뛴다(published) — PR-D 까지 동작 불변', ...)`
- `it('옛 역투영은 Medusa 5xx 를 지금처럼 실패로 둔다 — ...', ...)`
- `it('persists non-Medusa cancellation as a durable manual channel operation', ...)`(851–909행)

describe 를 닫는 `});`(910행)는 남긴다. 그다음 5행 import 가 남은 데가 있는지 본다:

Run: `grep -n "MedusaHttpError\|CoreOrderCancelled\|cancelOrder" apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`
Expected: 5행 `import { MedusaHttpError } from './medusa.client';` 와 Step 1 에서 쓴 `not.toContain('CoreOrderCancelled')` 줄만 나온다 → 5행 import 를 지운다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`
Expected: 전부 PASS. 특히 `V1 Medusa compatibility projection` 의 테스트 2개(shipped 매핑·delivered 잠금)가 PASS — Review Focus 5.

- [ ] **Step 6: channel-adapter 전체·타입·린트**

Run: `npx jest apps/channel-adapter`
Expected: 실패 0. (`shipment-dispatch-persistence.integration.spec.ts:105` 의 `'CoreOrderCancelled'` 는 FK 를 채우는 임의 문자열이고 `describeIfDb` 라 기본 실행에서 skip — 손대지 않는다.)

Run: `npm run type-check`
Expected: 에러 0

Run: `npx eslint apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts`
Expected: 에러 0. **prettier 는 돌리지 않는다**(Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts
git commit -m "refactor(channel-adapter): 인박스 CoreOrderCancelled 분기를 지운다 — Medusa 취소 역투영 끝 (#1016 35번 PR-D)"
```

---

### Task 3: 계약 주석·스펙 상태 갱신 + 전체 게이트

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts:424-440` (`SalesOrderCancelledPayload` 문서 주석)
- Modify: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` §8 첫 항목, §11 표 D 행

**Interfaces:**
- Consumes: Task 1·2 완료(지운 뒤의 사실을 적는다)
- Produces: 없음(주석·문서)

- [ ] **Step 1: 계약 주석을 사실에 맞춘다**

`orders.stream.ts` 의 `SalesOrderCancelledPayload` 위 주석(424–430행)을 아래로 바꾼다:

```ts
/**
 * Core 주문 취소 완료 사실
 *
 * orders.events.v1 / OrderCancelled 는 외부 채널(Medusa/Naver/Coupang) → Core 인바운드 이벤트.
 * 이 타입은 Core 가 취소를 반영한 뒤 내는 아웃바운드 사실이다. 소비자: ugc-service(리뷰 적립 회수).
 * 채널에 취소를 «요청»하는 것은 이 사실이 아니라 `CancelChannelOrder` 명령이다(ADR-0042) —
 * 이 사실을 구독해 채널을 부르면 채널이 먼저 한 취소가 채널로 되돌아간다.
 * 스트림: core.orders.events.v1
 */
```

같은 인터페이스의 `cancellationScope` 주석(440행)

```ts
  /** full: 전체취소 → Medusa cancelOrder 동기화 대상. partial: 부분취소 → Medusa 동기화 제외. */
```

을 아래로 바꾼다:

```ts
  /** full: 전체취소. partial: 부분취소(`cancelledLines` 에 줄). */
```

`channelOrderId` 주석의 «채널어댑터가 wms_order_mappings를 조회할 때 사용한다» 도 지운다(소비자가 없다):

```ts
  /** Core SalesOrder.channelOrderId (Medusa: 'order_xxx', Naver/Coupang: 채널 주문번호). */
  channelOrderId?: string;
```

- [ ] **Step 2: 스펙에 PR-D 완료를 적는다**

`2026-10-07-channel-order-cancel-design.md` §8 첫 항목을 아래로 바꾼다:

```markdown
- **core → Medusa 취소 역투영**: `fulfillment-events.consumer.ts` `handleCoreOrderCancelled` 와 `inbox-worker.service.ts`
  `CoreOrderCancelled` 분기. **PR-D 에서 지웠다**(§11) — channel-adapter 는 `core.orders.events.v1` 구독을 멈췄고,
  가드 스펙(`fulfillment-events.consumer.spec.ts`)이 `SalesOrderCancelled` 구독의 재등장을 막는다. 배포 순간 남은
  `CoreOrderCancelled` 인박스 행은 집지 않는다 — PR-C 이후 그 행은 전부 «Medusa 가 이미 취소됨» 의 메아리였다
```

§11 표의 D 행 «배포 직후» 칸을 아래로 바꾼다:

```markdown
| **D** channel-adapter | 역투영 제거 | **C 배포가 끝난 뒤**(expand-contract — 사이에 배포 한 번). 직후 마켓 전체취소의 `manual_adjustment_required` 행이 더 안 생긴다(PR-C 이후엔 거짓 경보였다) |
```

- [ ] **Step 3: 전체 게이트**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest --maxWorkers=2`
Expected: 실패 0

Run: `git diff origin/develop --stat -- apps/medusa apps/core`
Expected: 출력 없음(Global Constraints — 두 앱은 건드리지 않는다)

Run: `grep -rn "CoreOrderCancelled\|handleCoreOrderCancelled" apps packages libs --include=*.ts | grep -v node_modules`
Expected: `.spec.ts` 파일만 나온다 — `fulfillment-events.consumer.spec.ts`(가드), `inbox-worker.service.spec.ts`(`not.toContain` 과 그 주석), `shipment-dispatch-persistence.integration.spec.ts:105`(FK 픽스처). 비-spec 파일이 하나라도 나오면 지우다 만 것이다

- [ ] **Step 4: Commit**

```bash
git add packages/event-contracts/streams/orders.stream.ts docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md
git commit -m "docs: SalesOrderCancelled 소비자는 ugc-service 뿐, 스펙에 PR-D 완료 반영 (#1016 35번 PR-D)"
```

---

## 머지·배포 뒤 (사람 작업 — 태스크 아님)

- **배포 확인:** channel-adapter ECS 서비스의 task definition `registeredAt` 이 머지 뒤인지 본다(헬스 응답엔 커밋이 없다).
- **남은 인박스 행 세기**(읽기 전용, `sst shell --stage live`, 사람이 실행):

  ```sql
  -- channel_adapter
  select status, count(*), min(created_at), max(created_at)
    from inbox_events where event_type = 'CoreOrderCancelled' group by 1;
  ```

  `pending`/`processing` 이 있으면 롤링 창에서 옛 태스크가 적재하고 처리 못 한 메아리다. 그대로 둬도 무해하다.
- **#1016 35번 행** 해결 칸에 PR-D 커밋 해시를 적고(행마다 커밋 해시·문서 경로만), 감사 아티팩트를 재게시한다.

## 이 PR 이 하지 않는 것

- **published 153건의 Medusa 실제 상태 대조**(옛 `cancelOrder` 가 400 을 성공으로 삼켰다). 역투영을 지워도 이 대조의 길은 닫히지 않는다 — 다시 돌려도 같은 400 이 나왔을 것이고, 스펙 §11 의 정리 경로(§6.4 로 wallet 환불을 Medusa 장부에 넣고 → Medusa 취소)는 역투영과 무관한 별도 스크립트다. 하려면 별도 작업으로.
- `adapter.module.ts` 의 `publishes`·`NO_KAFKA_PUBLISHER_STREAMS` 에 있는 `CORE_ORDER_STREAM` — 발행 DI 목록이라 구독과 무관하다. 손대지 않는다.
- ADR-0040·0042 본문 — ADR-0042 가 이미 «역투영을 없앤다» 로 결정을 적었다.
