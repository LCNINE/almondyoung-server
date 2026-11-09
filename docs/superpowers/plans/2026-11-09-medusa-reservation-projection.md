# Medusa 예약 투영 (#1247) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시각 T 이후 Medusa 주문의 줄마다 Medusa 예약 수량을 `max(0, demand − core 가 잡은 판매 단위)` 로 맞추고, 하루 한 번 대사가 놓친 줄을 고치며, 비정상 회차는 멈추고 admin-web 에 남긴다.

**Architecture:** core 는 판매주문 줄 상태가 바뀌는 트랜잭션에서 주문에 «더러움» 표시(버전 +1)만 하고, 1분 폴러가 그 주문의 줄 상태 스냅샷을 outbox 로 낸다. channel-adapter 는 그 이벤트를 inbox 에 받아 전용 워커가 Medusa 배치 라우트(워크플로 하나)로 예약을 설정한다. 같은 계산 함수·같은 Medusa 라우트를 하루 한 번 대사 크론이 쓴다.

**Tech Stack:** NestJS · Drizzle(postgres.js) · `@app/events` outbox/Kafka · `@app/cron-once` · Medusa v2 (custom admin route + workflow, `@medusajs/core-flows` reservation workflows) · Next.js admin-web · zod 이벤트 계약(`packages/event-contracts`)

**Spec:** `docs/superpowers/specs/2026-11-09-medusa-reservation-projection-design.md`

## Global Constraints

- T 가 비어 있으면 이벤트 소비·대사 모두 **아무 쓰기도 하지 않는다**. T 이전에 생긴 주문(`orderedAt < T`)은 끝까지 건드리지 않는다.
- 목표 공식은 한 함수: `target = max(0, demand − heldUnits)`, `demand = ordered − canceledBeforeShipment`, `heldUnits` = 구성 SKU 마다 `floor((reserved + shipped + forwarded) / qtyPerUnit)` 의 최솟값(`completedSetUnits`). 갈래 무관 `canceled` 를 빼지 않는다.
- 투영 대상은 Medusa 가 재고를 관리하는 줄뿐(variant·inventory item 이 있는 줄). 아니면 `not_managed` 로 건너뛰고 고칠 줄·실패로 세지 않는다.
- core 가 모르는 줄(조회 성공 + 줄 없음)은 건드리지 않고 «unknown» 으로만 센다. core 조회 실패 = 그 회차 전체 건너뜀(쓰기 0).
- Medusa 예약을 **줄이는** 쓰기는 그 variant 에 처리되지 않은 `ProductSellableQuantityChanged` inbox 행이 없고 스냅샷이 정착 지연(`RESERVATION_PROJECTION_SETTLE_MS`, 기본 300000)보다 오래됐을 때만. **늘리는** 쓰기는 바로.
- Medusa DB 를 직접 쓰지 않는다 — 모든 예약 변경은 Medusa 워크플로를 지난다.
- core 는 Medusa 를 모른다. core 는 T 를 모른다(요청 인자로만 받는다). core 는 직접 발행하지 않는다(enqueue 만).
- 새 라우트는 권한 데코레이터 필수: core 내부는 `@InternalOnly()`, channel-adapter 화면 API 는 읽기 `channel.account.read` · 쓰기 `order.order.write`. 새 권한 키 없음.
- 크론은 `@CronOnce(expr, { name })`. 요청 밖에서 core DB 에 닿는 코드는 `DbService.forEachDatabase` 안에서.
- 마이그는 additive 만, `npm run db:generate:<svc> -- --name <kebab>` 로 생성, schema.ts 와 같은 커밋. 배포 순서 `migrate → deploy`.
- 배포는 **한 번**(PR 하나, squash-merge, 2026-11-09 결정): T 전까지 전부 휴면이라 소비자 먼저 나눠 배포해 얻는 것이 없다. 아래 «PR A»·«PR B» 는 작업 순서 묶음으로만 남긴다 — 스펙 §6.
- 게이트: `npm run type-check` 0, `npx jest --maxWorkers=3` 0 실패. DB 가 필요한 스펙은 `describeIfDb`/`REQUIRE_*_DB=1` 가드, 스펙 안 `dotenv.config()` 금지.

## Review Focus

