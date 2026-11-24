# 입고하면 갖춰진 상자가 보이고, 고른 배치에 넣어 송장이 나온다 (#1533) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고·적치 화면 네 곳에 «미발송 주문» 칸을 두고, 갖춰진 상자를 작업자가 고른 진행 중 배치에 넣어 송장까지 한 번에 뽑게 한다.

**Architecture:** core 에 읽기 경로 `GET /ready-shipments` 하나와, 입고 확정 직후 그 상품의 예약 재시도를 돌리는 포트(inventory 가 정의, fulfillment 가 구현)를 더한다. 창고앱은 그 목록을 보이고, [송장 출력] → 배치 고르기 → (draft 면) 계획 → 기존 `joinBoxIntoBatch`(발급·합류·출력)를 부른다. 새 서버 쓰기 경로는 없다.

**Tech Stack:** NestJS 11 + Drizzle(postgres.js), Jest(core) / React + TanStack Query + Vitest(warehouse-app, Tauri)

**Spec:** `docs/superpowers/specs/2026-11-25-inbound-ready-boxes-1533-design.md`

## Global Constraints

- 레이어: Controller → Service → Reader/Manager → Repository. 컨트롤러는 try/catch 로 상태를 매핑하지 않는다.
- 트랜잭션: `this.dbService.run(async (trx) => …, tx)`, 공개 메서드 마지막 인자 `tx?: DbTx`. per-class `inTx` 금지(ADR-0025).
- `any`·근거 없는 `as` 금지. 새 라우트는 `@RequirePermission(...)` 을 단다(`route-classification.spec.ts`).
- 목록 조회 권한 `fulfillment.shipment.read`. 쓰기(계획·발급·합류)는 기존 경로 그대로 `fulfillment.warehouse.operate`.
- 받는 분은 가린 이름(`maskName(readRecipientName(snapshot))`)만 응답한다 — 합류 후보 조회와 같은 수준이라 `@PiiResponse` 선언 없음.
- 목록 기준은 **그 화면의 입고 줄**이다: 그 줄 시각 이후에 잡힌 예약으로 다 찬 상자만(입고 전부터 갖춰진 상자는 빠진다, 사용자 확인 2026-11-25). 입고 줄 상한 100, 앱은 100개씩 나눠 부른다.
- 시작한 배치 = `startedAt !== null`. 파생 상태 `picking` 만 보지 않는다(spec §[송장 출력] 1).
- 합배송 가능 상자도 그대로 넣고 표시하지 않는다. 화주로 거르지 않는다. 취소 요청을 따로 거르지 않는다(spec).
- 입고 직후 재시도: 커밋 뒤, 응답 전에 await, 실패는 로그만(입고는 성공). `FulfillmentWorkflowGate.shouldRunReservationRetry()` 가 false 면 아무것도 안 한다.
- 화면 문구(정확히):
  - 칸 제목 `미발송 주문`
  - 적치 필요 상자 안내 `적치하면 나갈 수 있어요`
  - 버튼 `송장 출력`
  - 덧붙임 `다른 상품을 기다리는 주문 {N}건`
  - 배치 없음 `진행 중인 배치가 없어요. 출고작업에서 배치를 시작해 주세요.`
- 검증 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0, `(cd native/warehouse-app && npx tsc -b && npx vitest run)` 실패 0.
  🔴 로컬 E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다(RAM). 워크트리에서 전체 jest 전에 admin-web·wallet-web·warehouse-app 의 node_modules 링크를 확인한다.

## Review Focus

1. **누른 뒤에 막힘** — 목록을 읽은 뒤 다른 작업자가 같은 재고를 먼저 합류시키면 «출력 가능»이었던 상자가 `INBOUND_PENDING`/`STOCK_SHORT` 로 막힌다. 앱은 합류 막힘 문구를 보이고 목록을 다시 읽어야 한다 → Task 6 `막히면 사유를 보이고 목록을 다시 읽는다`.
2. **계획은 됐는데 합류가 실패** — draft → planned 로 바뀐 뒤 합류가 막혀도 다음 시도가 계획을 건너뛰고(`already`) 이어져야 한다 → Task 5 `planned 상자는 계획을 부르지 않는다`·`계획 응답이 already 면 이어 간다`.
3. **연타** — [송장 출력]·배치 선택을 빠르게 두 번 누르면 같은 송장이 두 장 나오면 안 된다(ref 로 막는다, `ReprintLabelButton` 과 같은 이유) → Task 6 `처리 중에는 두 번째 선택이 아무것도 보내지 않는다`.
4. **옛 서버** — core 가 아직 이 경로를 모르면(404) 칸이 아예 없어야 하고 입고 화면이 깨지지 않아야 한다 → Task 5 `404 면 빈 목록`.
5. **주문번호 없는 상자** — 앱은 주문번호로 합류 후보를 찾으므로, 주문번호가 없는 상자가 목록에 오면 누를 때 반드시 실패한다 → Task 2 `주문번호가 없는 상자는 빠진다`.

