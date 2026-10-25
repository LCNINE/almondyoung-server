# K3 PR 1 — FO 상태는 투영 하나가 쓴다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FO·FOI status 를 쓰는 곳을 투영 함수 하나로 모으고, 그 밖에서 status 를 쓰면 가드 spec 이 빨갛게 한다. 남는 예외는 옛 직배 경로 하나(`fulfillments.service.ts`)뿐이고, 그것은 K3 PR 5·8 이 걷는다.

**Architecture:** 지금 투영은 둘이다 — `ShipmentReservationService.recomputeFulfillmentOrder`(private, 상자 라인·확정 예약을 읽어 투영)와 `UnboxedDemandCancellation.projectFulfillmentOrder`(private, 예약 0·라인 0 으로 투영). 앞의 것을 K2 의 `transitionShipments` 처럼 **모듈 함수** `reprojectFulfillmentOrders(tx, ids)` 로 꺼내고, 두 호출자가 그것을 부른다. 입력은 함수가 직접 읽는다 — 호출자가 입력을 조립하지 않는다. 순수 투영(`fulfillment-progress.service.ts`)은 그대로다.

**Tech Stack:** NestJS(core), Drizzle, Jest(unit + `DATABASE_URL` 통합 — 스크래치 DB `k6_it`).

**Spec:** `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` (§4.5, §7 PR 1).

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. 상자 전 취소 뒤 FOI status 가 투영값으로 바뀐다.** 지금 `UnboxedDemandCancellation.reduce`/`cancelOrder` 는 FOI status 를 «전량이면 `'canceled'`, 아니면 그대로»로 쓰므로 생성 기본값 `'pending'` 이 남는다. 투영 함수는 모든 FOI 에 투영값(`created`·`ready`·`canceled` …)을 쓴다 — `recompute` 경로가 이미 그렇게 한다. FOI status 는 varchar 이고(`inventory.schema.ts` `fulfillmentOrderItems.status`) 코드에서 판정에 읽는 곳이 없다(2026-10-25 `grep`). 화면·DTO 에 그대로 실린다.
- **N2. 투영이 FO `canceledAt` 을 책임진다.** 투영 결과가 `canceled` 면 `canceledAt = coalesce(기존, at)`, 아니면 그대로. 지금은 상자 전 취소만 찍고 상자 후 취소(`recompute` 경로)는 찍지 않는다 — 상자 후 전량 취소된 FO 도 이제 `canceledAt` 을 갖는다. 비우지는 않는다(되살아난 FO 의 옛 값은 남는다, 지금 상자 전 경로와 같다).
- **N3. 투영이 FO `totalReservedQty`·`reservationFailure*` 와 FOI `reservedQty` 를 늘 쓴다.** 상자 전 경로는 지금 이 칸들을 건드리지 않았다. 상자 전 FO 는 예약이 0 이라는 불변식(`assertNoConfirmedReservations`)이 있어 값이 바뀌는 행은 실패 사유가 남아 있던 행뿐이다.
- **N4. 항목이 0 개인 FO 의 투영은 `canceled`.** 지금 상자 전 경로의 규칙을 투영 함수가 가져간다(순수 투영은 빈 입력이면 던진다).
- **N5. 가드 예외는 `fulfillments.service.ts` 하나.** 옛 직배 생성(`createFulfillmentOrderFromItems` 의 `'ready'`)과 `ship()`(`'shipped'`)이다. PR 4 가 생성 쪽을, PR 5·8 이 `ship()` 을 걷는다. 허용 목록은 줄어드는 방향만.

## Global Constraints

- 투영 어휘(`FULFILLMENT_PROGRESS_STATUSES` 8개)와 순수 투영 함수(`projectFulfillmentOrderItemProgress`·`projectFulfillmentOrderProgress`)는 바꾸지 않는다.
- 트랜잭션 규칙(ADR-0025): 투영 함수는 `tx: DbTx` 를 **필수 첫 인자**로 받는다(호출자가 이미 잠근 트랜잭션 안에서만 부른다). `this.db` 를 쓰지 않는다.
- Inventory 쿼리 규칙: `db.query.*`·`with` 관계·`any`/`as` 금지. `select().from().innerJoin().where()`.
- 위 N1~N4 말고는 동작이 바뀌지 않는다: `recompute` 경로의 FO·FOI 결과(상태·`reservedQty`·`totalReservedQty`)는 같다.
- 통합 테스트는 스크래치 DB `k6_it`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`. 마이그 없음. 워크트리엔 `node_modules` 심링크.
- 기준선: 브랜치 시작 때 `k6_it` 에서 `apps/core/src/modules/fulfillment/**/*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0, 통합(`k6_it`) 기준선 외 실패 0.

