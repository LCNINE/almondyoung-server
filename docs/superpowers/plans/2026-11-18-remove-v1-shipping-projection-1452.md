# #1452 옛 주문 단위 배송 투영 삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** channel-adapter 에서 한 번도 성공하지 않은 옛 투영(`FulfillmentShipped/Delivered` → inbox `CoreFulfillment*` → Medusa 최상위 `coreTrackingNumber` 등)을 지우고, 시도별 투영의 동작은 그대로 둔다.

**Architecture:** 순수 삭제 두 걸음. ① 입구(소비자·모듈 등록·inbox allowlist·두 `case`·문서 줄)를 지운다. ② 호출자가 사라진 `MedusaClient.updateOrderShippingProjection` 을 지우고 `mergeCoreShippingStatus` 의 v1 갈래를 걷어낸다. 시도별 투영 동작은 기존 테스트 두 개가 고정한다.

**Tech Stack:** NestJS, `@app/events`, drizzle, Jest.

**Spec:** `docs/superpowers/specs/2026-11-18-remove-v1-shipping-projection-1452-design.md`

## Global Constraints

- core 의 `fulfillments.events.v1` 생산자·계약(`packages/event-contracts/streams/fulfillments.stream.ts`)은 건드리지 않는다.
- `EventsModule.forApp` 의 `publishes` 목록은 그대로 둔다.
- 마이그 없음. 옛 문서(`docs/superpowers/specs|plans` 의 과거 파일, `docs/logistics-backend-hardening-2026-07.md`)는 역사 기록이라 고치지 않는다.
- 전체 jest 는 `--maxWorkers=2`. E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다.

## Review Focus

1. 기존 `coreShippingStatus: 'delivered'` 인 주문에 늦은 시도 발송이 와도 `delivered` 가 유지돼야 한다 — 지금 `'MedusaClient V1 shipping projection precedence'` 블록 첫 테스트가 고정한다. Task 2 에서 블록을 지울 때 이 테스트를 **살려서 옮긴다**.
2. 시도가 전부 `recalled` 인 주문에 새 시도가 발송되면 `shipped` 로 넘어가야 한다 — 같은 블록 두 번째 테스트. 역시 살려서 옮긴다.
3. 배포 순간 라이브 inbox 에 남은 `CoreFulfillment*` `pending` 행은 영영 안 집힌다 — Task 1 의 claim 쿼리 테스트가 `not.toContain` 으로 고정하고, 처리는 배포 때 SQL(스펙 «배포»)로 한다.
4. 시도 배열이 비어 있는 주문에서 시도별 투영은 들어온 상태를 그대로 쓴다(`deriveCoreShippingStatus` 가 `null`) — 지금 코드 경로상 v2 호출은 시도를 하나 이상 넣은 뒤 부르므로 도달하지 않는다. 동작 보존만 확인하고 새 테스트는 두지 않는다.
5. 데모 모드(`IS_SAFE_DEMO_MODE`) 분기 — 소비자는 비데모 목록에만 있었으므로 데모 쪽은 변화 없음. 앱 부팅 확인은 Task 1 의 type-check 와 기존 `adapter.module` 관련 스펙으로 본다.

---

### Task 1: 옛 투영의 입구를 지운다

**Files:**
- Delete: `apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts`
- Delete: `apps/channel-adapter/src/consumers/fulfillment-events.consumer.spec.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts` (import 57행, 컨트롤러 294행, `EventFailuresModule.forRoot` 의 `sequencedTopics` 안 `FULFILLMENT_STREAM.topic.topic`)
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts` (allowlist 45–46행, `case 'CoreFulfillmentShipped'`·`case 'CoreFulfillmentDelivered'` 486–566행)
- Modify: `apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts` (408행, `describe('InboxWorkerService V1 Medusa compatibility projection')` 637–750행)
- Modify: `apps/channel-adapter/CLAUDE.md` §4 구독 표

**Interfaces:**
- Produces: `MedusaClient.updateOrderShippingProjection` 의 호출자 0 (Task 2 가 이걸 전제로 메서드를 지운다).

- [ ] **Step 1: claim 쿼리 테스트를 뒤집는다** — `inbox-worker.service.spec.ts:408` 을 아래로 바꾼다.

```ts
    // 옛 주문 단위 배송 투영 제거(#1452) — 배포 순간 남은 행은 집지 않는다(배포 때 SQL 로 닫는다).
    expect(claimSql.params).not.toContain('CoreFulfillmentShipped');
    expect(claimSql.params).not.toContain('CoreFulfillmentDelivered');
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/inbox-worker.service.spec.ts -t "atomic claim"`
Expected: FAIL (`CoreFulfillmentShipped` 가 params 에 있음)

- [ ] **Step 3: 삭제한다**
  - inbox-worker: allowlist 두 줄과 두 `case` 블록을 지운다. 그 결과 쓰이지 않게 된 import(`wmsOrderMappings`, `withMedusaOrderProjectionLock`, drizzle 연산자 중 남는 사용처가 없는 것)를 지운다 — 다른 사용처가 있으면 남긴다.
  - inbox-worker spec: `describe('InboxWorkerService V1 Medusa compatibility projection', …)` 블록 전체를 지운다.
  - 소비자 파일 두 개를 `git rm` 한다. `adapter.module.ts` 에서 import·컨트롤러 등록을 지우고, `sequencedTopics` 에서 `FULFILLMENT_STREAM.topic.topic` 줄만 지운다(`publishes` 의 `FULFILLMENT_STREAM` 과 import 는 남는다).
  - `CLAUDE.md` §4 의 `| \`fulfillments.events.v1\` | … | 채널에 송장/취소 전파 |` 줄을 지운다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter --maxWorkers=2`
Expected: PASS (실패 0)

Run: `grep -rn "CoreFulfillment\|FulfillmentEventsConsumer" apps/channel-adapter/src`
Expected: 출력 없음

- [ ] **Step 5: Commit**

```bash
git add -A apps/channel-adapter
git commit -m "[channel-adapter] #1452 옛 주문 단위 배송 투영의 소비자·inbox 처리부를 지운다"
```

### Task 2: `updateOrderShippingProjection` 과 v1 갈래를 지운다

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (`mergeCoreShippingStatus` 52–80행, `updateOrderShippingProjection` 2055–2111행, 호출부 `mergeCoreShippingStatus('v2', …)` 2274행)
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts` (`describe('MedusaClient V1 shipping projection precedence')` 61–295행)