---

## File Structure

**core (`apps/core/src/modules/`)**
- Create `fulfillment/reader/ready-shipments.calc.ts` (+ `.spec.ts`) — 상자별 `ready`/`putaway_required` 판정(순수 함수).
- Create `fulfillment/reader/sku-stock-budget.ts` — SKU 별 «바로 집을 수 있는 수량·적치 대기 수량». `WaitingOrdersReader.stockBudgets` 를 옮겨 온다.
- Modify `fulfillment/reader/waiting-orders.reader.ts` — 위 함수를 쓴다(동작 불변).
- Create `fulfillment/reader/ready-shipments.reader.ts` (+ `.integration.spec.ts`) — 목록 조회.
- Create `fulfillment/dto/ready-shipments.dto.ts`, `fulfillment/controllers/ready-shipments.controller.ts`.
- Modify `fulfillment/fulfillment.module.ts` — 컨트롤러·리더 등록.
- Create `fulfillment/services/reservation-retry-candidates.ts` — 재시도 후보 SQL(워커에서 뽑아 냄, 상품·창고 거르기 추가).
- Modify `fulfillment/services/fulfillment-order-reservation-retry.worker.ts` — 위 함수를 쓴다(동작 불변).
- Create `inventory/inbound/kernel/inbound-arrival-reservations.port.ts` — 포트.
- Create `fulfillment/stock-removal/arrival-reservation-retry.ts` (+ `.integration.spec.ts`) — 포트 구현.
- Modify `fulfillment/stock-removal/stock-removal.module.ts` — 구현 제공·export, `FulfillmentWorkflowGate` 제공.
- Create `inventory/inbound/services/inbound-arrival-follow-up.ts` (+ `.spec.ts`) — 포트를 감싸 실패를 삼키고 로그.
- Modify `inventory/inbound/inbound.module.ts` — follow-up 제공·export.
- Modify `inventory/inbound/services/inbound.service.ts`, `inventory/procurement/services/purchase-order-receiving.manager.ts`, `inventory/inbound-shipment/services/inbound-shipment-receiving.manager.ts` — 입고 기록 뒤 follow-up 호출.

**warehouse-app (`native/warehouse-app/src/domains/`)**
- Create `inbound/readyShipments.ts` (+ `.test.tsx`) — 타입·`useReadyShipments` 훅.
- Create `outbound/printIntoBatch.ts` (+ `.test.ts`) — 계획 → 후보 → `joinBoxIntoBatch`.
- Create `inbound/ReadyShipmentsSection.tsx` (+ `.test.tsx`) — 칸·배치 고르기·결과.
- Modify `inbound/mutations.ts` — `READY_SHIPMENTS_KEY` 무효화 추가.
- Modify `inbound/QuickInboundScreen.tsx`, `inbound/PurchaseOrderReceiveScreen.tsx`, `inbound/PutawayQueueScreen.tsx`, `inbound/PutawaySheet.tsx` — 칸 붙이기.

---

### Task 1: 상자별 준비 판정 (core, 순수 함수)

**Files:**
- Create: `apps/core/src/modules/fulfillment/reader/ready-shipments.calc.ts`
- Test: `apps/core/src/modules/fulfillment/reader/ready-shipments.calc.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Readiness = 'ready' | 'putaway_required';
  export interface ReadyBoxInput { shipmentId: string; lines: readonly { skuId: string; qty: number }[] }
  export interface SkuBudget { pickableQty: number; inboundPendingQty: number }
  /** boxes 는 재고 대기 순번대로. 빠진 상자(대기분까지 써도 모자람)는 Map 에 없다. */
  export function judgeReadiness(boxes: readonly ReadyBoxInput[], budgets: ReadonlyMap<string, SkuBudget>): Map<string, Readiness>;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `describe('judgeReadiness')`:
  - `바로 집을 수 있는 재고로 다 되면 ready` — budgets `{X:{pickableQty:2,inboundPendingQty:0}}`, box A `[X×2]` → `A:'ready'`.
  - `적치 대기분이 있어야 되면 putaway_required` — `{X:{1,1}}`, A `[X×2]` → `A:'putaway_required'`.
  - `대기분까지 써도 모자라면 빠진다` — `{X:{1,0}}`, A `[X×2]` → `has('A') === false`.
  - `앞선 상자가 먼저 쓴다` — `{X:{1,1}}`, A `[X×1]`, B `[X×1]` → `A:'ready'`, `B:'putaway_required'`.
  - `여러 상품 상자는 모든 상품이 되어야 한다` — `{X:{1,0}, Y:{0,0}}`, A `[X×1, Y×1]` → 빠짐. 그리고 그 뒤 B `[X×1]` → `B:'ready'`.
  - `빠진 상자는 재고를 쓰지 않는다` — 바로 위 케이스의 B 가 그 증거다(같은 테스트에서 단언).
  - `같은 상품 줄이 둘이면 합쳐 센다` — `{X:{2,0}}`, A `[X×1, X×2]` → 빠짐.
  - `예산이 없는 상품은 0` — 빈 Map, A `[X×1]` → 빠짐.
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/fulfillment/reader/ready-shipments.calc.spec.ts` → FAIL(모듈 없음).
- [ ] **Step 3: `judgeReadiness` 구현** — 상품별 남은 `pick`·`pend` 를 복사해 들고, 상자마다 상품별 필요량을 합친 뒤:
  - 모든 상품이 `need <= pick` → `ready`, `pick -= need`.
  - 아니면 모든 상품이 `need <= pick + pend` → `putaway_required`, `pick` 을 먼저 쓰고 나머지를 `pend` 에서.
  - 아니면 빠지고 아무것도 쓰지 않는다.
  - 음수 예산은 0 으로 본다. 입력은 바꾸지 않는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 5: 커밋** — `git commit -m "[core] #1533 입고로 갖춰진 상자의 바로 출력·적치 필요 판정"`

