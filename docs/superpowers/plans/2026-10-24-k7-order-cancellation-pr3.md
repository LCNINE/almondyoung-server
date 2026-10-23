# K7 PR 3 — 상자 전 취소의 출고 명령: 판매주문은 수요 감소분만 넘기고, FO·FOI·예약은 출고 모듈이 쓴다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상자 전 취소(전체·부분)가 판매주문 코드에서 `fulfillment_orders`·`fulfillment_order_items`·`stock_reservations` 를 직접 쓰지 않게 한다. 출고 모듈에 «아직 상자에 오르지 않은 수요를 줄인다» 명령을 하나 두고, FOI 취소 표현은 `canceledQty` 하나로(D3), FO status 는 투영으로(D4) 정한다(스펙 §5.4, G6).

**Architecture:** 새 명령 `UnboxedDemandCancellation`(fulfillment 모듈, `ShipmentPlanningService.cancelOutstanding` 의 상자 전 짝)이 잠금·취소 가능 수량 판정·`canceledQty` 쓰기·«상자 전 FO 엔 예약이 없다» 검사·FO/FOI status 투영을 소유한다. 판매주문(`SalesOrdersService`)에는 «라인 수량 → SKU 수요 감소분» 계산(나눠떨어짐·출고 뒤 몫 판정 포함)만 남는다. `canceledQty` 를 읽지 않던 직배송 소비자 둘(조회·완료)을 먼저 고친다.

**Tech Stack:** NestJS(core), Drizzle, Jest(unit + `REQUIRE_*_DB` 통합 — 스크래치 DB `k6_it`).

**Spec:** `docs/superpowers/specs/2026-10-24-k7-order-cancellation-design.md` (§4.2·§5.4·§5.9·§6 D3·D4·§7-3·§9). PR 1·2 결정은 `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md`.

## 계획을 정한 사실 (2026-10-24 develop `e722ef6e8`)

- **지금 창고 FO 는 만들어지는 순간 상자에 오른다.** `FulfillmentsService.create`(`fulfillments.service.ts:230`)가 in_house FO 마다 draft 상자를 열고 줄마다 예약한다. 그래서 `hasBoxedFulfillment` 가 거짓인 «상자 전» FO 는 **직배송(drop_ship) FO** 와 **V2 이전 옛 FO**(상자가 없거나 `opened_for_fulfillment_order_id` 가 찍힌 옛 상자)뿐이다.
- **상자 전 FO 에 붙은 예약은 옛 행뿐이다.** V2 예약은 `target_type='SHIPMENT_LINE'` 이고 `fulfillment_order_item_id` 를 채우지 않는다(`shipment-reservation.service.ts:410`). 상자 전 부분취소가 FOI id 로 찾는 확정 예약·전체취소가 FO target 으로 찾는 예약은 옛(`FULFILLMENT_ORDER`) 행만 만난다.
- **FO status 는 enum 이다**(`fulfillment_status`: created·partially_reserved·ready·processing·shipped·partially_shipped·completed·canceled·recovery_required). 지금 `CANCELLABLE_FULFILLMENT_STATUSES`(`sales-orders.service.ts:211`) 11개 중 enum 에 있는 건 `created`·`ready` 둘뿐이다 — 나머지 9개는 들어올 수 없는 죽은 값.
- **`canceledQty` 를 모르는 직배송 소비자가 둘 있다.** 조회·엑셀(`direct-ship.service.ts:141,164,236,357`)은 FOI `qty`·FO `totalQty` 를 그대로 싣고, 완료(`fulfillments.service.ts:478` `ship`)는 `shippedQty = qty` 를 쓴다. D3 뒤 부분취소된 직배 FO 를 넘기면 **취소분이 업체 엑셀에 실리고**, 완료는 CHECK `shipped_qty + canceled_qty <= qty` 에 걸려 **500** 이 된다. Task 2 가 먼저 막는다.
- **라이브 실측(2026-10-24, 사용자 실행, 읽기 전용):** 열린 FO 241건 전부 in_house·전부 상자에 올라 있다(상자 전 열린 FO **0**). drop_ship FO 는 닫힌 것까지 **0행**. 확정 예약 140행 전부 `SHIPMENT_LINE`(옛 `FULFILLMENT_ORDER` 행 **0**). 상자 전 부분취소 효과 이력 0, 상자 전 전체취소 효과 2건(마지막 2026-07-12). → 앞으로 상자 전 FO 는 직배송뿐이고, 직배송은 예약을 갖지 않는다.
- K6 라인 수량 문(`line-quantities.sql.ts:173`)과 FO 투영(`fulfillment-progress.service.ts`)은 이미 `qty − canceled_qty` 로 읽는다. 옛 표현(qty 를 깎고 canceled 0)으로 줄어든 행도 같은 값으로 읽힌다 — 두 표현이 섞여도 맞다.