1. **세트 줄의 일부 구성품만 예약됨** → 그 판매 단위는 core 가 잡지 않은 것으로 세어 Medusa 가 계속 잡는다(목표가 줄지 않는다). → Task 1 테스트.
2. **옛 버전 이벤트가 새 버전 뒤에 도착** → 무시된다(Medusa 쓰기 0). → Task 7 테스트.
3. **판매가능수량 이벤트가 밀린 variant 의 감소** → 미뤄지고(쓰기 0, 다시 시도), 증가는 바로 쓴다. → Task 4·6·7 테스트.
4. **대사 중 core 조회가 두 번째 묶음에서 실패** → 첫 묶음 것도 쓰지 않는다(계산 전에 전부 모은다), 회차 `skipped`. → Task 8 테스트.
5. **«부분 출고 뒤 출고 후 취소» 줄**(주문 2 · 출고 1 · 출고 후 취소 1 · 나머지 재고 부족) → 목표 1. → Task 6 테스트.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/sales-order/line-quantities/line-quantities.sql.ts` (수정) | SKU 층에 `reserved`(확정 예약) 칸 |
| `apps/core/src/modules/sales-order/line-quantities/line-quantities.reader.ts` (수정) | `LineSkuQuantities.reserved` |
| `apps/core/src/modules/sales-order/line-quantities/line-sales-units.ts` (수정) | `heldSalesUnits(line)` |
| `apps/core/src/modules/sales-order/line-reservation-state/line-reservation-state.reader.ts` (신규) | 주문들 → 줄 상태 스냅샷 (이벤트·내부 API 공용) |
| `apps/core/src/modules/sales-order/line-reservation-state/line-state-dirty.ts` (신규) | `markLineStateDirty(tx, salesOrderIds)` |
| `apps/core/src/modules/sales-order/line-reservation-state/line-state.publisher.ts` (신규, PR B) | 1분 폴러 — 더러운 주문 → outbox |
| `apps/core/src/modules/sales-order/internal/line-reservation-state.*` (신규) | 내부 조회 2개 (DTO·서비스) |
| `packages/event-contracts/streams/orders.stream.ts` (수정) | `SalesOrderLineReservationState` 계약 |
| `apps/medusa/src/workflows/line-item-reservation/` (신규) | 계획 규칙(순수) + 워크플로 |
| `apps/medusa/src/api/admin/line-item-reservations/` (신규) | 쓰기 POST · 읽기 GET · 미들웨어 |
| `apps/channel-adapter/src/services/reservation-projection/` (신규) | 목표 계산·감소 게이트·적용 서비스·워커·대사·회차 기록 |
| `apps/channel-adapter/src/services/clients/core-line-reservation-state.client.ts` (신규) | core 내부 조회 클라이언트 |
| `apps/channel-adapter/src/consumers/line-reservation-state.consumer.ts` (신규) | Kafka → inbox |
| `apps/channel-adapter/src/controllers/reservation-reconcile-runs.controller.ts` (신규) | 화면 API |
| `apps/channel-adapter/scripts/set-reservation-cutover.ts` (신규) | T 설정 스크립트 |
| `apps/admin-web/src/lib/api/domains/channel/reservation-reconcile-runs.{client,shape}.ts` (신규) + 화면 섹션 | 멈춘 회차 표시·버튼 |
| `scripts/ops/cutover-preflight/checks/medusa.ts` (수정), `scripts/sellmate/clear-reservations.ts` (수정) | 판정·옛 스크립트 가드 |

---

## PR A

### Task 1: core 줄 수량 문에 «확정 예약» 칸과 «잡은 판매 단위»

**Files:**
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantities.sql.ts` (`lineSkuQuantitiesSql` 의 `item_fact`)
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantities.reader.ts` (`LineSkuQuantities`, `LineSkuRow`, 매핑)
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-sales-units.ts`
- Test: `apps/core/src/modules/sales-order/line-quantities/line-sales-units.spec.ts`, `line-quantities.integration.spec.ts`

**Interfaces:**
- Produces: `LineSkuQuantities.reserved: number` (그 FOI 의 상자 라인에 걸린 `CONFIRMED_LINE_RESERVATION_WHERE` 예약 합, SKU 단위); `heldSalesUnits(line: LineQuantities): number`