### Task 2: 목록 리더 (core)

**Files:**
- Create: `apps/core/src/modules/fulfillment/reader/sku-stock-budget.ts`
- Modify: `apps/core/src/modules/fulfillment/reader/waiting-orders.reader.ts` (`stockBudgets` 를 새 함수로 교체)
- Create: `apps/core/src/modules/fulfillment/reader/ready-shipments.reader.ts`
- Test: `apps/core/src/modules/fulfillment/reader/ready-shipments.reader.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `judgeReadiness`, `SkuBudget`.
- Produces:
  ```ts
  // sku-stock-budget.ts
  export interface SkuStockBudget { onHandQty: number; pickableQty: number; inboundPendingQty: number }
  /** pickable = ON_HAND − 배치 세션이 쥔 몫(SETTLED 제외, active·recovery_required) − 적치 전 입고 */
  export async function loadSkuStockBudgets(trx: DbTx, warehouseId: string, skuIds: readonly string[]): Promise<Map<string, SkuStockBudget>>;

  // ready-shipments.reader.ts
  export interface ReadyShipment {
    shipmentId: string; status: 'draft' | 'planned'; orderNos: string[]; recipientMasked: string;
    skuCount: number; totalQty: number; readiness: Readiness;
  }
  export interface ReadyShipments { items: ReadyShipment[]; waitingOnOtherSkus: number }
  @Injectable() export class ReadyShipmentsReader {
    constructor(@InjectTypedDb<typeof wmsSchema>() dbService: DbService<typeof wmsSchema>, preparation: OutboundPreparationReader);
    forReceiptLines(warehouseId: string, receiptLineIds: readonly string[], tx?: DbTx): Promise<ReadyShipments>;
  }
  ```

- [ ] **Step 1: `loadSkuStockBudgets` 로 옮긴다** — `WaitingOrdersReader.stockBudgets` 의 세 쿼리(ON_HAND·통제·적치 전 입고)를 그대로 옮기고, 적치 전 입고를 `inboundPendingQty` 로 따로 돌려준다. `WaitingOrdersReader` 는 `{ pickableQty, unreservedQty: onHandQty }` 로 바꿔 쓴다.
- [ ] **Step 2: 기존 스펙으로 동작 불변 확인** — `npm run test:core:integration:local -- waiting-orders.reader.integration` → PASS(로컬 compose DB).
- [ ] **Step 3: 실패하는 통합 스펙을 쓴다** — `describeIfDb('입고로 갖춰진 상자')`. `waiting-orders.reader.integration.spec.ts` 의 fixture(`seedPickableShipment`·`seedShipmentForExistingStock`·`makeInboundReceiptKernel`·`startBatchFor`·`seedHandedOverOrder`·`inRollbackTx`)를 쓴다.
  - `입고 뒤 잡힌 예약으로 다 찬 상자가 적치 전에는 putaway_required, 적치하면 ready` — 예약을 푼 상자 → `recordArrival` → 그 줄에 예약을 새로 만든다(`ArrivalReservationRetry` 가 아직 없으면 `ShipmentReservationService.reservePartial`) → 그 입고 줄 id 로 조회 `putaway_required` → `kernel.putaway` → `ready`. `orderNos` 비어 있지 않음, `recipientMasked` 는 원문이 아님.
  - `입고 전부터 다 갖춰져 있던 상자는 나오지 않는다` — 같은 상품이 든 상자의 예약이 입고 줄보다 먼저 만들어졌다 → items 에 없음, `waitingOnOtherSkus` 에도 없음.
  - `다른 창고·취소된 회차·없는 입고 줄은 무시한다` — 빈 결과, 던지지 않는다.
  - `예약이 덜 찬 상자는 빠지고, 다른 상품이 모자라면 waitingOnOtherSkus 에 센다` — 기준 상품 줄은 입고 뒤 예약으로 다 찼고 다른 상품 줄이 모자란 상자 → items 에 없음, `waitingOnOtherSkus: 1`. 기준 상품 줄 자체가 덜 찬 상자는 셈에도 없다.
  - 아래 다섯은 모두 «입고 뒤 예약으로 다 찬 상자»를 만든 뒤 한 가지만 바꾼다:
    - `진행 중인 배치에 든 상자는 빠진다` — `startBatchFor` 뒤 items 비어 있음.
    - `셀메이트가 넘겨받은 상자는 빠진다`.
    - `정보가 부족한 상자는 빠진다` — 받는 분 스냅샷 이름을 비운 상자.
    - `주문번호가 없는 상자는 빠진다`.
    - `planned 상자도 나온다` — `status:'planned'`.
- [ ] **Step 4: 실패 확인** — `npm run test:core:integration:local -- ready-shipments.reader.integration` → FAIL(모듈 없음).
- [ ] **Step 5: `ReadyShipmentsReader.forReceiptLines` 구현** — `dbService.run` 안에서:
  0. 기준을 읽는다. `inbound_receipt_lines` ⋈ `inbound_receipts`(`status='posted'`, `warehouse_id = warehouseId`) 에서 받은 id 의 `sku_id` 와 `created_at` 을 읽고, 상품마다 가장 이른 시각을 `since: Map<skuId, Date>` 로 둔다. 비면 `{ items: [], waitingOnOtherSkus: 0 }`.
  1. 후보를 고른다. 이 창고, `supplierId IS NULL`, `status IN ('draft','planned')` 인 상자 중, 기준 상품 줄에 `stock_reservations`(`target_type='SHIPMENT_LINE'`, `status='confirmed'`, `created_at >= since[그 상품]`) 가 있는 상자 id(중복 없이)다. 상품별 시각 비교는 `(sku_id, since)` 값 목록을 조인해 한 쿼리로 한다.
  2. `loadSellmateShipmentIds` 로 셀메이트 상자를 뺀다. 진행 중 작업 항목(`outbound_batch_work_items.status NOT IN ('excluded','completed')`)이 있는 상자도 뺀다.
  3. 남은 상자의 모든 줄을 읽는다. `loadShipmentLines`(주문번호·`skuProfileId`)와 `this.preparation.lineQuantities`(`qty`·`confirmedQty`)를 쓴다.
     `classifyPreparation({…, consolidationPeerLines: []})` 로 나눈다.
     - `ready`·`resume` 은 판정 대상이다(`consolidationPeerLines: []` 라 `mergeable` 은 나오지 않는다 — 사용자 결정).
     - `needs_info` 는 뺀다. 이때 `recipientComplete` 는 `isRecipientComplete`, `externalLinesTrusted` 는 `loadUntrustedLineSkus` 로 채운다.
     - `partial`·`unavailable` 중 기준 상품 줄은 모두 다 찼고 다른 상품 줄이 모자란 상자는 `waitingOnOtherSkus` 로 센다.
  4. 주문번호(`displayOrderNo ?? channelOrderId`, 중복 제거·정렬)가 없는 상자를 뺀다.
  5. 판정 대상의 줄을 `reservationQueueOrderSql(sql\`shipment_lines\`, sql\`fulfillment_orders\`)` 순으로 읽어, 상자가 처음 나온 순서를 대기 순번으로 쓴다.
  6. 판정 대상 상자들의 모든 상품으로 `loadSkuStockBudgets` 를 부르고 `judgeReadiness` 를 돌린다. Map 에 없는 상자는 뺀다.
  7. `recipientMasked = maskName(readRecipientName(recipientSnapshot))` 다. `skuCount` 는 서로 다른 상품 수, `totalQty` 는 줄 수량 합이다. 순서는 5의 대기 순번이다.
- [ ] **Step 6: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 7: 커밋** — `git commit -m "[core] #1533 상품을 포함해 다 갖춰진 상자 목록 리더"`

### Task 3: 읽기 경로 `GET /ready-shipments` (core)

**Files:**
- Create: `apps/core/src/modules/fulfillment/dto/ready-shipments.dto.ts`
- Create: `apps/core/src/modules/fulfillment/controllers/ready-shipments.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (controllers·providers)

**Interfaces:**
- Consumes: Task 2 `ReadyShipmentsReader.forReceiptLines`.
- Produces: `GET /ready-shipments?warehouseId=<uuid>&receiptLineIds=<uuid,…>` → `ReadyShipmentsDto { items: ReadyShipmentDto[]; waitingOnOtherSkus: number }`. `ReadyShipmentDto` 필드는 Task 2 `ReadyShipment` 와 같다(`readiness` 는 `@ApiProperty({ enum: ['ready','putaway_required'] })`).

- [ ] **Step 1: 컨트롤러·DTO 작성** — `WaitingOrdersController` 와 같은 꼴이다.
  - `@ApiTags('Outbound')`, `@RequirePermission('fulfillment.shipment.read')`, `@Get('ready-shipments')`.
  - `warehouseId` 는 `ParseUUIDPipe` 로 받는다.
  - `receiptLineIds` 는 1~100개 UUID 여야 한다. 아니면 `BadRequestException('receiptLineIds must contain between 1 and 100 UUIDs')`.
  - 넘길 때 소문자로 바꾼다.
- [ ] **Step 2: 모듈 등록** — `ReadyShipmentsController` 를 controllers 에, `ReadyShipmentsReader` 를 providers 에 둔다(`WaitingOrdersReader` 옆).
- [ ] **Step 3: 게이트 확인** — `npx jest scripts/security/route-classification.spec.ts scripts/security/pii-routes.spec.ts` → PASS. 그리고 `npm run type-check` → 에러 0.
- [ ] **Step 4: 커밋** — `git commit -m "[core] #1533 GET /ready-shipments"`

### Task 4: 입고 확정 직후 그 상품의 예약 재시도 (core)

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/reservation-retry-candidates.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-order-reservation-retry.worker.ts` (`findCandidates` 가 새 함수를 부른다)
- Create: `apps/core/src/modules/inventory/inbound/kernel/inbound-arrival-reservations.port.ts`
- Create: `apps/core/src/modules/fulfillment/stock-removal/arrival-reservation-retry.ts`
- Test: `apps/core/src/modules/fulfillment/stock-removal/arrival-reservation-retry.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/stock-removal/stock-removal.module.ts`
- Create: `apps/core/src/modules/inventory/inbound/services/inbound-arrival-follow-up.ts`
- Test: `apps/core/src/modules/inventory/inbound/services/inbound-arrival-follow-up.spec.ts`
- Modify: `apps/core/src/modules/inventory/inbound/inbound.module.ts`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`simpleInbound`·`simpleInboundFullscan`·`individualInbound`)
- Modify: `apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.manager.ts` (`receive`)
- Modify: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-receiving.manager.ts` (`receiveBox`)

**Interfaces:**
- Produces:
  ```ts
  // reservation-retry-candidates.ts — 워커의 SQL 그대로. filter 가 있으면 sl.sku_id = ANY, shipment.warehouse_id = 를 더한다.
  export function findReservationRetryCandidates(db: DbTx | DbService<typeof wmsSchema>['db'], limit: number,
    filter?: { warehouseId: string; skuIds: readonly string[] }): Promise<Array<{ id: string; qty: number }>>;

  // inbound-arrival-reservations.port.ts
  export abstract class InboundArrivalReservations {
    /** 방금 들어온 상품을 기다리던 draft 줄의 예약을 대기 순번대로 다시 잡는다. 재고가 바닥나면 멈춘다. */
    abstract retryForSkus(warehouseId: string, skuIds: readonly string[], tx?: DbTx): Promise<void>;
  }

  // arrival-reservation-retry.ts
  export const ARRIVAL_RETRY_LIMIT = 50;
  @Injectable() export class ArrivalReservationRetry extends InboundArrivalReservations { … }

  // inbound-arrival-follow-up.ts
  @Injectable() export class InboundArrivalFollowUp {
    constructor(reservations: InboundArrivalReservations);
    /** 입고가 커밋된 뒤에 부른다. 던지지 않는다 — 실패는 warn 로그만, 크론이 이어서 채운다. */
    afterArrival(warehouseId: string, skuIds: readonly string[]): Promise<void>;
  }
  ```

- [ ] **Step 1: 후보 SQL 을 뽑아 낸다** — 워커 `findCandidates` 의 SQL 을 `findReservationRetryCandidates` 로 옮긴다. 정렬(`reservationQueueOrderSql(sql\`sl\`, sql\`fo\`), sl.id`)과 조건은 같고, `sl.qty` 를 함께 돌려준다. 워커의 게이트 확인과 `limit 20` 은 워커에 남긴다.
- [ ] **Step 2: 워커 동작 불변 확인** — `npx jest apps/core/src/modules/fulfillment/services/fulfillment-order-reservation-retry` 와 `npm run test:core:integration:local -- reservation-retry` → PASS.
- [ ] **Step 3: 실패하는 통합 스펙을 쓴다** — `describeIfDb('입고 직후 예약 재시도')`. fixture 는 Task 2 와 같다.
  - `방금 들어온 상품의 미예약 draft 줄에 크론 없이 예약이 잡힌다` — 예약을 푼 상자 + `recordArrival` 뒤 `retryForSkus(wh, [sku], tx)` → 그 줄 `confirmed` 합 = 줄 수량.
  - `다른 상품·다른 창고의 줄은 건드리지 않는다`.
  - `재고가 모자라면 대기 순번 앞의 줄부터 잡는다` — 두 상자, 재고 1 → 앞선 상자만.
  - `재시도 스위치가 꺼져 있으면 아무것도 하지 않는다` — gate `shouldRunReservationRetry` 가 false 인 가짜.