## Review Focus

- **상자 전 부분취소 뒤 직배 FO 상태** — 지금도 `ready` 로 만든 직배 FO 가 부분취소 뒤 `created` 로 떨어진다(예약 0). 새 함수도 같은 값을 내야 한다(이 PR 은 고치지 않는다 — PR 4 가 입점사 상자 라인을 예약 대상 아님으로 다룬다). Task 1 통합 spec 에 «직배 FO 부분 감소 → FO `created`» 단언.
- **FO 하나에 상자가 둘(분할)이고 한 상자만 `canceled`** — 취소된 상자의 라인은 활성 라인에서 빠진다(`ACTIVE_SHIPMENT_STATUSES` = `draft`·`planned`·`recovery_required`). Task 1 통합 spec 케이스.
- **`recovery_required` 상자에 걸린 FOI** — FO 가 `recovery_required` 여야 한다. Task 1 통합 spec 케이스.
- **같은 tx 에서 투영을 두 번 부름** — 결과가 같아야 한다(멱등). Task 1 통합 spec 케이스.
- **ids 중복·빈 배열** — 중복은 한 번만, 빈 배열은 쿼리 없이 끝. Task 1 통합 spec 케이스.

---

## 배포

- 배포 단위: **Core 만.** 마이그 없음. `npm run deploy:preflight -- --stage live`.
- 롤백: 이 PR 이전 Core 로 되돌려도 안전하다(쓰는 칸이 같다; N2 의 `canceledAt` 은 nullable 이고 옛 코드는 무시한다).

---

### Task 1: 투영 함수 `reprojectFulfillmentOrders`

**Files:**
- Create: `apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.ts`
- Create: `apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.integration.spec.ts`

**Interfaces:**
- Consumes: `projectFulfillmentOrderItemProgress`, `projectFulfillmentOrderProgress`, `FulfillmentOrderItemProgressInput` (`services/fulfillment-progress.service.ts`)
- Produces:
  - `export const ACTIVE_SHIPMENT_STATUSES: readonly ['draft', 'planned', 'recovery_required']`
  - `export async function reprojectFulfillmentOrders(tx: DbTx, fulfillmentOrderIds: readonly string[], at?: Date): Promise<void>`