- [ ] **Step 1: 단위 테스트 작성** — `line-sales-units.spec.ts` 에 `describe('heldSalesUnits')`:
  - `세트(A×2,B×1) 2단위, A reserved 4 · B reserved 1 → 1`
  - `세트(A×2,B×1), A shipped 2 · B reserved 1 → 1` (예약과 출고를 합쳐 센다)
  - `세트(A×2,B×1), A reserved 2 · B 0 → 0` (Review Focus 1)
  - `단일 SKU(qtyPerUnit 1) reserved 1 · shipped 1 · forwarded 1 → 3`
  - `skus 가 빈 줄 → 0`
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/sales-order/line-quantities/line-sales-units.spec.ts` → FAIL(`heldSalesUnits` 없음)
- [ ] **Step 3: 구현** — `heldSalesUnits(line) = completedSetUnits(line, (s) => s.reserved + s.shipped + s.forwarded)`. SQL 조각 `item_fact` 에 FOI 별 `reserved` 합을 더한다: `shipment_lines.fulfillment_order_item_id = foi.id` 인 라인들의 확정 예약 합, 술어는 `CONFIRMED_LINE_RESERVATION_WHERE` 를 import 해서 쓴다(새로 적지 않는다). 집계는 기존 `delivered` 처럼 범위 FOI 전체를 한 번 묶은 파생 테이블을 FOI id 로 되붙인다(상관 서브쿼리 금지).
- [ ] **Step 4: 통합 테스트 한 건** — `line-quantities.integration.spec.ts` 에 «상자 라인에 confirmed 예약 3 + released 예약 2 → reserved 3» 추가(기존 `describeIfDb` 블록 안).
- [ ] **Step 5: 확인** — 단위 PASS. 통합은 `npm run test:core:integration:local -- line-quantities` PASS(로컬 `core` 마이그가 깨져 있으면 메모리의 스크래치 DB 절차).
- [ ] **Step 6: Commit** — `core 줄 수량 문에 확정 예약 칸과 잡은 판매 단위를 더한다 (#1247)`

### Task 2: 이벤트 계약 `SalesOrderLineReservationState`

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts` (`CORE_ORDER_STREAM.events`, payload 타입·zod)
- Test: `packages/event-contracts/streams/orders.stream.spec.ts`

**Interfaces:**
- Produces:
```ts
export interface SalesOrderLineReservationStatePayload {
  salesOrderId: string;
  salesChannel: SalesChannel;
  channelOrderId: string;
  orderedAt: string;       // ISO, core sales_orders.order_date (= Medusa created_at)
  version: number;         // 주문마다 단조 증가
  asOf: string;            // ISO, 스냅샷을 읽은 시각
  lines: Array<{
    salesOrderLineId: string;
    channelOrderItemId: string | null;
    variantId: string;     // core variant id — channel-adapter 감소 게이트가 inbox 의 sellable 행과 잇는다
    ordered: number;
    canceledBeforeShipment: number;
    demand: number;
    heldUnits: number;
  }>;
}
```
- [ ] **Step 1: 계약 스펙** — `orders.stream.spec.ts`: 정상 payload 파싱 통과 · `version` 음수 거부 · `lines[].heldUnits` 누락 거부.
- [ ] **Step 2: 실패 확인** — `npx jest packages/event-contracts/streams/orders.stream.spec.ts` FAIL
- [ ] **Step 3: 계약 추가** — 기존 `SalesOrderCancelled` 정의 모양 그대로. aggregateType `Order`, partitionKey 는 생산자가 `salesOrderId`.
- [ ] **Step 4: PASS 확인** 후 `npx jest packages/event-contracts` 전체 PASS(registry 스펙 포함)
- [ ] **Step 5: Commit** — `판매주문 줄 예약 상태 이벤트 계약을 더한다 (#1247)`

### Task 3: core 버전 열 마이그 · 줄 상태 리더 · 내부 조회 API

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`salesOrders` 에 두 열 + 부분 인덱스)
- Create: `apps/core/drizzle/<timestamp>_add-sales-order-line-state-version.sql` (생성 명령으로)
- Create: `apps/core/src/modules/sales-order/line-reservation-state/line-reservation-state.reader.ts`
- Create: `apps/core/src/modules/sales-order/internal/line-reservation-state.dto.ts`, `line-reservation-state.service.ts`
- Modify: `apps/core/src/modules/sales-order/internal/sales-orders-internal.controller.ts`, `sales-order.module.ts`
- Test: `line-reservation-state.reader.integration.spec.ts`, `line-reservation-state.service.spec.ts`

**Interfaces:**
- Produces:
  - 열: `lineStateVersion: integer('line_state_version').notNull().default(0)`, `lineStatePublishedVersion: integer('line_state_published_version').notNull().default(0)`, 인덱스 `idx_sales_orders_line_state_dirty` on `(id)` where `line_state_version > line_state_published_version`
  - `readLineReservationStates(trx: DbTx, salesOrderIds: readonly string[], asOf: Date): Promise<SalesOrderLineReservationStatePayload[]>` — 주문마다 `readLineQuantities` + `heldSalesUnits`. `version` 은 그 주문의 `lineStateVersion`.
  - `POST internal/sales-orders/line-reservation-states` body `{ salesChannel, channelOrderItemIds: string[] (≤200) }` → `{ lines: Array<Payload['lines'][number] & { salesOrderId, orderedAt }> , unknown: string[] }` — `unknown` = 그 채널에 줄이 없는 id
  - `POST internal/sales-orders/line-reservation-candidates` body `{ salesChannel, orderedAtOrAfter: ISO, afterLineId?: string, limit ≤ 500 }` → `{ channelOrderItemIds: string[], nextAfterLineId: string | null }` — 주문 `status` 가 `cancelled`·`shipped`·`delivered` 가 아니고 `order_date ≥ orderedAtOrAfter` 인 주문의 `channel_order_item_id` 있는 줄(목표 > 0 의 상위 집합. 계산은 channel-adapter 가 한다 — *Claude 판단*)
- [ ] **Step 1: 스키마 수정 후 생성** — `npm run db:generate:core -- --name add-sales-order-line-state-version`. 생성 SQL 이 `ALTER TABLE … ADD COLUMN … DEFAULT 0 NOT NULL` 두 개 + `CREATE INDEX … WHERE` 인지 눈으로 확인.
- [ ] **Step 2: 리더 통합 테스트** — 세트 줄 하나·단일 줄 하나·FO 없는 줄 하나인 주문에서 `demand`·`heldUnits`·`version` 기대값 / 출고 전 취소 1 이 `demand` 에서 빠짐.
- [ ] **Step 3: 서비스 단위 테스트** — 묶음 조회에서 없는 id 는 `unknown` 으로, `salesChannel` 이 다른 줄은 `unknown`.
- [ ] **Step 4: 실패 확인 → 구현 → PASS** (`npx jest apps/core/src/modules/sales-order/internal` · 통합은 `test:core:integration:local`)
- [ ] **Step 5: 라우트 분류 게이트** — `npx jest route-classification` PASS (`@InternalOnly` 는 컨트롤러 클래스에 이미 있다)
- [ ] **Step 6: Commit** — 스키마·SQL·`drizzle/meta`·코드 한 커밋: `core 판매주문 줄 상태 버전 열과 내부 조회를 더한다 (#1247)`

### Task 4: Medusa 배치 예약 설정 라우트 · 조회 라우트

**Files:**
- Create: `apps/medusa/src/workflows/line-item-reservation/plan.ts` (순수 계획 규칙), `steps.ts`, `workflows.ts`
- Create: `apps/medusa/src/api/admin/line-item-reservations/route.ts`, `validators.ts`, `middlewares.ts`
- Modify: `apps/medusa/src/api/admin/middlewares.ts` (미들웨어 배열 펼치기)
- Test: `apps/medusa/src/workflows/line-item-reservation/__tests__/plan.unit.spec.ts`

**Interfaces:**
- Produces:
  - `POST /admin/line-item-reservations` body `{ items: [{ line_item_id: string, quantity: int ≥ 0, allow_decrease: boolean }] }` (≤ 200) → `{ results: [{ line_item_id, outcome: 'set' | 'unchanged' | 'deferred' | 'not_managed' | 'not_found' | 'error', quantity_before: number, quantity_after: number, message?: string }] }` — `allow_decrease=false` 인데 목표 < 지금 예약 합이면 쓰지 않고 `deferred`. 감소 판정을 Medusa 의 실제 현재값으로 하려고 라우트 안에서 한다 *(Claude 판단)*
  - `GET /admin/line-item-reservations?order_created_from=<ISO>&after_id=<reservation id>&limit≤500` → `{ reservations: [{ id, line_item_id, quantity, order_created_at }], next_after_id: string | null }` — 살아 있는(`deleted_at is null`) 예약 중 그 줄의 주문이 `order_created_from` 이후인 것
  - `planLineItemReservation(existing: { id: string; quantity: number }[], target: number, allowDecrease: boolean, managed: { inventoryItemId: string; locationId: string } | null): { create?: { quantity }, update?: { id, quantity }, delete: string[], outcome }` — 기존이 여러 행이면 첫 행에 몰고 나머지 삭제
- [ ] **Step 1: 계획 규칙 테스트** — `기존 3 → 목표 0: delete 1행` / `기존 3 → 목표 1: update 1` / `기존 없음 → 목표 2: create 2` / `기존 2+1 → 목표 3: unchanged`(합이 같으면 그대로) / `기존 2+1 → 목표 2: update 첫 행 2 + delete 둘째` / `managed null → not_managed, 쓰기 없음` / `기존 3 → 목표 1 · allowDecrease false → deferred, 쓰기 없음` / `기존 1 → 목표 3 · allowDecrease false → create/update 로 3`
- [ ] **Step 2: 실패 확인** — `(cd apps/medusa && npm run test:unit -- src/workflows/line-item-reservation)` FAIL
- [ ] **Step 3: 구현** — 확장점은 먼저 `https://docs.medusajs.com/llms.txt` 에서 reservation·custom route 페이지를 확인한다. 워크플로 한 번 안에서 줄마다 계획 → `createReservationsWorkflow`·`updateReservationsWorkflow`·`deleteReservationsWorkflow` 를 `runAsStep` 으로 조합. `managed` 는 그 줄의 variant 의 inventory item(variant 당 하나)과 주문 판매채널의 stock location(하나)에서 찾는다 — variant 가 없거나 `manage_inventory=false` 면 null. 한 줄 실패가 다른 줄을 되돌리지 않게 줄 단위로 결과를 모은다(건별 결과, ADR-0040). 검증은 `validateAndTransformBody` 미들웨어.
- [ ] **Step 4: PASS 확인** + `(cd apps/medusa && npx tsc --noEmit)` 0
- [ ] **Step 5: 통합(선택, 로컬)** — `scripts/local/run-medusa-integration.sh` 로 주문 하나에 POST → `inventory_level.raw_reserved_quantity` 가 예약 합과 같은지(캐시 드리프트 없음) 한 건.
- [ ] **Step 6: Commit** — `Medusa 에 줄 예약 배치 설정·조회 라우트를 더한다 (#1247)`

### Task 5: channel-adapter 능력 축 · T 설정 · 버전/회차 테이블

**Files:**
- Modify: `apps/channel-adapter/src/services/channel-capabilities.ts` (`api` 갈래에 `reservation: ChannelRoute`; medusa `projection`, naver·coupang `none`)
- Modify: `apps/channel-adapter/src/schema.ts` — 테이블 셋
- Create: `apps/channel-adapter/drizzle/<timestamp>_add-medusa-reservation-projection.sql` (생성 명령)
- Create: `apps/channel-adapter/src/services/reservation-projection/reservation-cutover.repository.ts`
- Create: `apps/channel-adapter/scripts/set-reservation-cutover.ts`
- Test: `channel-capabilities.spec.ts`(있으면 수정), `reservation-cutover.repository.spec.ts`

**Interfaces:**
- Produces:
  - `reservation_projection_settings(id text pk = 'singleton', cutover_at timestamptz null, updated_at, updated_by text null)`
  - `medusa_reservation_projection_versions(sales_order_id varchar pk, applied_version int not null, applied_at timestamptz not null)`
  - `medusa_reservation_reconcile_runs(id uuid pk, started_at, finished_at null, status text check in ('applied','halted','skipped','running'), candidates int, fixes int, fix_failures int, deferred int, unknown int, oldest_unknown_at timestamptz null, examples jsonb, error text null, closed_at null, closed_by null, close_reason null, forced_by null)`
  - `ReservationCutoverRepository.get(): Promise<Date | null>`, `.set(at: Date | null, by: string): Promise<void>`
  - 스크립트: `npx tsx apps/channel-adapter/scripts/set-reservation-cutover.ts --at <ISO> | --clear` (dry-run 기본, `--apply` 로만 씀, 현재 값과 바꿀 값을 찍는다)
- [ ] **Step 1: 테스트** — 능력 표: `CHANNEL_CAPABILITIES.medusa.reservation.kind === 'projection'`, naver·coupang `none`. 리포지토리: 행이 없으면 `null`, `set` 두 번이면 마지막 값.
- [ ] **Step 2: 실패 확인 → 스키마 수정 → `npm run db:generate:channel-adapter -- --name add-medusa-reservation-projection` → 구현 → PASS** (`npx jest apps/channel-adapter/src/services/reservation-projection apps/channel-adapter/src/services/channel-capabilities`)
- [ ] **Step 3: Commit** — 스키마·SQL·meta·코드 한 커밋

### Task 6: 목표 계산 · 감소 게이트 · 적용 서비스

**Files:**
- Create: `apps/channel-adapter/src/services/reservation-projection/reservation-target.ts`
- Create: `apps/channel-adapter/src/services/reservation-projection/sellable-settle-gate.ts`
- Create: `apps/channel-adapter/src/services/reservation-projection/reservation-projection.service.ts`
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (두 메서드)
- Test: 같은 폴더 `*.spec.ts`

**Interfaces:**
- Consumes: Task 2 payload, Task 4 라우트, Task 5 리포지토리
- Produces:
  - `reservationTarget(line: { demand: number; heldUnits: number }): number`
  - `SellableSettleGate.blockedVariantIds(variantIds: string[], asOf: Date, now: Date): Promise<Set<string>>` — `now − asOf < RESERVATION_PROJECTION_SETTLE_MS` 이면 전부, 아니면 `inbox_events` 에 `event_type='ProductSellableQuantityChanged' and aggregate_id = any(variantIds) and status in ('pending','processing')` 행이 있는 variant
  - `MedusaClient.setLineItemReservations(items: { lineItemId: string; quantity: number }[]): Promise<LineItemReservationResult[]>`, `MedusaClient.listLineItemReservations(q: { orderCreatedFrom: Date; afterId?: string; limit: number }): Promise<{ reservations: …; nextAfterId: string | null }>`
  - `ReservationProjectionService.toWrites(lines: LineState[], asOf: Date, now: Date): Promise<{ lineItemId: string; quantity: number; allowDecrease: boolean }[]>` — 줄마다 `reservationTarget`, `allowDecrease = !blocked.has(line.variantId)`. `channelOrderItemId` 가 null 인 줄은 뺀다. 소비자와 대사가 공유
- [ ] **Step 1: 테스트** — `reservationTarget`: `demand 2 · held 1 → 1`(Review Focus 5 의 줄: core 가 demand 2, held = shipped 1 로 보내는 값), `demand 1 · held 3 → 0`. 게이트: 정착 지연 안이면 막힘 / 밖이고 pending 행 있으면 막힘 / processing 도 막힘 / failed·published 는 안 막힘. `toWrites`: 막힌 variant 줄 → `allowDecrease false`, 안 막힌 줄 → `true`, `channelOrderItemId` null 줄 → 제외.
- [ ] **Step 2: 실패 확인 → 구현 → PASS** (`npx jest apps/channel-adapter/src/services/reservation-projection`)
- [ ] **Step 3: Commit**

### Task 7: 소비자 · 전용 inbox 워커

**Files:**
- Create: `apps/channel-adapter/src/consumers/line-reservation-state.consumer.ts` (템플릿: `product-sellable-quantity.consumer.ts`)
- Create: `apps/channel-adapter/src/services/reservation-projection/reservation-projection.worker.ts` (템플릿: `services/shipment-dispatch-inbox.worker.ts` 의 claim·lease·재시도 구조)
- Modify: `apps/channel-adapter/src/adapter.module.ts` (컨트롤러·프로바이더 등록)
- Test: `line-reservation-state.consumer.spec.ts`, `reservation-projection.worker.spec.ts`

**Interfaces:**
- Consumes: Task 5·6
- Produces: inbox 행 `eventType 'SalesOrderLineReservationState'`, `aggregateType 'Order'`, `aggregateId = salesOrderId`, `idempotencyKey = '${salesOrderId}:${version}'`. 워커 allowlist 는 이 eventType 하나뿐 — `InboxWorkerService` 의 allowlist 에는 넣지 않는다(10초 간격 레인을 같이 쓰지 않는다).
- [ ] **Step 1: 워커 테스트** — 처리 순서:
  - T 없음 → 행 `published`(건너뜀), Medusa 호출 0
  - `orderedAt < T` → 건너뜀
  - 채널 능력 `reservation.kind !== 'projection'` → 건너뜀
  - `version ≤ applied_version` → 건너뜀(Review Focus 2)
  - 정상 → `setLineItemReservations` 한 번 호출, 결과 뒤 `applied_version = version`
  - 결과에 `deferred` 가 하나라도 있으면 → `applied_version` 을 올리지 않고 `next_attempt_at = now + 60s`, `attempts` 는 올리지 않는다(재시도 상한에 닿지 않는 기다림). 나머지 줄은 이미 쓰였고, 다시 처리해도 같은 값이라 무해하다(Review Focus 3)
  - `not_managed`·`not_found` 결과는 성공으로 친다, `error` 결과가 하나라도 있으면 행 재시도(`attempts+1`, 상한 `RESERVATION_PROJECTION_MAX_RETRIES` 기본 10 뒤 `failed`)
- [ ] **Step 2: 소비자 테스트** — 같은 `(salesOrderId, version)` 두 번 → inbox 행 1개.
- [ ] **Step 3: 실패 확인 → 구현 → PASS**
- [ ] **Step 4: Commit**


### Task 8: 하루 한 번 대사

**Files:**
- Create: `apps/channel-adapter/src/services/clients/core-line-reservation-state.client.ts` (템플릿: `core-sales-order-lookup.client.ts`, 200건 묶음, `OutboundTenant` 헤더, 실패 throw)
- Create: `apps/channel-adapter/src/services/reservation-projection/reservation-reconcile.service.ts`, `reservation-reconcile.job.ts`, `reservation-reconcile-run.repository.ts`
- Test: `reservation-reconcile.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 내부 API, Task 4 GET, Task 6 `toWrites`
- Produces:
  - `ReservationReconcileService.run(opts: { limit: number | null; forcedBy?: string }): Promise<ReconcileRunRecord>`
  - `@CronOnce('30 4 * * *', { name: 'medusa-reservation-reconcile', timeZone: 'Asia/Seoul' })` → `run({ limit: MEDUSA_RESERVATION_RECONCILE_MAX_FIXES })`
- [ ] **Step 1: 테스트** —
  - T 없음 → 회차 기록 없이 끝(Medusa·core 호출 0)
  - 후보 = Medusa GET(전 페이지) ∪ core candidates(전 페이지) 의 `line_item_id` 합집합
  - core 조회 두 번째 묶음 실패 → 쓰기 0, 회차 `skipped`, `error` 채움(Review Focus 4)
  - core `unknown` 줄 → 쓰기 0, `unknown` 수·`oldest_unknown_at`(Medusa 예약 `order_created_at` 최솟값) 기록
  - `not_managed` 는 고칠 줄에서 제외
  - 고칠 줄 수 ≤ 한도 → 한 번에 200줄씩 쓰기, `applied`, `fixes`·`fix_failures`·`deferred` 기록
  - 고칠 줄 수 > 한도 → 쓰기 0, `halted`, `examples` 에 최대 10줄 `{ lineItemId, current, target }`
  - `limit: null`(강제) → 한도 무시, `forced_by` 기록
  - deferred 는 고칠 줄 수에 넣지 않는다
  - 고칠 줄 = 목표 ≠ Medusa GET 의 수량(없으면 0) 인 줄. 쓰기는 `toWrites` 결과를 그대로 보내고, `deferred` 결과는 `deferred` 로 센다(고칠 줄 수·한도에 넣지 않는다 — 한도 판정은 «목표 < 현재이면서 막힌 줄»을 뺀 수로)
- [ ] **Step 2: 실패 확인 → 구현 → PASS**
- [ ] **Step 3: 한도 기본값** — 라이브 `medusa` DB 에서 최근 30일 하루 주문 줄 수(읽기 전용 쿼리)를 재서 `MEDUSA_RESERVATION_RECONCILE_MAX_FIXES` 기본값을 정하고, 쿼리와 근거를 스펙 §5-3 에 한 줄로 적는다. 터널이 없으면 기본 200 으로 두고 스펙에 «미실측» 표시.
- [ ] **Step 4: 크론 가드** — `npx jest libs/cron-once` PASS(이름 유일·모듈 import)
- [ ] **Step 5: Commit**

### Task 9: 화면 API (멈춘 회차)

**Files:**
- Create: `apps/channel-adapter/src/controllers/reservation-reconcile-runs.controller.ts`
- Test: `reservation-reconcile-runs.controller.spec.ts`

**Interfaces:**
- Produces (`@Controller('adapter/reservation-reconcile-runs')`):
  - `GET /` `@RequirePermission('channel.account.read')` → `{ open: Run[], latest: Run | null }` (`open` = `status='halted' and closed_at is null`)
  - `POST /:id/apply` `@RequirePermission('order.order.write')` → 열린 halted 회차만, `run({ limit: null, forcedBy: user.id })` 후 원래 회차를 `closed_at`·`closed_by`·`close_reason='forced'` 로 닫고 새 회차 반환. 이미 닫힌 회차면 409(`ConflictError`)
  - `POST /:id/close` `@RequirePermission('order.order.write')` body `{ reason: string(1..200) }` → 닫음
- [ ] **Step 1: 테스트** — 닫힌 회차 apply → 409 / close 사유 빈 문자열 → 400 / apply 가 `run` 을 `limit: null` 로 부른다
- [ ] **Step 2: 실패 확인 → 구현 → PASS** + `npx jest route-classification` PASS
- [ ] **Step 3: Commit**

### Task 10: admin-web 섹션

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/channel/reservation-reconcile-runs.shape.ts`, `.client.ts`
- Modify: `apps/admin-web/src/lib/services/channel/queries.ts`, `mutations.ts`, `query-keys.ts`
- Modify: `apps/admin-web/src/features/order/channel-mismatches/template/index.tsx` (섹션 하나), `../display.ts`
- Test: `reservation-reconcile-runs.shape.spec.ts`, `display.spec.ts`(있으면 수정)

**Interfaces:**
- Consumes: Task 9
- Produces: `useReservationReconcileRuns()`, `useApplyReservationRun` (`.permission = 'order.order.write'`), `useCloseReservationRun` (같은 권한)
- [ ] **Step 1: shape 테스트** — 응답 모양이 틀리면 `null`(→ client 가 throw), 정상이면 `open[]`·`latest`. 표시 함수: halted 회차 문구 «Medusa 예약 대사가 멈췄어요 · 고칠 줄 N · {시각}», 정상 latest 는 한 줄 «{시각} 고침 N줄»(Global: 정상 상태는 작게), unknown > 0 이면 «core 가 모르는 예약 N줄 · 가장 오래된 것 D일».
- [ ] **Step 2: 실패 확인 → 구현 → PASS** (`npm run test:admin-web -- reservation-reconcile`)
- [ ] **Step 3: 화면** — 섹션: 열린 회차마다 예시 줄 표 + 버튼 «확인했으니 고치기»(`run={useApplyReservationRun}`) · «종결»(사유 입력, 기존 `closeTarget` 대화상자 재사용). 열린 회차가 없으면 latest 한 줄만. 쿼리 키에 `undefined` 를 넣지 않는다.
- [ ] **Step 4: 게이트** — `npm run test:admin-web -- mutation-guard screen-access` PASS, `(cd apps/admin-web && npx tsc --noEmit)` 0
- [ ] **Step 5: Commit**

### Task 11: 판정 스크립트 · 옛 스크립트 가드 · 런북 · 이슈

**Files:**
- Modify: `scripts/ops/cutover-preflight/checks/medusa.ts`, `scripts/ops/cutover-preflight/index.ts`(channel_adapter 연결 전달)
- Modify: `scripts/sellmate/clear-reservations.ts`
- Modify: 런북 — #1251 산출물이 아직 없으면 `docs/runbooks/selmate-stock-pipeline.md` Ⓑ 절
- Test: `scripts/ops/cutover-preflight/rules.spec.ts`, `scripts/sellmate/clear-reservations.spec.ts`(있는 것)

- [ ] **Step 1: 판정 규칙 테스트(순수 함수로 뺀다)** — `--after-cutover` 인데 T 없음 → ✗ / 열린 halted 회차 → ✗ / 마지막 회차 `finished_at` 이 26시간보다 오래 → ✗ / T 이후 주문의 «Medusa 예약 ≠ 목표» 재계산(같은 `reservationTarget` 을 import) ≠ 0 → ✗. 기존 «core 가 끝낸 줄에 남은 예약» 검사는 T 이후 주문으로 범위를 좁혀 남긴다.
- [ ] **Step 2: clear-reservations 가드 테스트** — `--apply` 이고 channel_adapter `cutover_at` 이 있으면 종료 코드 1·메시지 «T 가 설정돼 있다 — 이 스크립트는 더 돌리지 않는다(#1247)». channel_adapter 접속 실패도 `--apply` 거부(fail-closed). dry-run 은 막지 않는다. 접속은 `run.sh` 가 만드는 URL 에서 DB 이름만 `channel_adapter` 로 바꾼다 — `scripts/sellmate/run.sh` 를 먼저 읽고 같은 클러스터인지 확인한다.
- [ ] **Step 3: 실패 확인 → 구현 → PASS**
- [ ] **Step 4: 런북 두 줄** — 당일 순서 2번 «clear-reservations 마지막 실행 → 그 뒤 set-reservation-cutover `--at T --apply`», 6번 «첫 저녁 `/order/channel-mismatches` 와 판정 스크립트 Medusa 축».
- [ ] **Step 5: Commit**
- [ ] **Step 6: 이슈** — #1247 본문의 공식을 `demand − heldUnits` 로 고치고 스펙·계획 경로를 적는다. #832 본문에 «Medusa 쪽 절반은 #1247 이 대체, core 03:05 크론은 여기 남김» 한 줄. (코드 수치 적지 않기)

**PR A 끝:** (작업 순서 묶음 — 배포는 Task 12 와 함께 한 번) 전체 게이트(`npm run type-check`, `npx jest --maxWorkers=3`, admin-web·medusa 각 tsc/unit). 배포는 `migrate → deploy`(core·channel-adapter 마이그 둘). 배포 뒤 T 는 비워 둔다.

---

## PR B (작업 순서 묶음 — 같은 PR·같은 배포)

### Task 12: core 생산자 — 더러움 표시와 1분 폴러

**Files:**
- Create: `apps/core/src/modules/sales-order/line-reservation-state/line-state-dirty.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.ts` (`reprojectFulfillmentOrders` 끝에서 표시)
- Modify: `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts` (같은 트랜잭션에서 표시)
- Create: `apps/core/src/modules/sales-order/line-reservation-state/line-state.publisher.ts` (+ 모듈 등록)
- Test: `line-state-dirty.integration.spec.ts`, `line-state.publisher.spec.ts`, `line-state-dirty.guard.spec.ts`

**Interfaces:**
- Consumes: Task 2 계약, Task 3 열·리더
- Produces:
  - `markLineStateDirty(tx: DbTx, salesOrderIds: readonly string[]): Promise<void>` — id 정렬 후 `UPDATE sales_orders SET line_state_version = line_state_version + 1 WHERE id = any(...)`
  - FO id → 판매주문 id 는 `fulfillment_orders.sales_order_id` 로 (`reprojectFulfillmentOrders` 안에서 한 번 select)
  - `LineStatePublisher.tick()` — `@CronOnce('* * * * *', { name: 'sales-order-line-state-publish' })`, `forEachDatabase` 안에서: 더러운 주문 최대 200개를 `FOR UPDATE SKIP LOCKED` 로 잡고 → `readLineReservationStates` → 주문마다 `coreOrders.enqueue({ idempotencyKey: 'so-line-state:${id}:${version}', eventType: 'SalesOrderLineReservationState', aggregateId: id, partitionKey: id, payload })` → `UPDATE … SET line_state_published_version = <읽은 version> WHERE id = … AND line_state_published_version < <읽은 version>`. 같은 트랜잭션. 읽은 뒤 버전이 또 오르면 다음 틱이 다시 낸다
- [ ] **Step 1: 가드 테스트** — `line-state-dirty.guard.spec.ts`: `reprojectFulfillmentOrders` 와 `recordSalesOrderCancellation` 본문이 `markLineStateDirty` 를 부르는지(소스 문자열 검사, 기존 `cancellation-write.guard.spec.ts` 꼴).
- [ ] **Step 2: 통합 테스트** — 예약 `reservePartial` 한 번 → 그 주문 `line_state_version` 1 증가 / 출고 전 취소 기록 → 증가 / 같은 트랜잭션에서 두 번 표시 → 폴러가 이벤트 하나만 냄(버전은 최신 하나).
- [ ] **Step 3: 폴러 단위 테스트** — enqueue 의 idempotencyKey·partitionKey / 읽은 뒤 버전이 오른 경우 published 를 읽은 값으로만 올림 / 더러운 주문 0 이면 enqueue 0 / `core-no-direct-publish.spec.ts` PASS
- [ ] **Step 4: 실패 확인 → 구현 → PASS** + `npx jest libs/cron-once` PASS
- [ ] **Step 5: Commit** → 같은 PR(배포 한 번). 배포 전 `npm run deploy:preflight -- --stage live`, 배포 뒤 Kafka 에 이벤트가 나가고 channel-adapter inbox 행이 T 없음으로 `published`(건너뜀) 되는지 한 건 확인.