- [ ] **Step 4: 실패 확인** — `npm run test:core:integration:local -- arrival-reservation-retry.integration` → FAIL.
- [ ] **Step 5: 포트·구현·배선**
  - 구현: `ArrivalReservationRetry.retryForSkus` 는 gate 가 false 거나 `skuIds` 가 비었으면 바로 끝낸다. 아니면 `findReservationRetryCandidates(…, ARRIVAL_RETRY_LIMIT, { warehouseId, skuIds })` 의 줄마다 `ShipmentReservationService.reservePartial(id, qty, tx)` 를 부른다.
    - 줄 하나가 던지면 그 줄만 건너뛴다(크론과 같은 처리).
    - 크론과 겹쳐도 안전하다. `reservePartial` 이 잠금 아래에서 다시 계산한다.
  - `StockRemovalModule`: providers 에 `FulfillmentWorkflowGate`·`{ provide: InboundArrivalReservations, useClass: ArrivalReservationRetry }` 를 더하고, exports 에 `InboundArrivalReservations` 를 더한다.
- [ ] **Step 6: 통과 확인** — Step 4 명령 → PASS.
- [ ] **Step 7: follow-up 단위 스펙을 쓴다** — `describe('InboundArrivalFollowUp')`:
  - `중복 없는 상품으로 포트를 부른다` — `['a','a','b']` → `retryForSkus('wh', ['a','b'])`.
  - `포트가 던져도 던지지 않는다` — `rejects` 하는 포트 → `afterArrival` 이 resolve.