## 이름 붙은 결정 (⛔ 사용자 확인)

사용자 확인 2026-10-24(실측 뒤 N13 을 «예약이 있으면 거절»로 단순화, 서브에이전트 방식).

- **N11. 명령 이름 `UnboxedDemandCancellation`, 위치 `apps/core/src/modules/fulfillment/unboxed-demand/`.** 공개 메서드 셋: `lockForCancellation`(잠그고 읽기)·`reduce`(부분)·`cancelOrder`(전체). 판매주문은 생성자 주입으로 받는다 — 의존이 DbService 하나라 `ShipmentPlanningService` 처럼 `moduleRef` 로 우회할 이유가 없다. 작은 모듈 `UnboxedDemandModule` 을 `SalesOrderModule` 이 import 한다.
- **N12. 취소 가능 FO 상태는 `created`·`ready` 둘로 줄인다(동작 그대로).** 죽은 값 9개만 지운다. 라이브 상자 전 열린 FO 가 0 이라 `partially_reserved`·`processing` 은 결정할 대상이 없다.
- **N13. 상자 전 FO 에는 예약이 없다 — 명령이 확정 예약을 만나면 던진다(fail-closed).** 새 창고 FO 는 생성 즉시 상자에 오르고 직배송은 예약을 갖지 않으며, 라이브 옛 `FULFILLMENT_ORDER` 예약은 0행이다. 그래서 옛 예약 해제 코드(`SalesOrdersService.releaseFulfillmentOrderItemReservations` `:2368`, 전체취소의 `reservationLifecycle.handleFulfillmentOrderStatusChange` `:1272` 와 그 `try/catch`)는 옮기지 않고 지운다. 대신 `lockForCancellation` 이 그 주문 FO 들에 확정 예약(`fulfillment_order_item_id` 가 그 FOI 이거나, `target_type='FULFILLMENT_ORDER'`·`target_id` 가 그 FO)이 하나라도 있으면 `throw new Error('Unboxed fulfillment order <id> has confirmed reservations — unboxed demand carries no reservation')` 로 막는다(500 — 불변식 위반이라 운영자가 봐야 한다).
- **N14. FOI status 는 «전량 취소면 `canceled`, 아니면 그대로».** 지금 규칙(`newQty === 0 → 'canceled'`)과 같은 뜻이다. FO status 는 투영(`projectFulfillmentOrderProgress`)으로 쓰되, 입력은 FOI 의 `qty`·`shippedQty`·`canceledQty`, `confirmedReservedQty: 0`(N13 이 보장), `pickedQty > 0`, `activeLineQty: 0`, `recoveryRequired: false`. FO `totalQty`·`totalReservedQty` 는 건드리지 않는다(상자 후 취소와 같다). 투영이 `canceled` 이고 `canceledAt` 이 비었으면 지금 시각.
- **N15. 효과 기록 `adjusted_fulfillment_order_item` 의 metadata 키를 표현에 맞춘다.** `previousQty`/`newQty` → `qty`·`previousCanceledQty`/`newCanceledQty`, 예약 세 키(`previousReservedQty`·`newReservedQty`·`releasedReservationQty`)는 뺀다. 나머지 키(`fulfillmentOrderId`·`salesOrderLineId`·`skuId`·`quantityDelta`·`previousStatus`·`newStatus`)는 그대로. 이 metadata 를 읽는 코드는 없다(admin-web 은 relation 이름만 쓴다, `history/components/table/index.tsx:291`). 효과 type·business link relation 이름은 그대로.

