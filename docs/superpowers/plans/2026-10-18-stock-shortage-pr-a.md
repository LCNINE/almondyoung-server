# 재고 부족 주문 나눠 보내기 (PR ⓐ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 정체 보드 «3 예약» 칸에서 재고 부족 주문을 보고 «있는 것 먼저» 한 번으로 미예약 몫을 새 draft 상자로 나눠, 다 예약된 상자가 계획 단계로 넘어가게 한다.

**Architecture:** 정체 보드 판정의 «예약»을 FO 상태가 아니라 상자 라인의 확정 예약 합으로 바꾸고, `ShipmentPlanningService` 에 `splitUnreserved` 명령을 더한다(기존 `split` 본체를 공용 private 으로 뽑아 같이 쓴다). 분할로 새로 생기는 라인은 `shipment_lines.demand_requested_at` 에 원래 라인의 재고 대기 순번을 이어받는다. 보드 목록은 «예약» 줄에 부족 품목·입고 예정을 싣고, 메인·통계의 «출고불가» 숫자는 `order_progress` 에서 센다.

**Tech Stack:** NestJS, Drizzle(postgres.js), Jest(`describeIfDb` 통합 스펙), Next.js admin-web(TanStack Query).

**Spec:** `docs/superpowers/specs/2026-10-18-stock-shortage-and-dead-line-status-design.md` (§4, §6 ⓐ 줄, D7·D8·D9·D13·D14·D15)

## Global Constraints

- 레이어: Controller → Service → Reader/Manager → Repository. 서비스는 `@app/shared` 도메인 예외, 컨트롤러는 try/catch 없음(CLAUDE.md).
- 트랜잭션: `this.dbService.run(fn, tx)` 단일 러너, 공개 메서드는 `tx?: DbTx` 마지막 인자. per-class `inTx` 금지(ADR-0025).
- `any`·`as` 금지. 예외는 기존 `trx.execute()` 원시 결과 캐스트(`as unknown as Raw[]`, `order-progress.reader.ts` 와 같은 문서화된 캐스트)뿐.
- 마이그: `npm run db:generate:core -- --name add-shipment-line-demand-requested-at`. 생성 SQL 은 `ALTER TABLE "shipment_lines" ADD COLUMN "demand_requested_at" timestamp with time zone;` 한 줄이어야 한다. `schema.ts` + `drizzle/<ts>_*.sql` + `drizzle/meta/` 를 한 커밋에. **배포는 `migrate → deploy`**(expand).
- 새 통합 스펙은 `describeIfDb` + 롤백 트랜잭션. 스펙 안에서 `dotenv.config()` 금지.
- 통합 스펙 실행: `npm run test:core:integration:local -- <패턴>` (워크트리면 앞에 `COMPOSE_PROJECT_NAME=almondyoung-server`).
- 컨트롤러·감사 대상 서비스 파일을 고치면 커밋 전 `npx jest scripts/security` (route 인가 감사·IDOR 줄 좌표 가드).
- admin-web 은 컴포넌트 테스트가 없다 — 화면이 읽는 판정·문구는 `*.shape.ts` 순수 함수로 두고 `npm run test:admin-web -- <패턴>` 으로 스펙. admin-web tsc 는 CI 가 안 돌리므로 `(cd apps/admin-web && npx tsc --noEmit)` 를 직접 돈다.
- 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0.
- 작업자 문구: «라벨» 대신 «송장». UI 글씨는 필요한 것만.

## Review Focus

- **화면이 본 뒤 워커가 예약을 더 잡은 상자에 «있는 것 먼저»** — 판단 시점(상자 잠금 뒤)의 미예약 수량만 옮긴다. 이미 다 예약됐으면 `SHIPMENT_FULLY_RESERVED` 409 로 거절, 새 상자를 만들지 않는다 → Task 3 스펙.
- **같은 주문의 두 번째 클릭(더블클릭·재시도)** — 같은 멱등 키는 같은 결과를 돌려주고, 새 키로 다시 누르면 이미 다 예약된 원래 상자라 409 → Task 3 스펙.
- **입고 예정이 없는 SKU(발주 없음·이미 다 받음·잔량 포기)** — `expectedArrival: null`, 줄은 그대로 보인다 → Task 4 스펙.
- **한 줄에 여러 품목이 모자람 + 같은 SKU 가 두 라인(묶음)에 걸침** — 품목은 SKU 별로 합쳐 한 번만 보인다 → Task 4 스펙.
- **판정 변경이 직배 FO·취소 대기 상자를 건드림** — 직배 단위와 `recovery_code` 상자의 판정은 그대로 → Task 2 스펙.