- [ ] **Step 8: 실패 확인 → 구현 → 통과** — `npx jest apps/core/src/modules/inventory/inbound/services/inbound-arrival-follow-up.spec.ts`. 구현은 `new Logger(InboundArrivalFollowUp.name).warn` 로 실패를 남긴다. `InboundModule` providers·exports 에 `InboundArrivalFollowUp` 을 더한다.
- [ ] **Step 9: 다섯 입고 경로에서 부른다** — 각 메서드에서 `run`/`withIdempotency` 가 돌려준 뒤 부른다.
  - 조건: 그 메서드가 트랜잭션 주인일 때(`tx === undefined`)만 `await this.arrivalFollowUp.afterArrival(warehouseId, 입고한 skuIds)` 를 부른다.
  - 바깥 트랜잭션 안(예: `demo-practice.service.ts`)에서는 커밋 전이라 부르지 않는다. 크론이 맡는다.
  - 결과는 그대로 돌려준다.
  - `InboundShipmentReceivingManager.receiveBox` 는 실제로 `recordArrival` 을 탄 갈래만 부른다(이미 받은 상자 재시도면 skuIds 가 비어 포트가 바로 끝난다).
- [ ] **Step 10: 호출 단위 스펙** — `inbound.service` 스펙(없으면 `inbound-arrival-follow-up.spec.ts` 에 InboundService 를 가짜 커널로 세워)에 두 테스트를 둔다.
  - `tx 없이 간편입고하면 입고한 상품으로 afterArrival 을 부른다`
  - `바깥 tx 로 부르면 afterArrival 을 부르지 않는다`
  - 실행: `npx jest apps/core/src/modules/inventory/inbound` → PASS.