- [ ] **Step 1: 통합 spec 을 쓴다** — 기존 fixture(`order-progress/__support__/order-progress.fixtures.ts` 의 `seedWorld`·`seedOrder`·`seedFo`·`seedBox`·`seedFullReservations`)와 `services/__support__` 의 `inRollbackTx` 를 쓴다. 가드는 `const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip`. 케이스와 단언:
  - `상자 라인이 다 확정 예약되면 FO·FOI ready, reservedQty 가 예약 합` — qty 2, draft 상자 라인 2, 확정 예약 2 → FOI `{ status: 'ready', reservedQty: 2 }`, FO `{ status: 'ready', totalReservedQty: 2, reservationFailureReason: null }`
  - `예약이 일부면 partially_reserved` — qty 2, 예약 1 → FO `partially_reserved`, `totalReservedQty: 1`
  - `canceled 상자의 라인은 활성 라인이 아니다` — FOI 하나를 draft 상자(qty 1, 예약 1)와 canceled 상자(qty 1, 예약 1)로 나눔, FOI qty 2 → FOI `reservedQty: 1`, FO `partially_reserved`
  - `recovery_required 상자에 걸린 FOI 는 recovery_required` — 상자 `status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING'` → FOI·FO `recovery_required`
  - `전량 취소면 canceled, canceledAt 을 at 으로 찍는다` — FOI `canceledQty = qty` 로 UPDATE 후 `at = new Date('2026-10-25T00:00:00Z')` → FO `{ status: 'canceled', canceledAt: at }`
  - `이미 canceledAt 이 있으면 그 값을 지킨다` — FO `canceledAt = t0` 인 상태에서 다시 투영 → `canceledAt: t0`
  - `항목이 0 개인 FO 는 canceled` — FOI 를 지운 FO → `canceled`
  - `직배 FO 부분 감소 뒤는 created` — `seedFo(…, { qty: 3, dropShip: 'pending', status: 'ready' })`, FOI `canceledQty: 1` → FO `created`, FOI `created`
  - `같은 tx 에서 두 번 불러도 결과가 같다` — 첫 투영 뒤 FO·FOI 행을 읽고, 두 번째 뒤 `status`·`reservedQty`·`totalReservedQty`·`canceledAt` 이 같다
  - `중복 id 는 한 번, 빈 배열은 아무것도 안 한다` — `[foId, foId]` 가 에러 없이 끝나고, `[]` 는 resolve

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.integration.spec.ts`
Expected: FAIL — `Cannot find module './fulfillment-order-projection'`

- [ ] **Step 3: `reprojectFulfillmentOrders` 를 구현한다** — 본문은 `ShipmentReservationService.recomputeFulfillmentOrder`(`services/shipment-reservation.service.ts:1069-1130`)를 옮긴다(FOI id 순으로 읽기, 활성 라인·확정 예약 합, FOI `reservedQty`·`status` 쓰기, FO `status`·`totalReservedQty`·`reservationFailureReason/Details = null` 쓰기). 더하는 것: ids 를 `[...new Set(ids)].sort()` 로 정규화하고 빈 배열이면 즉시 반환, 항목 0 개면 FO `canceled`(N4), 결과가 `canceled` 면 `canceledAt = coalesce`(N2 — SQL `coalesce(${fo.canceledAt}, ${at})`), `updatedAt = at`. `at` 기본값 `new Date()`.

- [ ] **Step 4: 통과를 확인한다** — Step 2 명령, Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/fulfillment-order/
git commit -m "K3 PR1 — FO 투영 함수 하나(reprojectFulfillmentOrders)"
```

### Task 2: 두 호출자가 투영 함수를 부른다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-reservation.service.ts:14,1062-1130` — `recomputeFulfillmentOrder` 삭제, `recompute` 가 `reprojectFulfillmentOrders(tx, fulfillmentOrderIds)` 를 부른다. 로컬 `ACTIVE_SHIPMENT_STATUSES` 는 Task 1 의 export 를 import 한다.
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.ts:82-85,122-125,270-300` — `projectFulfillmentOrder` 삭제, `reduce`·`cancelOrder` 가 손댄 FO id 들로 `reprojectFulfillmentOrders(trx, ids)` 를 한 번 부른다. FOI UPDATE 의 `status` 키를 뺀다(투영이 쓴다). `ReducedDemandItem.newStatus` 는 투영 뒤 FOI 를 다시 읽어 채운다.
- Modify: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.integration.spec.ts` — FOI `status: 'pending'` 단언을 투영값으로(N1), 전량 취소 FO 의 `canceledAt` 단언은 그대로.
- Test: `services/shipment-reservation.integration.spec.ts`, `services/shipment-reservation.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `reprojectFulfillmentOrders`, `ACTIVE_SHIPMENT_STATUSES`
- Produces: 없음(공개 시그니처 불변). `ReducedDemandItem.newStatus` 의 값이 투영값이 된다.

- [ ] **Step 1: 상자 전 spec 의 기대값을 먼저 바꾼다** — `직배 FO 부분 감소…` 케이스: FOI `{ qty: 3, canceledQty: 1, status: 'created' }`, `reduced[0].newStatus === 'created'`. 전량 취소 케이스: FOI `status: 'canceled'`(그대로).

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.integration.spec.ts`
Expected: FAIL — FOI status `'pending'` ≠ `'created'`

- [ ] **Step 3: 두 파일을 고친다** (위 Files 대로)