**Interfaces:**
- Consumes: Task 1 — `updateOrderShippingProjection` 호출자 0.
- Produces: `function mergeCoreShippingStatus(incoming: CoreShippingProjectionStatus, attempts: Array<Record<string, unknown>>, existing: unknown): CoreShippingProjectionStatus` — 시도가 없으면 `incoming`, `existing === 'delivered'` 면 `'delivered'`, 아니면 시도 배열에서 도출한 값.

- [ ] **Step 1: 스펙을 먼저 정리한다** — V1 블록에서 앞의 두 테스트(`keeps an existing V1 delivered state when a late V2 dispatch…`, `advances an all-recalled V2 history…`)는 `updateOrderShipmentAttemptProjection` 만 부르므로 **남긴다**. 블록 이름을 `'MedusaClient shipment attempt status precedence'` 로, 첫 테스트 이름을 `'keeps an existing delivered state when a late dispatch performs metadata GET then POST'` 로 바꾼다. `updateOrderShippingProjection` 을 부르는 나머지 다섯 테스트(139–294행)를 지운다. 헬퍼 `makeShippingProjectionClient`·`makeV2Dispatch` 는 남은 두 테스트가 쓰므로 남긴다.

- [ ] **Step 2: 남은 테스트가 지금 코드에서 통과하는지 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts`
Expected: PASS

- [ ] **Step 3: 코드를 지운다** — `updateOrderShippingProjection` 메서드(JSDoc 포함)를 지운다. `mergeCoreShippingStatus` 에서 `writer` 인자와 v1 갈래(`protectedStatus` 계산 이하)를 지워 Interfaces 의 시그니처로 만들고, 2274행 호출에서 `'v2',` 인자를 뺀다. 그 결과 쓰이지 않게 된 `CORE_SHIPPING_STATUS_PRECEDENCE`·`isCoreShippingProjectionStatus` 가 있으면 함께 지운다. 바로 아래 `updateOrderShipmentAttemptProjection` 의 JSDoc 중 «Unlike the V1 compatibility projection» 문구는 대상이 사라졌으니 그 비교절만 뺀다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa --maxWorkers=2`
Expected: PASS

Run: `grep -rn "updateOrderShippingProjection\|'v1' | 'v2'" apps/channel-adapter`
Expected: 출력 없음

- [ ] **Step 5: 게이트** (E2E 스택이 내려가 있을 때)

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest --maxWorkers=2`
Expected: 실패 0

- [ ] **Step 6: Commit**

```bash
git add apps/channel-adapter/src/adapters/medusa
git commit -m "[channel-adapter] #1452 Medusa 옛 배송 투영 메서드와 v1 상태 병합 갈래를 지운다"
```

### Task 3: 로컬 E2E 로 시도별 투영이 그대로인지 본다

코드 변경 없음. 스펙의 완료 조건 2·3.

- [ ] **Step 1:** 사용자에게 스택을 부탁하거나 떠 있는지 확인한다 — `npm run preflight:e2e:local` 초록. (브라우저 로그인은 사용자 몫이지만 이 단계엔 필요 없다.)
- [ ] **Step 2:** `npm run seed:order-path:local` 후 `npm run order:place:local -- --count 2` — 끝에 상자 id 두 개. 하나는 정식(창고 앱), 하나는 비상 경로로 출고한다. 절차는 `scripts/ops/emergency-outbound/README.md` «로컬 확인».
- [ ] **Step 3:** `npx tsx scripts/ops/emergency-outbound/local/compare.ts --normal <정식 상자> --emergency <비상 상자>` 를 `--allow-*` 플래그 없이 돌린다 — Expected: 통과(`coreShipmentAttempts[].invoice.trackingNo` 가 상자 송장과 같고 `coreShippingStatus` 가 채워짐).
- [ ] **Step 4:** channel-adapter 로그에 `[CoreFulfillmentShipped]` 가 없음을 확인한다.
- [ ] **Step 5:** 결과를 PR 본문 «검증» 절에 적는다. 배포 전 라이브 SQL(스펙 «배포»)은 터널이 필요하므로 PR 본문에 «배포 때 할 일»로 남긴다.