- [ ] **Step 11: 게이트** — `npm run type-check` → 에러 0.
- [ ] **Step 12: 커밋** — `git commit -m "[core] #1533 입고 확정 직후 그 상품의 예약 재시도를 바로 돌린다"`

### Task 5: 목록 훅과 «고른 배치에 넣어 출력» 동작 (warehouse-app)

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/readyShipments.ts`
- Test: `native/warehouse-app/src/domains/inbound/readyShipments.test.tsx`
- Create: `native/warehouse-app/src/domains/outbound/printIntoBatch.ts`
- Test: `native/warehouse-app/src/domains/outbound/printIntoBatch.test.ts`
- Modify: `native/warehouse-app/src/domains/inbound/mutations.ts` (`invalidateAfterLedgerWrite` 에 `READY_SHIPMENTS_KEY`)

**Interfaces:**
- Consumes: Task 3 응답 모양. 기존 `JoinDeps`·`JoinOutcome`·`joinBoxIntoBatch`·`fetchJoinCandidates`(`outbound/batchJoin.ts`).
- Produces:
  ```ts
  // readyShipments.ts
  export interface ReadyShipment { shipmentId: string; status: 'draft' | 'planned'; orderNos: string[];
    recipientMasked: string; skuCount: number; totalQty: number; readiness: 'ready' | 'putaway_required' }
  export const READY_SHIPMENTS_KEY = 'ready-shipments';
  export function useReadyShipments(warehouseId: string | null, receiptLineIds: readonly string[]):
    { failed: boolean; items: ReadyShipment[]; waitingOnOtherSkus: number; refetch: () => void };

  // printIntoBatch.ts
  export async function printReadyShipmentIntoBatch(deps: JoinDeps, batchId: string, shipment: ReadyShipment): Promise<JoinOutcome>;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `readyShipments.test.tsx` — `waitingOrders.test.tsx` 의 가짜 ApiClient 꼴을 따른다.
    - `입고 줄 100개씩 나눠 부르고 합친다`(150개 → 요청 2번, `receiptLineIds=` 쿼리, items·`waitingOnOtherSkus` 합)
    - `404 면 빈 목록`
    - `다시 읽기 실패면 failed 이고 옛 목록을 보이지 않는다`
    - `창고가 없거나 입고 줄이 없으면 부르지 않는다`
  - `printIntoBatch.test.ts` — `batchJoin.test.ts` 의 가짜 deps 꼴을 따른다.
    - `draft 상자는 계획을 부른 뒤 합류한다` — 요청 순서 `POST /outbound-preparation/plans {shipmentIds:[id]}`(idempotencyKey 있음) → `GET /outbound-batches/{batchId}/join-candidates?code={orderNos[0]}` → 이후 `joinBoxIntoBatch` 의 요청.
    - `planned 상자는 계획을 부르지 않는다`
    - `계획 응답이 already 면 이어 간다` — `succeeded` 에 id 가 있으면 진행.
    - `계획이 거절되면 그 사유로 blocked` — `failed:[{code:'SHIPMENT_PROFILE_INCOMPATIBLE', message:'배송 프로필을 정할 수 없어요'}]` → `{kind:'blocked', message:'배송 프로필을 정할 수 없어요'}`, 이후 요청 없음.
    - `후보에 그 상자가 없으면 blocked` — 후보가 다른 shipmentId 뿐 → `message: '이 상자를 배치에서 찾지 못했어요. 목록을 새로 고쳐 주세요.'`