## 동작 변경 (스펙 §6 대조)

| | 변경 | 라이브 영향 |
|---|---|---|
| D3 | 상자 전 부분취소: FOI `qty` 감소 → `canceledQty` 증가. 상자 전 **전체**취소도 FOI 에 `canceledQty = qty − shippedQty` 를 남긴다(지금은 FO 만 `canceled`, FOI 는 그대로) | 화면·통계는 K6 문(`qty − canceled_qty`)이라 같다. 전체취소 주문은 SO `cancelled` 칸이 진행 단계를 이겨 같다. 직배 조회·엑셀·완료는 Task 2 로 같은 값. FO 상세 «총»은 원래 수량으로 남는다(옆에 «취소» 칸이 이미 있다 — 상자 후 취소와 같은 표시) |
| D4 | FO status: 판매주문 직접 쓰기 → 명령의 투영 | 직배 FO(`created`, 예약 0)는 `created` 그대로, 전량 취소면 `canceled`. 라이브 상자 전 열린 FO 0 |
| — | 직배 조회·엑셀이 FOI `qty − canceledQty` 를 싣고 0 인 항목을 뺀다. 직배 완료가 `shippedQty = qty − canceledQty` 를 쓰고 전량 취소 항목은 건드리지 않는다 | 라이브 직배 FO 0행 |
| N13 | 상자 전 취소가 확정 예약을 만나면 해제 대신 500 | 라이브 0(옛 예약 0행) |

## Global Constraints

- 거절 문구는 글자 그대로 둔다: `CANCEL_MSG_*`, `'이미 출고/배송 완료된 주문은 전체 취소를 할 수 없습니다. 부분 취소로 진행해 주세요.'`, `` `취소하려는 수량 중 일부(${n}개)가 이미 피킹 또는 출고 처리된 상태입니다. 해당 수량은 반품/회수 처리가 필요합니다.` ``, `Cannot derive SKU … is not divisible by remaining line quantity …`.
- 잠금 순서는 판매주문 → FO → FOI(id 순). 명령의 `lockForCancellation` 이 FO·FOI 를 잠근다.
- 판매주문 모듈은 `ReservationLifecycleService`·`UnifiedReservationService`·`ShipmentReservationService` 를 import 하지 않는다(Task 3 가드).
- 가드 허용 목록은 줄어드는 방향으로만 바꾼다. 출고 테이블 직접 쓰기 허용 목록은 K3 본편 둘로 시작한다: `sales-order/channel-order-change/channel-order-change.manager.ts`(배송지), `sales-order/services/entrance-password-cleaner.ts`.
- 효과 type·relation 이름·`SalesOrderCancelled` payload 는 바꾸지 않는다.
- 통합 테스트는 스크래치 DB `k6_it`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`. 마이그 없음. 워크트리에 `node_modules` 심링크(이미 걸려 있다).
- 기준선: 시작 때 `k6_it` 에서 `apps/core/src/modules/sales-order/**/*.integration.spec.ts`·`apps/core/src/modules/fulfillment/services/direct-ship*.integration.spec.ts`·`fulfillments*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다. 🔴 `channel-cancel-request.integration.spec.ts` 단발 실패는 공유 DB 동시 실행 의심 — 재실행으로 판정.
- 검증 게이트: `npm run type-check` 에러 0(로컬 환경 에러 — web-push·tauri 미설치 — 은 기준선), `npx jest apps/core/src/modules/sales-order apps/core/src/modules/fulfillment scripts/security` 실패 0(🔴 OOM 이면 `--maxWorkers=2`), 통합(`k6_it`) 기준선 외 실패 0.

## Review Focus