---

### Task 1: 재고 대기 순번 이어받기 (`demand_requested_at`)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:1872-1895` (`shipmentLines` 에 칼럼)
- Create: `apps/core/drizzle/<timestamp>_add-shipment-line-demand-requested-at.sql` + `drizzle/meta/*` (생성)
- Create: `apps/core/src/modules/fulfillment/services/reservation-queue-key.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-order-reservation-retry.worker.ts:99-111` (정렬)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts:285-293` (`split` 의 부분 이동 insert)
- Test: `apps/core/src/modules/fulfillment/services/reservation-queue-key.integration.spec.ts`

**Interfaces:**
- Produces: `shipmentLines.demandRequestedAt` (`timestamp('demand_requested_at', { withTimezone: true })`, nullable, 칼럼 위 주석: 분할로 새로 생긴 라인이 원래 라인의 재고 대기 순번을 이어받는 값 — NULL 이면 `created_at`)
- Produces: `reservationQueueKeySql(line: SQL): SQL` — `line` 은 shipment_lines 별칭(예: `` sql`sl` ``). 결과는 timestamptz 식: `COALESCE((SELECT MIN(COALESCE(r.requested_at, r.created_at)) FROM stock_reservations r WHERE r.target_type='SHIPMENT_LINE' AND r.shipment_line_id = <line>.id AND (r.status='confirmed' OR (r.status='released' AND r.state_reason LIKE 'short-pick:%'))), <line>.demand_requested_at, <line>.created_at)`
- Produces: `loadReservationQueueKey(tx: DbTx, shipmentLineId: string): Promise<Date>` (같은 파일)

- [ ] **Step 1: 실패하는 통합 스펙**

`reservation-queue-key.integration.spec.ts` (shipment-planning.integration.spec.ts 의 `makePlanningService`·`COMPLETE_RECIPIENT` 픽스처 방식을 따른다):

```ts
it('나눠 옮긴 미예약 몫이 원래 라인의 순번을 이어받는다 — 뒤에 온 주문보다 먼저 재고를 받는다', async () => {
  // 주문 A(2026-10-01) 라인 qty 3, 확정 예약 2 → split(moves=[{qty:1, targetReservedQty:0}])
  // 주문 B(2026-10-05) 같은 SKU 라인 qty 1, 예약 0
  // 재고 1 생성 후
  const candidates = await worker.findCandidates(10, tx);
  expect(candidates.map((c) => c.id)).toEqual([aTargetLineId, bLineId]);
});
it('라인 통째 이동은 칼럼을 쓰지 않는다 — 라인 id 가 그대로라 순번도 그대로다', async () => {
  expect(movedLine.demandRequestedAt).toBeNull();
  expect(movedLine.id).toBe(sourceLineId);
});
it('demand_requested_at 이 NULL 인 옛 라인은 created_at 순 그대로다', async () => { /* 두 옛 라인 정렬 = created_at 순 */ });
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- reservation-queue-key`
Expected: FAIL (첫 케이스에서 B 가 앞 / `demandRequestedAt` 없음 타입 에러)

- [ ] **Step 3: 칼럼 + 마이그 생성**

`shipmentLines` 에 `demandRequestedAt` 추가 → `npm run db:generate:core -- --name add-shipment-line-demand-requested-at` → 생성 SQL 이 ADD COLUMN 한 줄인지 확인.

- [ ] **Step 4: `reservationQueueKeySql`·`loadReservationQueueKey` 구현, 워커 정렬을 `ORDER BY ${reservationQueueKeySql(sql\`sl\`)}, sl.id` 로 교체, `split` 부분 이동 insert 에 `demandRequestedAt: await loadReservationQueueKey(tx, line.id)` 추가**

`loadReservationQueueKey` 는 원래 라인의 수량을 줄이는 update **전에** 부른다(예약 이전 전이라 원래 라인 예약 행이 그대로 있을 때).

- [ ] **Step 5: 통과 확인**

Run: `npm run test:core:integration:local -- reservation-queue-key fulfillment-order-reservation-retry shipment-planning`
Expected: PASS (기존 split 스펙 «splits 10 into 6/4» 포함)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/fulfillment/services/reservation-queue-key.ts apps/core/src/modules/fulfillment/services/reservation-queue-key.integration.spec.ts apps/core/src/modules/fulfillment/services/fulfillment-order-reservation-retry.worker.ts apps/core/src/modules/fulfillment/services/shipment-planning.service.ts
git commit -m "feat(core): 분할된 라인이 재고 대기 순번을 이어받는다 (#1016 15번)"
```

---

### Task 2: 정체 보드 «예약» 판정을 상자 단위로

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts:36-48` (`box` CTE)
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts`, `order-progress.judge-shipments.integration.spec.ts`
- Modify (픽스처): `apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures.ts` — `seedBox` 에 라인별 `qty?: number[]`, `seedConfirmedReservation` 에 `quantity?: number`

**Interfaces:**
- Consumes: 없음
- Produces: 판정 SQL 의 `box.under_reserved` = 상자 라인 `qty` 합 > 그 라인들의 `stock_reservations`(`target_type='SHIPMENT_LINE'`, `status='confirmed'`) `quantity` 합, `box.partially_reserved` = 확정 합 > 0 AND 위 조건. 상자 전체로 잰다(합포장 상자도, D13). `fo_created_at` 은 그대로.

- [ ] **Step 1: 실패하는 판정 스펙** (`order-progress.judge.integration.spec.ts` 에 추가)

```ts
it('한 FO 의 두 상자 — 다 예약된 상자는 «계획 대기», 미예약 상자는 «예약», 주문 대표는 «예약»', async () => {
  // FO status 'partially_reserved', 상자 A(라인 1, 예약 1), 상자 B(라인 1, 예약 0)
  expect(row).toMatchObject({ stage: 'reserve', state: 'created' });
  expect(shipmentRows.get(boxA)).toMatchObject({ stage: 'plan', state: 'awaiting_plan' });
  expect(shipmentRows.get(boxB)).toMatchObject({ stage: 'reserve', state: 'created' });
});
it('일부 예약 라인(qty 3, 예약 2)은 «부분 예약»', async () => {
  expect(row).toMatchObject({ stage: 'reserve', state: 'partially_reserved' });
});
it('FO 가 processing 이어도 draft 상자가 덜 예약이면 «예약»', async () => { /* 옛 판정은 'plan' */ });
it('취소 대기(CANCEL_REPLAN_PENDING)·합포장 대기 상자와 직배 단위의 판정은 그대로다', async () => {
  expect(cancelRow).toMatchObject({ stage: 'cancel', state: 'CANCEL_REPLAN_PENDING' });
  expect(dropShipRow).toMatchObject({ stage: 'dispatch', state: 'drop_ship_pending' });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:core:integration:local -- order-progress.judge` / Expected: 첫·셋째 케이스 FAIL

- [ ] **Step 3: `box` CTE 를 상자 라인 예약 합으로 바꾼다**

`box` 는 (주문 × 상자) 로 GROUP BY 되므로, 상자 전체 합은 별도 CTE `box_res(shipment_id, line_qty, reserved_qty)` 로 구해 조인한다(주문 쪽 라인만 세면 합포장 상자에서 «예약 아님»이 잘못 나온다). 기존 테스트 픽스처가 FO 상태만 주고 예약 행을 안 만드는 경우는 픽스처를 실제와 맞게 고친다(예약 행 추가) — 판정 기대값을 바꾸지 말 것.

- [ ] **Step 4: 통과 확인** — Run: `npm run test:core:integration:local -- order-progress order-reconcile` / Expected: PASS (25·30번 상자 규칙 스펙 포함)

- [ ] **Step 5: 커밋** — `git commit -m "fix(core): 정체 보드 예약 단계를 상자 라인 예약으로 판정 (#1016 15번)"`

---

### Task 3: `splitUnreserved` 명령과 엔드포인트

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts:173-334` (`split` 본체를 `applySplit` 으로 뽑고 `splitUnreserved` 추가)
- Modify: `apps/core/src/modules/fulfillment/dto/shipment-planning.dto.ts` (`SplitUnreservedShipmentDto`)
- Modify: `apps/core/src/modules/fulfillment/controllers/shipment-planning.controller.ts` (라우트)
- Test: `apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `loadReservationQueueKey` (공용 `applySplit` 이 부른다)
- Produces: `SplitUnreservedShipmentDto extends ShipmentCommandReasonDto { expectedManifestVersion: number }` (`@IsInt() @Min(1)`)
- Produces: `ShipmentPlanningService.splitUnreserved(shipmentId: string, dto: SplitUnreservedShipmentDto, idempotencyKey: string, actor: ShipmentPlanningActor, tx?: DbTx): Promise<{ operationId: string; source: ShipmentManifestSnapshot; target: ShipmentManifestSnapshot }>` — `split` 과 같은 응답 모양. 명령 종류 `'shipment.split_unreserved'`, 작업 종류 `'split'`, 감사 action `'shipment.split_unreserved'`.
- Produces: `POST /shipments/:id/split-unreserved` (`@RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)`, `Idempotency-Key` 헤더) — `split` 라우트와 같은 모양
- Produces: 409 코드 `SHIPMENT_FULLY_RESERVED`(옮길 미예약 몫 없음), `SHIPMENT_NOTHING_RESERVED`(전부 미예약 — 남길 «있는 것» 없음), 기존 `SHIPMENT_CONSOLIDATED`(다른 판매주문 라인 보유)

- [ ] **Step 1: 실패하는 통합 스펙** (`shipment-planning.integration.spec.ts` 에 `describe('splitUnreserved')`)

```ts
it('미예약 몫 전부를 새 draft 상자로 옮긴다 — 예약 0 라인은 통째로, 일부 예약 라인은 미예약 몫만', async () => {
  // 상자: L1 qty2 예약2, L2 qty3 예약2, L3 qty1 예약0
  const r = await planning.splitUnreserved(boxId, { expectedManifestVersion: v, reason: '고객 동의 — 있는 것 먼저' }, key, actor, tx);
  expect(qtyAndReserved(r.source)).toEqual({ L1: [2, 2], L2: [2, 2] });
  expect(qtyAndReserved(r.target)).toEqual({ L2: [1, 0], L3: [1, 0] });
  expect(r.target.lines.find((l) => l.id === l3Id)).toBeDefined(); // 통째 이동은 라인 id 유지
});
it('같은 키 재시도는 같은 결과, 새 키로 다시 누르면 SHIPMENT_FULLY_RESERVED', async () => {});
it('화면이 본 뒤 워커가 예약을 더 잡았으면 잠금 뒤 숫자로 옮긴다', async () => {
  // splitUnreserved 직전에 L2 에 예약 1 추가 → target 에 L2 없음
});
it('전부 미예약 상자는 SHIPMENT_NOTHING_RESERVED, 새 상자를 만들지 않는다', async () => {});
it('다른 판매주문 라인이 든 상자는 SHIPMENT_CONSOLIDATED', async () => {});
it('planned 상자는 SHIPMENT_NOT_DRAFT', async () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:core:integration:local -- shipment-planning` / Expected: FAIL (`splitUnreserved` 없음)

- [ ] **Step 3: `applySplit` 추출**

`private async applySplit(tx: DbTx, args: { aggregate: ShipmentAggregate; selected: Array<{ move: ShipmentSplitMoveDto; line: ShipmentAggregate['lines'][number] }>; reservationTargets: Map<string, number>; actor: ShipmentPlanningActor; meta: ShipmentCommandReasonDto; action: 'shipment.split' | 'shipment.split_unreserved'; idempotencyKey: string; requestHash: string; before: ShipmentManifestSnapshot })` — 지금 `split` 의 `createOperation` 부터 `return { response, … }` 까지(240-331행) 그대로. `split` 은 검증 뒤 이것을 부른다. 기존 split 스펙이 그대로 통과해야 한다.

- [ ] **Step 4: `splitUnreserved` 구현**

`commands.execute` 안에서: `lockAggregate` → `assertShipmentVersion(expectedManifestVersion)` → draft 아니면 `SHIPMENT_NOT_DRAFT` → 라인에 다른 `salesOrderId` 가 있으면 `SHIPMENT_CONSOLIDATED`(`reviseRecipientFromChannel` 446-450행과 같은 검사, 기준 주문은 첫 라인의 것) → `assertNoCustodyOrActiveWork`·`assertNoActiveWaybill` → `confirmedReservationQtyByLine` 으로 라인별 미예약 = qty − 확정 → 미예약 합 0 이면 `SHIPMENT_FULLY_RESERVED`, 확정 합 0 이면 `SHIPMENT_NOTHING_RESERVED` → `selected` = 미예약 > 0 인 라인마다 `{ move: { shipmentLineId, expectedLineVersion: line.lineVersion, qty: 미예약 }, line }`, `reservationTargets` 는 전부 0 → `applySplit`. `assertV2MutationAllowed('shipment.split_unreserved')`, `assertReason(dto.reason)` 은 `split` 과 같다.

- [ ] **Step 5: 컨트롤러 라우트 추가** (`split` 바로 아래, 같은 모양)

- [ ] **Step 6: 통과 확인** — Run: `npm run test:core:integration:local -- shipment-planning` 그리고 `npx jest scripts/security` / Expected: PASS. route 감사가 새 라우트를 요구하면 그 명단에 `WAREHOUSE_OPERATE` 로 더한다.

- [ ] **Step 7: 커밋** — `git commit -m "feat(core): 상자의 미예약 몫을 한 번에 나누는 split-unreserved (#1016 15번)"`

---

### Task 4: 보드 «예약» 줄에 부족 품목·입고 예정 싣기

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-progress/reserve-shortage.reader.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts` (item 에 `shortage: null` 기본값), `order-progress.service.ts` (`listOrders` 가 stage `reserve` 일 때 붙인다), `order-progress.module.ts` (provider)
  — `OrderProgressReader` 생성자는 바꾸지 않는다(여러 통합 스펙이 `new OrderProgressReader(makeDbService(db))` 로 만든다)
- Modify: `apps/core/src/modules/fulfillment/order-progress/dto/order-progress-response.dto.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/reserve-shortage.reader.integration.spec.ts`

**Interfaces:**
- Produces: 타입·DTO
  ```ts
  type ReserveShortageItem = { skuId: string; skuName: string; shortQty: number; expectedArrival: string | null };
  type ReserveShortage = {
    shipmentId: string; manifestVersion: number;
    consolidated: boolean;          // 다른 판매주문 라인 보유 → 화면이 버튼을 막는다(D13)
    skuKinds: number; shortSkuKinds: number;   // «10종 중 1종» — 그 상자의 SKU 종 수
    items: ReserveShortageItem[];   // SKU 별 합, shortQty 큰 순
  };
  ```
  `OrderProgressItem.shortage: ReserveShortage | null`(stage 가 `reserve` 가 아니면 늘 null). DTO 는 `ReserveShortageItemDto`·`ReserveShortageDto` 클래스로 따로 둔다(`@ApiProperty({ type: 'object' })` 금지).
- Produces: `ReserveShortageReader.forOrders(salesOrderIds: string[], tx?: DbTx): Promise<Map<string, ReserveShortage>>`
  - 대표 상자 = 그 주문 라인이 있는 status `draft`·`recovery_code IS NULL` 상자 중 덜 예약된 것(Task 2 와 같은 상자 합 기준), `opened_at` 오래된 것 하나.
  - `expectedArrival` = 그 SKU 의 `purchase_order_lines` 중 `status='ordered'` · `closed_at IS NULL` · `ordered_qty > received_qty` 인 행의 가장 이른 `expected_arrival`(문자열 `YYYY-MM-DD`, `date` mode string 그대로). 없으면 null. 창고는 따지지 않는다.
  - SKU 이름은 `skus.name`.
  - 한 번의 SQL 로 주문 묶음을 처리한다(페이지 50건마다 N+1 금지).

- [ ] **Step 1: 실패하는 통합 스펙**

```ts
it('대표 상자와 SKU 별 부족 수량·종 수를 싣는다', async () => {
  expect(map.get(orderId)).toEqual({ shipmentId: boxId, manifestVersion: 1, consolidated: false, skuKinds: 3, shortSkuKinds: 1,
    items: [{ skuId: s3, skuName: '헤어클립 세트', shortQty: 2, expectedArrival: '2026-10-25' }] });
});
it('같은 SKU 가 두 라인에 걸치면 한 품목으로 합친다', async () => {});
it('열린 발주가 없거나 다 받았거나 잔량 포기면 expectedArrival 은 null', async () => {});
it('가장 이른 도착예정일을 고른다', async () => {});
it('합포장 상자는 consolidated: true', async () => {});
it('덜 예약된 상자가 없는 주문은 맵에 없다', async () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:core:integration:local -- reserve-shortage` / Expected: FAIL

- [ ] **Step 3: `ReserveShortageReader` 구현. `OrderProgressService.listOrders` 가 `query.stage === 'reserve'` 일 때 `reader.listOrders` 결과의 주문 id 로 `forOrders` 를 한 번 부르고 각 item 의 `shortage` 를 채운다(그 밖 단계는 reader 가 넣은 `null` 그대로)**

- [ ] **Step 4: 통과 확인** — Run: `npm run test:core:integration:local -- reserve-shortage order-progress.board` / Expected: PASS

- [ ] **Step 5: 커밋** — `git commit -m "feat(core): 정체 보드 예약 줄에 부족 품목과 입고 예정 (#1016 15번)"`

---

### Task 5: 메인·통계 «출고불가·부분출고» 를 `order_progress` 에서 센다

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:1336-1360` (`shipBlockCounts`)
- Test: `apps/core/src/modules/sales-order/services/sales-orders-stats.integration.spec.ts:137-170` (옛 라인 상태 케이스 셋을 교체)

**Interfaces:**
- Produces: `getStats()` 응답 모양 그대로(`cannotShip`, `partialOutbound`). 정의(D9):
  - `cannotShip` = `order_progress` 의 `outcome IS NULL AND stage = 'reserve'` 행 수 — 보드 «예약» 칸 `open` 과 같은 값. 14일 창·`confirmed` 조건은 없다.
  - `partialOutbound` = 그중 그 주문 라인이 든 상자 하나라도 status `shipped`·`in_transit`·`failed`·`delivered` 인 주문 수.
  - `shipBlockCounts(fourteenDaysAgo)` 인자는 지운다.

- [ ] **Step 1: 실패하는 스펙** — 옛 셋(137·147·161행)을 지우고:

```ts
it('출고 불가는 보드 «예약» 단계의 진행 중 주문 수다', async () => { /* order_progress stage reserve 2, plan 1, 종료 reserve 1 */ expect(stats.cannotShip).toBe(2); });
it('부분 출고는 그중 다른 상자가 이미 움직인 주문이다', async () => { expect(stats.partialOutbound).toBe(1); });
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:core:integration:local -- sales-orders-stats` / Expected: FAIL
- [ ] **Step 3: `shipBlockCounts()` 를 `wmsTables.orderProgress` 기준으로 다시 쓴다(라인 상태 조인 제거)**
- [ ] **Step 4: 통과 확인** — 같은 명령 / PASS
- [ ] **Step 5: 커밋** — `git commit -m "fix(core): 출고불가 숫자를 정체 보드 예약 단계로 센다 (#1016 15번)"`

---

### Task 6: admin-web — 보드 «예약» 줄·«있는 것 먼저»·입구 링크·FO 상세 분할 검사

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts` (+ `.spec.ts`)
- Modify: `apps/admin-web/src/lib/api/domains/orders/fulfillment-order.client.ts` (`splitUnreservedShipment`), `apps/admin-web/src/lib/services/orders/mutations.ts` (`useSplitUnreservedShipment`)
- Create: `apps/admin-web/src/features/order/stall-board/components/shortage-split-action.tsx`
- Modify: `apps/admin-web/src/features/order/stall-board/components/stage-orders.tsx` (예약 단계 칸·조치 열), `features/order/stall-board/template/index.tsx` (`?stage=` 초기 선택)
- Modify: `apps/admin-web/src/features/main/template/MainTemplate.tsx:120`, `features/statistics/template/overview.tsx:174`, `features/order/history/components/status-section/index.tsx:60-61` (링크 `/order/stall-board?stage=reserve`)
- Modify: `apps/admin-web/src/features/order/fulfillments/detail/shipment-actions.tsx:205-215`

**Interfaces:**
- Consumes: Task 3 `POST /shipments/:id/split-unreserved` (body `{ expectedManifestVersion, reason }`, 헤더 `Idempotency-Key`), Task 4 `shortage`
- Produces (shape, 순수 함수):
  - `ProgressItem.shortage: ReserveShortageView | null`, `toProgressPage` 가 형식이 틀리면 null 로 정형(옛 core 응답엔 없다)
  - `shortageSummary(s: ReserveShortageView): string` → `'10종 중 1종 · 헤어클립 세트 2개'` (품목 2개 넘으면 `'헤어클립 세트 2개 외 1'`)
  - `arrivalLabel(expectedArrival: string | null): string` → `'입고 10-25'` / `''`
  - `canSplitShortage(s: ReserveShortageView): boolean` → `!s.consolidated` (전부 미예약 등 나머지 거절은 서버가 409 로 한다)
  - `initialBoardStage(param: string | null): BoardStageKey` → `BOARD_STAGES` 에 있는 키면 그것, 아니면 `'fo'`
  - `isSplitQtyAllowed(moveQty: number, lineQty: number, shipmentTotalQty: number): boolean` → `moveQty >= 1 && moveQty <= lineQty && moveQty < shipmentTotalQty`

- [ ] **Step 1: 실패하는 shape 스펙** — 위 함수 각각, `toProgressPage` 의 `shortage` 정형(없음·형식 틀림 → null)

- [ ] **Step 2: 실패 확인** — Run: `npm run test:admin-web -- order-progress.shape` / Expected: FAIL

- [ ] **Step 3: shape 함수 구현 → 통과 확인**

- [ ] **Step 4: 화면 연결**
  - 예약 단계 표에 «모자람»(`shortageSummary` + `arrivalLabel`) 칸과 «조치» 칸. 조치는 `ShortageSplitAction` — 버튼 «있는 것 먼저», 누르면 확인 대화상자(옮길 품목·수량 목록, 사유 입력 필수, 기본값 없음) → `useSplitUnreservedShipment`. `consolidated` 면 버튼 대신 «합포장 — FO 상세에서» 문구. 409 `SHIPMENT_FULLY_RESERVED` 는 «이미 다 예약됨» 토스트 후 목록 새로고침.
  - 템플릿 `selected` 초기값 = `initialBoardStage(useSearchParams().get('stage'))`.
  - 메인·통계·주문내역 카드의 «출고불가» 링크를 `/order/stall-board?stage=reserve` 로.
  - FO 상세 분할 검사를 `isSplitQtyAllowed` 로 교체, 오류 문구 «분할 수량은 1 이상, 라인 수량 이하여야 하고 상자에 수량이 남아야 합니다».

- [ ] **Step 5: 확인** — Run: `npm run test:admin-web` 그리고 `(cd apps/admin-web && npx tsc --noEmit)` / Expected: PASS, 에러 0

- [ ] **Step 6: 커밋** — `git commit -m "feat(admin-web): 정체 보드에서 재고 부족 주문을 나눠 보낸다 (#1016 15번)"`

---

### Task 7: 게이트와 PR

- [ ] **Step 1:** `npm run type-check` → 에러 0
- [ ] **Step 2:** `npx jest --maxWorkers=2` → 실패 0 (`scripts/security` 포함)
- [ ] **Step 3:** `npm run test:core:integration:local -- order-progress shipment-planning reservation-queue-key reserve-shortage sales-orders-stats order-reconcile` → PASS
- [ ] **Step 4:** 판정 SQL 비용 — 로컬 DB 에서 `EXPLAIN ANALYZE` 로 `judgedRowsSql(candidateIdsSql(null))` 시간을 재고 PR 본문에 적는다. 라이브 `EXPLAIN ANALYZE` 는 배포 전 사람이 한다(#1016 체크박스).
- [ ] **Step 5:** PR 생성. 본문에 배포 순서 **`migrate → deploy`**(core `add-shipment-line-demand-requested-at`), #1016 «남은 운영 작업»에 달 줄 둘을 적는다: ① «15번 ⓐ 배포 전 — 판정 SQL `EXPLAIN ANALYZE` 5초 게이트» ② «15번 ⓐ 배포 — `db:migrate`(core) → `sst deploy`».