- [ ] **Step 2: 실패 확인** — `(cd native/warehouse-app && npx vitest run src/domains/inbound/readyShipments.test.tsx src/domains/outbound/printIntoBatch.test.ts)` → FAIL.
- [ ] **Step 3: 구현**
  - `useReadyShipments` 는 `useWaitingOrders` 와 같은 꼴이다. queryKey `[READY_SHIPMENTS_KEY, warehouseId, ids.join(',')]`, `refetchOnMount:'always'`, 같은 창고일 때만 placeholder 를 쓴다.
  - `printReadyShipmentIntoBatch` 는 순서대로 진행한다.
    - draft 면 계획을 부른다(응답 `{ succeeded: string[]; failed: {shipmentId; code; message}[] }`). failed 에 그 id 가 있으면 그 `message` 로 blocked.
    - 후보 조회 → `shipmentId` 일치 후보 → `joinBoxIntoBatch(deps, batchId, candidate)`.
    - 계획·후보 조회의 예외는 `errorMessage(error, 'outbound')` 로 blocked.
  - `mutations.ts` 의 `invalidateAfterLedgerWrite` 에 `READY_SHIPMENTS_KEY` 를 더한다.
- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS.
- [ ] **Step 5: 커밋** — `git commit -m "[warehouse-app] #1533 갖춰진 상자 목록 훅과 고른 배치에 넣어 송장 출력"`

### Task 6: «미발송 주문» 칸 (warehouse-app)

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/ReadyShipmentsSection.tsx`
- Test: `native/warehouse-app/src/domains/inbound/ReadyShipmentsSection.test.tsx`

**Interfaces:**
- Consumes: Task 5 `useReadyShipments`·`printReadyShipmentIntoBatch`·`READY_SHIPMENTS_KEY`. 기존 `useOutboundBatches`(`outbound/queries.ts`), `isStationDevice`, `readLabelPrinter`, `printRaw`, `localStoragePrefs`.
- Produces:
  ```tsx
  export function ReadyShipmentsSection(props: { warehouseId: string | null; receiptLineIds: readonly string[];
    prefs?: DevicePrefs; print?: PrintRaw; labelPrinting?: boolean /* 기본 isStationDevice() */ }): JSX.Element | null;
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `JoinBoxPanel.test.tsx` 의 렌더 헬퍼(QueryClient·ApiClientProvider·가짜 print)를 따른다.
  - `갖춰진 상자가 없으면 칸을 그리지 않는다` — items 빈 배열, `waitingOnOtherSkus: 0` → `container` 비어 있음.
  - `다른 상품을 기다리는 주문만 있으면 그 한 줄만 보인다` — `다른 상품을 기다리는 주문 2건`.
  - `적치 필요 상자는 안내만 있고 버튼이 없다` — `적치하면 나갈 수 있어요`, `송장 출력` 버튼 없음.
  - `[송장 출력]을 누르면 시작한 배치만 고를 수 있다` — `picking` 응답 1개(startedAt 있음), `created` 응답 2개(하나는 startedAt 있음, 하나는 null) → 선택지 2개, startedAt null 배치는 없음.
  - `진행 중인 배치가 없으면 안내만 보이고 아무 요청도 보내지 않는다` — `진행 중인 배치가 없어요. 출고작업에서 배치를 시작해 주세요.`
  - `배치를 고르기 전에는 쓰기 요청이 없다` — 목록을 연 상태에서 POST 0건.
  - `고르면 출력 결과 문구를 보이고 목록을 다시 읽는다` — `printReadyShipmentIntoBatch` 결과의 `message` 가 보이고, `ready-shipments` 재요청 1건.
  - `막히면 사유를 보이고 목록을 다시 읽는다` — `join_blocked` 결과면 그룹 제목(`JOIN_BLOCKER_TEXT`)이 보이고, `ready-shipments` 재요청이 간다.
  - `처리 중에는 두 번째 선택이 아무것도 보내지 않는다` — 응답을 붙잡아 둔 채 같은 배치를 두 번 고른다 → plans/합류 POST 각 1건.
  - `한 상자를 처리하는 동안 다른 상자의 [송장 출력]은 눌리지 않는다` — 첫 처리 응답을 붙잡아 둔 채 다른 줄의 버튼이 disabled.