1. **옛 표현으로 이미 줄어든 FOI 위의 새 부분취소** — qty 3→2 로 깎인 FOI(canceled 0, 라인 남은 수량 2)에 1 을 더 취소하면 나눠떨어짐 판정이 `qty − canceledQty = 2` 를 보고 통과, 결과 `qty 2·canceled 1`. Task 3 통합 테스트.
2. **부분취소된 직배 FO 를 넘기고 완료** — 엑셀 수량은 취소를 뺀 값, 전량 취소 항목은 빠진다, 완료가 CHECK 로 죽지 않고 `shippedQty = qty − canceledQty`. Task 2.
3. **같은 FOI 에 두 번째 부분취소** — `cancellableQty` 가 앞선 `canceledQty` 를 빼서 계산되고, 두 번 합이 qty 를 넘으면 판매주문 쪽 «남은 수량» 거절이 먼저 난다. Task 1(`cancellableQty`)·Task 3.
4. **전체취소된 상자 전 주문의 라인 수량·진행 단계** — 직배 FO 전체취소 뒤 `readLineQuantities` 의 `outstanding` 0, 진행 단계는 지금처럼 `cancelled`. Task 3 통합 테스트.
5. **취소 불가 상태 FO(`partially_reserved`·`processing`)** — `lockForCancellation` 이 `cancellableQty: 0`, `cancelOrder` 가 그 FO 를 건드리지 않는다(지금 동작), 부분취소는 지금처럼 «이미 피킹 또는 출고» 거절. Task 1·Task 3 의 기존 `'상자 전 부분 of a shipped status fo … is refused'`.

---

## 배포

- 배포 단위: **Core 만.** 마이그 없음. 배치 배포에 그대로 실린다(순서 의존 없음).
- **G1 (배포 전, 사람이 실행):** `scripts/ops/k7-pr3-predeploy-check.js`(Task 3 가 만든다) — 열린 상자 전 FO 를 모드·status 별로, 옛 `FULFILLMENT_ORDER` 확정 예약 수(N13 — 0 이 아니면 ✗, 그 주문의 상자 전 취소가 500 이 된다), 상자 전 FO 의 `canceled_qty > 0` FOI 수(롤백 판정). 10-24 실측은 셋 다 0. 실행: `cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/k7-pr3-predeploy-check.js)"`(터널 필요).
- 🔴 **롤백:** 배포 뒤 상자 전 **부분**취소가 한 건이라도 새 표현(`canceledQty > 0`)으로 쓰이면, 이 PR 이전 Core 로 되돌릴 때 옛 직배 조회가 취소분을 업체 엑셀에 싣고 옛 완료가 CHECK 로 실패한다. G1 스크립트의 마지막 줄(«상자 없는 FO 의 `canceled_qty > 0` FOI»)이 0 이면 롤백 안전, 아니면 되돌리지 말고 앞으로 고친다.

---

### Task 1: 출고 모듈의 상자 전 수요 취소 명령