- [ ] **Step 4: 통과와 회귀를 확인한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.integration.spec.ts apps/core/src/modules/fulfillment/services/shipment-reservation.integration.spec.ts apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.integration.spec.ts && npx jest apps/core/src/modules/fulfillment/services/shipment-reservation.service.spec.ts apps/core/src/modules/fulfillment/unboxed-demand`
Expected: PASS. 유닛 spec 이 private `recomputeFulfillmentOrder` 를 spy 하고 있으면 `recompute` 의 관찰 결과(쓰인 행)로 바꾼다 — spy 대상을 새 모듈 함수로 옮기지 않는다.

- [ ] **Step 5: fulfillment·sales-order 통합 전체를 기준선과 비교한다**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand apps/core/src/modules/fulfillment apps/core/src/modules/sales-order --testPathPattern integration`
Expected: 기준선 외 새 실패 0. 새 실패가 FOI `status: 'pending'` 단언이면 N1 로 기대값을 고치고, 그 밖이면 멈추고 보고한다.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/shipment-reservation.service.ts apps/core/src/modules/fulfillment/unboxed-demand/ apps/core/src/modules/fulfillment/services/*.spec.ts
git commit -m "K3 PR1 — 예약 재계산과 상자 전 취소가 같은 투영을 부른다"
```

### Task 3: FO·FOI status 쓰기 가드

**Files:**
- Create: `apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-status-writes.guard.spec.ts`
- Modify: `docs/order-logistics-architecture-audit-2026-10.md` §8.1 K3 «남은 것» — 투영 하나·가드가 생겼고 예외는 옛 직배 한 파일이라고 한 줄, 정본은 이 가드 spec 이라고.

**Interfaces:**
- Consumes: 없음(파일 텍스트 검사)
- Produces: 허용 목록 상수(이 spec 안). PR 4·5·8 이 줄인다.

- [ ] **Step 1: 가드 spec 을 쓴다** — 모양은 `sales-order/order-cancellation/order-cancellation.guard.spec.ts` 의 `walk`·`filesCalling`(`__support__`·`__fixtures__`·`.spec.ts` 제외, `apps/core/src` 전체). 패턴은 네 형, 대소문자 무시, `T = (?:fulfillmentOrders|fulfillmentOrderItems)`:
  - drizzle 직접: `\.update\((?:wmsTables|inventoryTables)\.${T}\)\s*\.set\(\{[^}]*\bstatus\b\s*[:,}]`
  - drizzle 별칭: `const (\w+) = (?:wmsTables|inventoryTables)\.${T};[\s\S]*?\.update\(\1\)\s*\.set\(\{[^}]*\bstatus\b\s*[:,}]`
  - raw SQL 리터럴: `\bupdate\s+"?(?:fulfillment_orders|fulfillment_order_items)"?\s+set\b[^;]*\bstatus\b`
  - raw SQL 보간: `\bupdate\s+\$\{\s*(?:wmsTables|inventoryTables)\.${T}\s*\}\s+set\b[^;]*\bstatus\b`

  단언: 결과가 정확히 `['apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.ts', 'apps/core/src/modules/fulfillment/services/fulfillments.service.ts']`. 예외 줄 옆 주석: «옛 직배 — 생성 `'ready'` 는 K3 PR 4, `ship()` `'shipped'` 는 PR 5·8 이 걷는다. 줄어드는 방향만».
  한 케이스 더: 패턴 자체가 살아 있는지 — 문자열 `".update(wmsTables.fulfillmentOrders)\n  .set({ status: 'x' })"` 와 `"sql\`UPDATE ${wmsTables.fulfillmentOrderItems} SET status = 'x'\`"` 에 정규식이 걸리고, `".update(wmsTables.fulfillmentOrders).set({ shippedAt: now })"` 에는 안 걸린다.

- [ ] **Step 2: 통과를 확인한다** (Task 2 이후라 바로 초록이어야 한다)

Run: `npx jest apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-status-writes.guard.spec.ts`
Expected: PASS. 목록에 다른 파일이 보이면 그 파일이 status 를 쓰는지 읽고 — 쓰면 투영 함수로 옮기고, 거짓 양성이면 패턴을 좁힌다(넓히지 않는다).

- [ ] **Step 3: 검증 게이트**

Run: `npm run type-check && npx jest`
Expected: 에러 0, 실패 0(기준선 외).

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-status-writes.guard.spec.ts docs/order-logistics-architecture-audit-2026-10.md
git commit -m "K3 PR1 — FO·FOI status 는 투영 함수만 쓴다(가드)"
```