- [ ] **Step 2: 실패 확인** — `(cd native/warehouse-app && npx vitest run src/domains/inbound/ReadyShipmentsSection.test.tsx)` → FAIL.
- [ ] **Step 3: 구현**
  - 레이아웃은 spec 의 텍스트 스케치를 따른다. 줄은 `#{orderNos[0]}  {recipientMasked}  상품 {skuCount}종 {totalQty}개` 다.
  - 배치 고르기는 `useOutboundBatches(warehouseId,'picking')`·`'created'` 를 합치고 id 로 중복을 없앤 뒤 `startedAt !== null` 만 남긴다. 줄은 `batchNameOf(batch)`·상자 수(`totalBoxes`)·시작 시각이다.
  - 처리 중에는 ref 로 두 번째 선택을 막는다. 출력 deps 의 `printer` 는 `labelPrinting ? readLabelPrinter(prefs) : null`, `newKey` 는 `crypto.randomUUID()` 다.
  - 결과가 나면 `READY_SHIPMENTS_KEY` 를 무효화한다. `join_blocked` 는 `JoinBoxPanel` 과 같은 그룹 표시를 쓴다.
- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS.
- [ ] **Step 5: 커밋** — `git commit -m "[warehouse-app] #1533 입고 화면의 미발송 주문 칸"`

### Task 7: 네 화면에 붙이기 (warehouse-app)

**Files:**
- Modify: `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx`, `PurchaseOrderReceiveScreen.tsx`, `PutawayQueueScreen.tsx`, `PutawaySheet.tsx`
- Test: 같은 이름의 기존 `.test.tsx` 에 각 한 건

**Interfaces:**
- Consumes: Task 6 `ReadyShipmentsSection`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 네 스펙에 `미발송 주문 칸을 그 화면의 입고 줄로 보인다` 를 하나씩 둔다. 각 화면이 들고 있는 입고 줄 id 로 `/ready-shipments?…receiptLineIds=` 를 부르고, 가짜 응답의 상자 줄이 보여야 한다. 간편입고·발주입고는 `확정 전에는 /ready-shipments 를 부르지 않는다` 도 단언한다.
- [ ] **Step 2: 실패 확인** — `(cd native/warehouse-app && npx vitest run src/domains/inbound)` → 새 4건 FAIL.
- [ ] **Step 3: 붙인다** — 넘기는 입고 줄 id 는 화면마다 다르다. 자리는 상품 목록 아래, 확정 버튼 위다.
  - `QuickInboundScreen`: `staged.map((row) => row.lineId)`(확정 전 `cart` 단계는 빈 배열).
  - `PurchaseOrderReceiveScreen`: 줄마다 이번에 받은 `fresh?.lineId` 중 있는 것.
  - `PutawayQueueScreen`: `items.map((item) => item.lineId)`.
  - `PutawaySheet`: `[target.lineId]`.
- [ ] **Step 4: 전체 앱 게이트** — `(cd native/warehouse-app && npx tsc -b && npx vitest run)` → 실패 0.
- [ ] **Step 5: 저장소 게이트** — `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0(🔴 E2E 스택이 떠 있지 않을 때만).
- [ ] **Step 6: 커밋** — `git commit -m "[warehouse-app] #1533 입고·적치 네 화면에 미발송 주문 칸"`

---

## 배포 메모 (PR 본문용)

- core 먼저, 창고앱 나중이다. 마이그레이션은 없다. 옛 core 를 만난 새 앱은 칸을 그리지 않는다(404).
- 배포 뒤 스테이션에서 한 번 확인한다: 간편입고 → 칸에 «적치하면 나갈 수 있어요» → 적치 → [송장 출력] → 배치 고르기 → 송장 출력.