**Files:**
- Create: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.ts`, `unboxed-demand.types.ts`, `unboxed-demand.module.ts`
- Modify: `apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts` (`Wired.unboxedDemand`)
- Test: `apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.integration.spec.ts`, `unboxed-demand-callers.guard.spec.ts`

**Interfaces:**
- Consumes: `projectFulfillmentOrderProgress`(`fulfillment-progress.service.ts`)
- Produces:
  ```ts
  // unboxed-demand.types.ts
  export type UnboxedDemandItem = {
    fulfillmentOrderItemId: string; fulfillmentOrderId: string; fulfillmentOrderStatus: string;
    salesOrderLineId: string | null; skuId: string;
    qty: number; canceledQty: number; shippedQty: number;
    /** 지금 줄일 수 있는 미처리 수요 — FO 가 created·ready 면 max(0, qty − canceledQty − max(pickedQty, shippedQty)), 아니면 0 */
    cancellableQty: number;
  };
  export type UnboxedDemandReduction = { fulfillmentOrderItemId: string; qty: number };
  export type ReducedDemandItem = {
    fulfillmentOrderItemId: string; fulfillmentOrderId: string; skuId: string; qty: number;
    previousCanceledQty: number; newCanceledQty: number;
    previousStatus: string; newStatus: string;
  };
  export type CanceledFulfillmentOrder = { fulfillmentOrderId: string; previousStatus: string };
  // unboxed-demand-cancellation.ts
  @Injectable() export class UnboxedDemandCancellation {
    constructor(db: DbService<typeof wmsSchema>);
    /** 판매주문의 FO → FOI 를 id 순으로 FOR UPDATE 잠그고 읽는다. FO 가 없으면 []. 확정 예약이 있으면 던진다(N13) */
    lockForCancellation(salesOrderId: string, tx: DbTx): Promise<UnboxedDemandItem[]>;
    /** 부분. 줄마다 canceledQty += qty, 전량이면 FOI 'canceled', 손댄 FO 투영 */
    reduce(salesOrderId: string, reductions: UnboxedDemandReduction[], tx: DbTx): Promise<ReducedDemandItem[]>;
    /** 전체. created·ready FO 마다 FOI canceledQty = qty − shippedQty → FO 투영 */
    cancelOrder(salesOrderId: string, tx: DbTx): Promise<CanceledFulfillmentOrder[]>;
  }
  ```
  `CANCELLABLE_FULFILLMENT_STATUSES = new Set(['created', 'ready'])` 는 이 파일로 온다(N12).

- [ ] **Step 1: 실패하는 테스트** — 통합 spec(`describeIfDb`, `inRollbackTx`, `seedWorld`·`seedOrder`·`seedFo` from `fulfillment/order-progress/__support__/order-progress.fixtures`).
  - `it('직배 FO 부분 감소는 canceledQty 만 늘리고 qty·FO 상태는 그대로')` — `seedFo(qty 3, dropShip 'pending', status 'created')`, `reduce([{id,1}])` → FOI `{ qty: 3, canceledQty: 1 }`, FOI status 그대로, FO `{ status: 'created', totalQty: 3 }`, 반환 `previousCanceledQty 0 / newCanceledQty 1`.
  - `it('전량 감소면 FOI·FO 가 canceled, canceledAt 이 찍힌다')`.
  - `it('cancellableQty 는 앞선 취소·피킹을 빼고, created·ready 가 아닌 FO 는 0')` — canceled 1·picked 1 of qty 4 → 2; status `partially_reserved` → 0; `processing` → 0.
  - `it('cancellableQty 를 넘는 감소는 던진다')` — `rejects.toThrow(/exceeds cancellable/)`, FOI 그대로.
  - `it('확정 예약이 있는 상자 전 FO 는 잠글 때 던진다 (N13)')` — 테스트가 `shipments`(status `draft`, `opened_for_fulfillment_order_id = foId`) + `shipment_lines` + `stock_reservations`(`target_type 'FULFILLMENT_ORDER'`, `target_id foId`, `status 'confirmed'`)를 직접 넣는다 → `lockForCancellation` 이 `rejects.toThrow(/has confirmed reservations/)`. 같은 행을 `status 'released'` 로 두면 던지지 않는다.
  - `it('cancelOrder 는 created·ready FO 만 취소한다')` — FO A(created, FOI 둘) + FO B(partially_reserved): A FOI 전부 `canceledQty = qty`·`'canceled'`, A `canceled`·`canceledAt`; B 그대로; 반환 `[{ fulfillmentOrderId: A, previousStatus: 'created' }]`.
  - 가드 spec: `it('UnboxedDemandCancellation 은 판매주문 상자 전 취소만 부른다')` — `/\bunboxedDemand\.(reduce|cancelOrder|lockForCancellation)\(/` 를 부르는 파일 목록(형식은 `cancel-outstanding-callers.guard.spec.ts`). 이 태스크에선 호출자가 없으니 기대값 `[]`, Task 3 가 `sales-orders.service.ts` 하나로 바꾼다.

- [ ] **Step 2: 실패 확인** — `DATABASE_URL=… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/unboxed-demand/unboxed-demand-cancellation.integration.spec.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — 위 시그니처대로. 투영 입력은 N14. `reduce` 는 FOI 를 다시 잠그지 않는다(호출자가 `lockForCancellation` 을 같은 tx 에서 먼저 부른 것이 전제 — JSDoc 에 적는다)지만 최신 행을 다시 읽어 `qty > cancellableQty` 를 `throw new Error(\`FOI ${id} reduction ${qty} exceeds cancellable ${cancellable}\`)` 로 막는다(판매주문이 이미 판정한 값이라 500 이 맞다). `UnboxedDemandModule` = `providers/exports: [UnboxedDemandCancellation]`(DbService 는 앱 전역). `wireLogistics` 에 `unboxedDemand: new UnboxedDemandCancellation(dbService)`.

- [ ] **Step 4: 통과 확인** — Step 2 명령 PASS, `npx jest apps/core/src/modules/fulfillment/unboxed-demand` PASS, `npm run type-check` 기준선.

- [ ] **Step 5: 커밋** — `git commit -m "feat(core): 상자 전 수요 취소를 출고 모듈의 명령으로 — canceledQty 하나로 쓰고 FO 상태는 투영 (K7 PR3)"`

---

### Task 2: 직배송 조회·완료가 취소 수량을 뺀다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/direct-ship.service.ts:155-250` (`getDirectShipOrders` 항목·합계)
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts:474-512` (`ship`)
- Test: `apps/core/src/modules/fulfillment/services/direct-ship.canceled-demand.integration.spec.ts`(새), `fulfillments.service.spec.ts` 의 `ship` describe

**Interfaces:**
- Consumes: 없음(Task 1 과 독립)
- Produces: 없음 — `DirectShipOrder` 모양 그대로, `items[].qty`·`totalQty` 의 뜻이 «남은 요구 수량»이 된다.

- [ ] **Step 1: 실패하는 테스트**
  - 통합 spec: `it('취소분을 뺀 수량을 싣고 전량 취소 항목은 뺀다')` — 직배 FO(`dropShip: 'pending'`)에 FOI 둘(qty 3·canceled 1, qty 2·canceled 2) → `getDirectShipOrders({ status: 'pending' })` 의 그 주문 `items` 한 개 `qty 2`, `totalQty 2`; `exportOrdersForCompany` 의 줄 `quantity 2`.
  - `it('완료는 남은 수량만 출고로 쓰고 전량 취소 항목은 그대로 둔다')` — `forwarded` FO, 같은 두 FOI → `fulfillments.ship(foId, tx)` 가 던지지 않고, 첫 FOI `{ shippedQty: 2, status: 'shipped' }`, 둘째 `{ shippedQty: 0, canceledQty: 2 }` status 그대로, outbox `FulfillmentShipped` payload `shippedItems` 에 첫 FOI 만 `shippedQty 2`.

- [ ] **Step 2: 실패 확인** — `DATABASE_URL=… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/direct-ship.canceled-demand.integration.spec.ts` → FAIL(첫 테스트는 qty 3, 둘째는 CHECK 위반).

- [ ] **Step 3: 구현** — 조회는 `canceledQty` 를 함께 읽어 `qty − canceledQty` 로 싣고 0 이하 항목을 빼며, `totalQty` 는 FO 칸 대신 남은 항목 합. `ship` 은 `outstanding = qty − shippedQty − canceledQty` 가 0 인 항목을 건너뛰고, 나머지는 `shippedQty: qty − canceledQty`·`'shipped'`. 이벤트 `shippedItems` 도 같은 값·같은 거름.

- [ ] **Step 4: 통과 확인** — Step 2 명령 PASS, `npx jest apps/core/src/modules/fulfillment/services/direct-ship.service.spec.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts` PASS(목 기반 기존 단언은 canceled 0 이라 그대로여야 한다 — 바뀌면 원인을 본다).

- [ ] **Step 5: 커밋** — `git commit -m "fix(core): 직배송 조회·완료가 FOI 취소 수량을 뺀다 — 취소분이 업체 엑셀에 실리지 않고 완료가 CHECK 에 걸리지 않게 (K7 PR3)"`

---

### Task 3: 판매주문 상자 전 취소가 명령을 부른다 — 출고 테이블 직접 쓰기 0

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (생성자 `:247-259`, `cancelBeforeBoxingFull` `:1199`, `cancelBeforeBoxingPartial` `:1398`, `adjustFulfillmentForPartialCancellation` `:2216`, `getCancellableUnprocessedFulfillmentQty` `:2351`, `releaseFulfillmentOrderItemReservations` `:2368` 삭제, `CANCELLABLE_FULFILLMENT_STATUSES` `:211` 삭제)
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts` (`UnboxedDemandModule` import)
- Modify: `new SalesOrdersService(` 를 부르는 12곳(`grep -rln "new SalesOrdersService(" apps/core/src`) — `logistics.lifecycle, logistics.productSkuMapping, logistics.sellable` 자리를 아래 새 순서로
- Modify: `apps/core/src/modules/sales-order/order-cancellation/order-cancellation.guard.spec.ts`, `fulfillment/unboxed-demand/unboxed-demand-callers.guard.spec.ts`
- Create: `scripts/ops/k7-pr3-predeploy-check.js`
- Modify: `docs/adr/0049-order-cancellation-one-kernel-owns-the-sequence.md`(«현재 상태»), 스펙 §10
- Test: `services/sales-orders.cancellation-reads.integration.spec.ts`(`foItemQty` → `foItemDemand` = `qty − canceledQty`), `services/sales-orders.service.spec.ts`(상자 전 FOI 단언), `channel-order-change/channel-order-change.integration.spec.ts`, `channel-cancel-request/cancellation-plan.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `UnboxedDemandCancellation`·`UnboxedDemandItem`·`ReducedDemandItem`·`CanceledFulfillmentOrder`, `Wired.unboxedDemand`
- Produces:
  ```ts
  // 새 생성자 순서 — reservationLifecycle·productSellableQuantity 가 빠지고 unboxedDemand 가 들어온다
  constructor(db, fulfillmentsV1, coreOrders, unboxedDemand: UnboxedDemandCancellation, productSkuMapping, fulfillmentBacklog,
              @Optional() audit?, @Optional() metrics?, @Optional() library?, @Optional() moduleRef?)
  ```

- [ ] **Step 1: 실패하는 테스트**
  - 가드(`order-cancellation.guard.spec.ts` 에 추가):
    - `it('판매주문 코드는 출고 테이블을 직접 쓰지 않는다 — K3 본편 둘만 예외')` — `apps/core/src/modules/sales-order` 에서 `/\.(update|insert|delete)\((?:wmsTables|inventoryTables)\.(fulfillmentOrders|fulfillmentOrderItems|stockReservations|shipments|shipmentLines)\)|\b(update|insert\s+into|delete\s+from)\s+"?(fulfillment_orders|fulfillment_order_items|stock_reservations|shipments|shipment_lines)\b/i` 를 쓰는 파일 = `[channel-order-change.manager.ts, entrance-password-cleaner.ts]`.
    - `it('판매주문은 예약 서비스를 모른다')` — `/ReservationLifecycleService|UnifiedReservationService|ShipmentReservationService/` 를 쓰는 `apps/core/src/modules/sales-order` 파일 = `[]`.
  - `unboxed-demand-callers.guard.spec.ts` 기대를 `['apps/core/src/modules/sales-order/services/sales-orders.service.ts']` 로.
  - 통합(`cancellation-reads` 에 추가):
    - `it('상자 전 부분 on an item already reduced the old way divides by the current demand')` — `seedFo(qty 3)` 뒤 FOI `qty 2` 로 직접 깎고 판매주문 취소 기록 1(라인 남은 2)을 남긴 상태에서 `cancel(lines:[1])` → FOI `{ qty: 2, canceledQty: 1 }`(Review Focus 1). 취소 기록은 `recordSalesOrderCancellation(tx, {…partial…}, [{ salesOrderLineId, quantity: 1 }])`.
    - `it('상자 전 전체 of a drop-ship FO leaves no outstanding demand')` — 직배 FO qty 2 전체취소 → FOI `canceledQty 2`, FO `canceled`, `readLineQuantities(tx, so)` 의 그 라인 SKU `outstanding 0`(Review Focus 4).
  - 기존 단언 옮기기: `'관리자 상자 전 취소 of a forwarded drop-ship still reduces items'`·`'… ignores a shipped fo flag …'` 는 `foItemDemand` 1 로, `'… shipped status fo … is refused'` 는 `foItemDemand` 2 로. unit spec `sales-orders.service.spec.ts:1416` 류는 `{ qty: 3, canceledQty: 1, shippedQty }` 꼴로.

- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/order-cancellation/order-cancellation.guard.spec.ts apps/core/src/modules/fulfillment/unboxed-demand` → FAIL(`sales-orders.service.ts` 가 세 테이블을 쓴다, 호출자 0).

- [ ] **Step 3: 구현**
  - 전체: FO·FOI `FOR UPDATE` 두 줄을 `lockForCancellation` 으로, 출고 증거 판정(FO `shipped`·`completed`·`shippedAt`, `hasShippedSku`)은 그대로 판매주문에서, FO 루프(예약 해제·status UPDATE)는 `unboxedDemand.cancelOrder(id, trx)` 한 번(예약 해제는 N13 대로 지운다) — 반환으로 `cancelled_fulfillment_order` 효과(`metadata: { previousStatus }`)와 로그 건수를 만든다.
  - 부분: FO·FOI 잠금·읽기를 `lockForCancellation` 으로. `adjustFulfillmentForPartialCancellation` 은 `UnboxedDemandItem[]` 를 받아 지금 판정을 새 표현으로 한다 — 항목 거름 `qty − canceledQty > 0`, 나눠떨어짐 분자 `Σ(qty − canceledQty) − 앞선 보존 출고`, 줄일 수 있는 수량 `Σ cancellableQty`, 출고 뒤 몫·`shippedEvidenceQty` 판정과 문구 그대로. 분배 결과를 모아 라인마다가 아니라 **요청 전체에 `reduce` 한 번**(FOI id 순), 반환 `ReducedDemandItem` 으로 `adjusted_fulfillment_order_item` 효과(N15)를 만든다. `fulfillmentDeltas` 와 FO UPDATE 루프는 지운다(명령이 투영한다).
  - 생성자를 새 순서로. `wireLogistics` 를 쓰는 곳은 `logistics.unboxedDemand, logistics.productSkuMapping, logistics.backlog` 로, 목을 넘기는 unit spec(`sales-orders.service.spec.ts` 등)은 `UnboxedDemandCancellation` 목(`lockForCancellation`·`reduce`·`cancelOrder`)을 그 자리에. 모듈에 `UnboxedDemandModule`.
  - `scripts/ops/k7-pr3-predeploy-check.js`: 머리 주석·접속은 `scripts/ops/1063-pr4-contract-preflight.js` 꼴(READ ONLY 트랜잭션, database `core`). 줄: ① 열린(`shipped`·`completed`·`canceled` 아닌) 상자 전 FO(새 상자 줄 없음 = `opened_for_fulfillment_order_id IS NULL` 인 상자에 오른 FOI 가 없음)를 `fulfillment_mode × status` 로 ② N13: 확정 예약 중 `target_type <> 'SHIPMENT_LINE'` 이거나 `fulfillment_order_item_id IS NOT NULL` 인 행 수 — 0 이 아니면 `✗ 그 주문의 상자 전 취소가 500` ③ 롤백 판정: 상자 전 FO 의 `canceled_qty > 0` FOI 수(배포 전 0 이어야 정상, 배포 뒤 0 이 아니면 롤백 금지). 10-24 실측 쿼리는 `/tmp/claude-1000/-home-pauseb-workspace-almondyoung-server/d0668d39-0337-4131-99c6-ad8e11d8395b/scratchpad/k7-pr3-live-probe.js` 를 참고.
  - ADR-0049 «현재 상태»에 한 단락: «PR 3: 상자 전 취소는 출고 모듈 `UnboxedDemandCancellation` 을 부른다 — FOI 취소 표현은 `canceledQty` 하나, FO status 는 투영(D3·D4). 판매주문 코드의 출고 테이블 직접 쓰기는 K3 본편 둘만 남았다(가드).» 스펙 §10 에 `- PR 3: 상자 전 취소의 출고 명령 — UnboxedDemandCancellation, D3·D4, 직배 조회·완료가 canceledQty 를 뺀다.`

- [ ] **Step 4: 통과 확인** — 검증 게이트 전부(Global Constraints). 통합(`k6_it`): sales-order 전체 + `fulfillment/unboxed-demand` + `direct-ship.canceled-demand` 기준선 외 실패 0. `node --check scripts/ops/k7-pr3-predeploy-check.js`.

- [ ] **Step 5: 커밋** — `git commit -m "refactor(core): 상자 전 취소가 출고 명령을 부른다 — 판매주문 코드의 FO·FOI·예약 직접 쓰기 0 (K7 PR3, D3·D4)"`
