# K3 PR 2 — 입점사 상자 expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입점사 상자를 담을 자리를 스키마에 만들고(expand), 직배 SKU 가 입점사 하나에 묶이게 하고, 창고 흐름의 진입점이 입점사 상자를 받으면 던지게 한다. **동작은 휴면이다** — 입점사 상자를 만드는 코드는 PR 4 이고 직배 SKU 는 라이브 0 이다.

**Architecture:** `shipments.warehouse_id` 의 NOT NULL 을 풀면 `ShipmentRow.warehouseId` 가 `string | null` 이 되고, tsc 가 창고 id 를 쓰는 곳 29곳(16 파일, 2026-10-25 실측)을 잡는다. 그곳이 곧 창고 흐름의 진입점이다. 각 곳을 **좁히거나**(`warehouseIdOf` — 입점사 상자면 409) **넓힌다**(스냅샷·복사·조회처럼 상자 종류와 무관한 곳). 타입이 1차 방어선이고, 진입 함수 목록을 AST 가드 spec 이 지킨다. 이벤트 계약·FO 생성·발송 명령은 넣지 않는다(PR 3 이후).

**Tech Stack:** NestJS(core), Drizzle + drizzle-kit generate, Postgres CHECK·복합 FK, Jest(unit + `DATABASE_URL` 통합), TypeScript compiler API(가드 spec).

**Spec:** `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` (§4.1, §4.2, §4.4 의 `dispatch_attempts` CHECK, §4.8, §6, §7 PR 2). 형식 본보기: `docs/superpowers/plans/2026-10-25-k3-fo-projection-pr1.md`.

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. 넘김 기록은 테이블 `supplier_handoffs` + `shipments.supplier_handoff_id`.** 묶음 행(입점사·만든 사람·시각)이 «넘긴 것» 화면(§4.9)의 단위다. 상자 → 묶음은 **복합 FK `(supplier_handoff_id, supplier_id) → supplier_handoffs(id, supplier_id)`** 라서 다른 입점사의 묶음에 상자가 들어가는 것을 DB 가 막는다. «넘긴 시각» = 묶음의 `created_at`(상자에 따로 두지 않는다). 다시 받기는 같은 묶음을 다시 내려받는 것이라 행이 늘지 않는다.
- **N2. «못 보냄»은 `shipment_lines` 의 칸 셋**(`unfulfillable_reason`·`_reported_at`·`_reported_by`), 셋 다 있거나 셋 다 없다. 이력은 남기지 않는다(다시 보고하면 덮어쓴다 — PR 5).
- **N3. `dispatch_attempts.kind`** = `'warehouse' | 'supplier'`(varchar + CHECK, 기본 `'warehouse'`). pgEnum 으로 하지 않는 이유: contract 때 값 제거가 타입 재생성이라 비싸다. `supplier` 시도는 원장 칸(`stock_journal_id`·`reversal_journal_id`)이 **반드시 NULL**, `dispatched`·`recalled` CHECK 의 원장 요구는 `warehouse` 에만.
- **N4. 알릴 취소는 `supplier_id` 추가 + `holder_id` NOT NULL 해제 + «정확히 하나» CHECK.** 라이브 행 수가 0 이어도 같은 길로 간다 — 옛 경로(`UnboxedDemandCancellation.recordPartnerNotices`)가 지금 `holder_id` 로 쓰고 있고, PR 6 이 마이그 없이 `supplier_id` 로 쓰려면 지금 풀어야 한다. `holders` FK 제거는 PR 8.
- **N5. `carrier` enum 에 8개를 더한다:** `EPOST`(우체국택배)·`DAESIN`(대신택배)·`ILYANG`(일양로지스)·`HDEXP`(합동택배)·`CVSNET`(GS 편의점택배)·`CUPOST`(CU 편의점택배)·`CHUNIL`(천일택배)·`KUNYOUNG`(건영택배). 코드는 네이버 택배사 코드를 따랐다(기존 6개는 우리 코드 그대로). **창고 경로는 계속 기존 6개만 받는다** — 수기 송장 DTO 와 발송 이벤트를 `EVENT_CONTRACT_CARRIERS`(6개)로 묶는다. 안 묶으면 운영자가 창고 상자에 `EPOST` 수기 송장을 달고 발송하는 순간 소비자(channel-adapter·notification) zod 가 throw 한다. PR 3 이 계약을 넓힐 때 이 묶음을 푼다.
- **N6. 공급사 쪽 구멍도 막는다.** 직배 SKU 가 묶인 공급사의 `is_direct_delivery` 를 `true → false` 로 바꾸거나 삭제하면 409 `SUPPLIER_HAS_DROP_SHIPPED_SKUS`(삭제는 `sku_suppliers` 가 cascade 라 연결이 조용히 사라진다). 입점사 상자가 있는 공급사 삭제는 409 `SUPPLIER_HAS_SHIPMENTS`(없으면 FK restrict 가 설명 없는 500).
- **N7. SKU 규칙:** `drop_shipped` SKU 는 `is_direct_delivery = true` 공급사와의 연결이 **정확히 하나**. 직배가 아닌 공급사 연결은 세지 않는다. 모르는 `supplierIds` 는 400 `SKU_SUPPLIER_NOT_FOUND`(지금은 FK 500), 중복 id 는 한 번으로 친다. 검사는 생성 때 항상, 수정 때는 «재고 유형 또는 직배 공급사 집합»이 실제로 바뀔 때만.
- **N8. 넓히는 곳(중립)은 입점사 상자가 그대로 지나간다:** 분할(`applySplit`), 묘비 상자(`shrinkDraftLines`), 상자 스냅샷 둘, 정합성 점검 입력, 상자 상세·요약 DTO. 분할·취소는 PR 5·6 이 입점사 상자에 쓸 길이라 막지 않는다. 그 길이 예약 0 상자에서 무해한지는 PR 5·6 이 확인한다(§4.4·§4.7).
- **N9. 한진 배송 추적 폴러는 입점사 상자를 고르지 않는다**(`findTargets` 에 `warehouse_id IS NOT NULL`). 입점사가 한진을 써도 자동 배송완료 감지는 비목표이고, 입점사 상자는 `in_transit`·`delivered` 전이를 쓰지 않는다(§4.4).
- **N10. 옛 판별 가드(`fulfillment_mode === 'drop_ship'`·`stockType === 'drop_shipped'`, 부록 A (h))는 남긴다.** 옛 모델 FO 를 아직 막고 있고 해가 없다. PR 8 이 `drop_ship` 모드와 함께 걷는다.

## Global Constraints

- **expand 만.** 칸·테이블·인덱스·NULLABLE FK·CHECK 추가, NOT NULL 해제, enum 값 추가. 칸·값 제거와 NOT NULL 추가는 없다. 배포는 `migrate → deploy`(CLAUDE.md, ADR-0005 §5).
- 생성 마이그는 적용 전에 첫 줄에 `SET LOCAL lock_timeout = '10s';` 를 손으로 넣는다(선례 `apps/core/drizzle/20260914154449_guard-purchase-order-receiving-contract.sql`). `shipments` 는 창고 스테이션이 쉬지 않고 쓰는 테이블이다.
- 마이그는 둘: Task 2(상자·시도·라인·넘김·알릴 취소)와 Task 4(`carrier` 값). 각각 `schema.ts` + `drizzle/<ts>_*.sql` + `drizzle/meta/` 를 **한 커밋**에.
- 이벤트 계약(`packages/event-contracts/**`)·FO 생성·발송 명령·admin-web 은 손대지 않는다.
- 트랜잭션·쿼리 규칙(ADR-0025, CLAUDE.md Inventory): `tx` 전파, `db.query.*`·`with`·`any`/`as` 금지.
- 에러는 `ApplicationException` 하위 클래스(전역 필터가 코드를 응답 `error` 로 낸다). 선례 `inventory/sku-catalog/sku-catalog.errors.ts`.
- 통합 테스트: 스크래치 DB `k6_it`, `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`. 마이그 적용은 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts`.
- 기준선: 브랜치 시작 때 `k6_it` 에서 `apps/core/src/modules/fulfillment apps/core/src/modules/inventory` 의 `*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0, 통합(`k6_it`) 기준선 외 실패 0.

## Review Focus

- **다른 입점사의 넘김 묶음에 상자를 붙임** — 복합 FK 가 거절해야 한다. Task 2 스키마 spec 케이스.
- **창고 상자에 새 택배사 수기 송장** — DTO 가 400 으로 거절해야 한다(N5). Task 4 케이스.
- **직배 공급사를 «직배 아님»으로 바꾸기·삭제하기** — 직배 SKU 가 묶여 있으면 409(N6). Task 5 케이스.
- **옛 SKU(직배 연결 없는 `drop_shipped`)의 이름만 수정** — 통과해야 한다(값이 안 바뀜). 라이브에 그런 행이 있으면 FO 생성(PR 4)이 fail-closed 로 드러낸다(§4.2). Task 5 케이스.
- **배송 추적 폴러가 한진 수기 송장을 단 입점사 상자를 고름** — 안 골라야 한다(N9). Task 3 케이스.

---

## 배포

- 배포 단위: **Core 만.** 마이그 둘, `migrate → deploy`. `npm run deploy:preflight -- --stage live` 가 expand 로 분류하는지 본다.
- 롤백: 이 PR 이전 Core 로 되돌려도 안전하다 — 새 칸은 모두 nullable·기본값이고 옛 코드는 무시한다. 마이그를 되돌리지는 않는다(enum 값 제거 불가, 필요도 없다).
- 이 PR 이 라이브여도 입점사 상자는 0 개다. 개통은 PR 1~7 라이브 뒤(§7).

---

### Task 0: 착수 전 라이브 실측 (사용자 터널)

**Files:** 없음(결과는 PR 본문에).

- [ ] **Step 1: 사용자에게 터널을 부탁한다** — `npx sst tunnel --stage live`. 터널은 사용자가 띄운다.
- [ ] **Step 2: 읽기 전용으로 잰다** (§6 의 기대값은 모두 0, 행 수 셋은 CHECK 스캔 시간 판단용)

```sql
SELECT count(*) FILTER (WHERE stock_type = 'drop_shipped' AND NOT is_deleted) AS drop_skus,
       count(*) FILTER (WHERE stock_type = 'drop_shipped' AND NOT is_deleted AND NOT EXISTS (
         SELECT 1 FROM sku_suppliers ss JOIN suppliers s ON s.id = ss.supplier_id
          WHERE ss.sku_id = skus.id AND s.is_direct_delivery)) AS drop_skus_unlinked
  FROM skus;
SELECT count(*) AS drop_ship_fo FROM fulfillment_orders WHERE fulfillment_mode = 'drop_ship';
SELECT count(*) AS cancel_notices FROM direct_ship_cancel_notices;
SELECT count(*) AS channel_drop_lines
  FROM fulfillment_order_items foi
  JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
  JOIN sales_orders so ON so.id = fo.sales_order_id
  JOIN skus k ON k.id = foi.sku_id
 WHERE k.stock_type = 'drop_shipped' AND so.sales_channel <> 'medusa';
SELECT (SELECT count(*) FROM shipments) AS shipments,
       (SELECT count(*) FROM shipment_lines) AS shipment_lines,
       (SELECT count(*) FROM dispatch_attempts) AS dispatch_attempts;
```

Expected: 앞의 다섯은 0. 하나라도 0 이 아니면 **멈추고 사용자에게 보고한다**(§6 — 그 행의 이행을 계획에 넣어야 한다). 행 수가 100만을 넘으면 CHECK 추가를 `NOT VALID` + `VALIDATE` 로 나눌지 사용자에게 묻는다.

### Task 1: 상자 주인 판별 `shipment-owner.ts`

**Files:**
- Create: `apps/core/src/modules/fulfillment/shipment/shipment-owner.ts`
- Create: `apps/core/src/modules/fulfillment/shipment/shipment-owner.spec.ts`

**Interfaces:**
- Produces:
  - `export type ShipmentOwner = { kind: 'warehouse'; warehouseId: string } | { kind: 'supplier'; supplierId: string }`
  - `export function shipmentOwnerOf(row: { id: string; warehouseId: string | null; supplierId: string | null }): ShipmentOwner` — 둘 다 있거나 둘 다 없으면 `Error`(CHECK 가 막으므로 도달 불가)
  - `export function warehouseIdOf(row: { id: string; warehouseId: string | null }): string` — `null` 이면 `SupplierShipmentInWarehouseFlowError`
  - `export function ownerColumns(owner: ShipmentOwner): { warehouseId: string | null; supplierId: string | null }`
  - `export class SupplierShipmentInWarehouseFlowError extends ApplicationException` — 코드 `SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW`, 409. 메시지에 상자 id.

- [ ] **Step 1: 유닛 spec** — `warehouseIdOf({ id: 's1', warehouseId: 'w1' }) === 'w1'`; `warehouseIdOf({ id: 's1', warehouseId: null })` 가 `SupplierShipmentInWarehouseFlowError` 를 던지고 `getErrorCode() === 'SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW'`, `getHttpStatus() === 409`, 메시지에 `'s1'`; `shipmentOwnerOf` 가 `{w,null}` → warehouse, `{null,s}` → supplier, `{w,s}`·`{null,null}` → throw; `ownerColumns` 왕복.
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/fulfillment/shipment/shipment-owner.spec.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: Commit** — `git commit -m "K3 PR2 — 상자 주인 판별(창고/입점사)과 창고 흐름 거부 에러"`

### Task 2: 스키마 expand(상자·시도·라인·넘김·알릴 취소) + 타입 정리

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` — `suppliers` 아래(=`shipments` 위)에 `supplierHandoffs`, `shipments`(:1974), `shipmentLines`(:2029), `dispatchAttempts`(:3605), `directShipCancelNotices`(:1780), 스키마 묶음 객체(:3746 근처)에 `supplierHandoffs`
- Create: `apps/core/drizzle/<ts>_add-supplier-shipments.sql` + `drizzle/meta/` (생성)
- Modify: `apps/core/src/modules/fulfillment/shipment/shipment-lifecycle.ts:110-159` — `NewShipment.warehouseId` → `owner: ShipmentOwner`, `insertShipment` 이 `ownerColumns(box.owner)` 를 쓴다
- Modify(타입 정리, 아래 표): 16 파일
- Modify: `apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures.ts` — `seedDirectSupplier(tx): Promise<string>`(`is_direct_delivery = true`), `seedBox` 의 `args.supplierId?: string`(주면 `warehouseId: null`)
- Create: `apps/core/src/modules/fulfillment/shipment/supplier-shipment.schema.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 전부
- Produces(스키마):
  - `supplierHandoffs`: `id uuid pk`, `supplierId → suppliers (restrict) notNull`, `createdBy varchar(255) notNull`, `createdAt`. `unique('uq_supplier_handoffs_id_supplier').on(id, supplierId)`(복합 FK 대상), `index('idx_supplier_handoffs_supplier').on(supplierId, createdAt)`
  - `shipments.supplierId uuid → suppliers (restrict)` nullable, `warehouseId` NOT NULL 해제, `supplierHandoffId uuid` nullable
    - `ck_shipments_owner`: `(warehouse_id IS NULL) <> (supplier_id IS NULL)`
    - `ck_shipments_handoff_supplier`: `supplier_handoff_id IS NULL OR supplier_id IS NOT NULL`
    - `fk_shipments_supplier_handoff`: `(supplier_handoff_id, supplier_id) → supplier_handoffs(id, supplier_id)`
    - `idx_shipments_supplier_status`: `(supplier_id, status) WHERE supplier_id IS NOT NULL`
  - `shipmentLines.unfulfillableReason text`, `unfulfillableReportedAt timestamptz`, `unfulfillableReportedBy varchar(255)` — `ck_shipment_lines_unfulfillable`: 셋 다 NULL, 또는 `reported_at`·`reported_by` NOT NULL 이고 `length(btrim(reason)) > 0`
  - `dispatchAttempts.kind varchar(16) .$type<'warehouse' | 'supplier'>() notNull default 'warehouse'`
    - `ck_dispatch_attempts_kind`: `kind IN ('warehouse','supplier')`
    - `ck_dispatch_attempts_dispatched_at`(교체): `status NOT IN ('dispatched','recalled') OR (dispatched_at IS NOT NULL AND (kind = 'supplier' OR stock_journal_id IS NOT NULL))`
    - `ck_dispatch_attempts_recalled_at`(교체): `status <> 'recalled' OR (recalled_at IS NOT NULL AND (kind = 'supplier' OR reversal_journal_id IS NOT NULL))`
    - `ck_dispatch_attempts_supplier_no_journal`: `kind <> 'supplier' OR (stock_journal_id IS NULL AND reversal_journal_id IS NULL)`
  - `directShipCancelNotices.supplierId uuid → suppliers` nullable, `holderId` NOT NULL 해제, `ck_direct_ship_cancel_notices_party`: `(holder_id IS NULL) <> (supplier_id IS NULL)`, `idx_direct_ship_cancel_notices_pending_supplier`: `(supplier_id, created_at) WHERE notified_at IS NULL`
- Produces(코드): `ShipmentManifestSnapshot.warehouseId: string | null` + `supplierId: string | null`(`shipment-aggregate.ts:24`), 같은 모양으로 `ConsolidationManifestSnapshot`; `ShipmentDetailResponseDto`·`ShipmentSummaryResponseDto`(`dto/shipment-planning.dto.ts:291,320`)의 `warehouseId: string | null`(`@ApiProperty({ nullable: true })`) + `supplierId: string | null`

**타입 정리 표** — `warehouse_id` 를 nullable 로 바꾸면 tsc 가 아래를 잡는다(2026-10-25 실측). 좁힘 = 그 함수 첫머리에서 `warehouseIdOf(...)` 로 창고 id 를 얻고 그 값을 쓴다. 넓힘 = 타입을 nullable 로 + 주인 복사는 `owner: shipmentOwnerOf(shipment)`.

| 파일 | 함수 | 처리 |
|---|---|---|
| `fulfillment/draft-box/draft-box-amender.ts` | `amendLocked` | 좁힘 |
| `fulfillment/reader/shipment-waybill.reader.ts` | `byTrackingNo`(·`withdrawnByVoidedWaybill`) | 좁힘 |
| `fulfillment/services/consolidation.service.ts` | `assertCompatibleSources`(→ `activateConsolidation` 은 좁힌 id 를 받는다) | 좁힘 |
| 〃 | `snapshot` | 넓힘 |
| `fulfillment/services/outbound-batch-orchestrator.service.ts` | `assertEligible`(→ `getEligibleShipments`) | 좁힘 |
| `fulfillment/services/shipment-dispatch.service.ts` | `dispatchLocked`(735·792·1189 모두 그 값) | 좁힘 |
| `fulfillment/services/shipment-reservation.service.ts` | `restoreForRecall`, `loadLineContext` | 좁힘 |
| `inventory/core/repositories/stock-event.store.ts` | `reverseShipmentDispatchEvent`, `authorizeAndLinkBatchSessionDispatch` | 좁힘 |
| `inventory/core/services/inventory-command.service.ts` | `reverseShipmentDispatch` | 좁힘 |
| `fulfillment/services/draft-line-shrink.ts` | `shrinkDraftLines`(묘비) | 넓힘 |
| `fulfillment/services/shipment-planning.service.ts` | `applySplit` | 넓힘 |
| 〃 | `getShipmentDetail`, `getFulfillmentShipments` | 넓힘(DTO) |
| `fulfillment/services/shipment-aggregate.ts` | `shipmentSnapshot` | 넓힘 |
| `fulfillment/services/fulfillment-invariant.service.ts` | `assertFulfillmentOrders` 입력 | 넓힘 |
| `fulfillment/services/fulfillments.service.ts` | `openShipment` 호출 | `owner: { kind: 'warehouse', warehouseId }` |
| spec: `shipment-dispatch.integration.spec.ts`, `shipment-lifecycle.integration.spec.ts` | — | 테스트 타입만 |

표에 없는 tsc 에러가 나오면 같은 기준(그 값으로 재고·예약·원장·창고 위치를 다루면 좁힘, 아니면 넓힘)으로 처리하고 PR 본문에 적는다.

- [ ] **Step 1: 스키마 spec 을 쓴다** (`describeIfDb`, `inRollbackTx`, 각 케이스는 `SAVEPOINT` 로 감싸 위반을 단언 — 23514/23503)
  - `창고 상자와 입점사 상자는 들어간다` — `{warehouseId}`·`{supplierId}` 각각 insert 성공
  - `둘 다 없거나 둘 다 있으면 ck_shipments_owner` — 23514, constraint 이름 단언
  - `넘김 묶음은 같은 입점사 상자만` — 입점사 A 의 묶음 id 를 입점사 B 상자에 → 23503 `fk_shipments_supplier_handoff`; 창고 상자에 묶음 id → 23514 `ck_shipments_handoff_supplier`
  - `못 보냄 칸은 셋이 함께` — reason 만 → 23514; 공백 reason + 나머지 → 23514; 셋 다 → 성공
  - `입점사 시도는 원장 없이 dispatched·recalled` — `kind: 'supplier', status: 'dispatched', dispatchedAt` 성공; 같은 행에 `recalled, recalledAt` 성공
  - `창고 시도는 여전히 원장이 필요하다` — `kind` 생략·`dispatched`·원장 없음 → 23514 `ck_dispatch_attempts_dispatched_at`
  - `입점사 시도에 원장이 붙으면 거절` — 23514 `ck_dispatch_attempts_supplier_no_journal`
  - `알릴 취소는 holder 나 supplier 중 하나` — 둘 다 NULL·둘 다 값 → 23514 `ck_direct_ship_cancel_notices_party`; `supplierId` 만 → 성공
- [ ] **Step 2: 스키마를 고치고 마이그를 만든다** — `npm run db:generate:core -- --name add-supplier-shipments`. 생성 SQL 을 읽어 위 이름들이 그대로인지, `DROP` 은 교체되는 CHECK 둘과 NOT NULL 해제 둘뿐인지 확인. 첫 줄에 `SET LOCAL lock_timeout = '10s';`
- [ ] **Step 3: 스크래치에서 먼저 돌린다** — `( echo BEGIN; sed 's/--> statement-breakpoint//' <파일>; echo ROLLBACK ) | docker exec -i almondyoung-server-postgres-1 psql -U postgres -d k6_it -v ON_ERROR_STOP=1` → 에러 없음. 그다음 `k6_it` 에 migrate.
- [ ] **Step 4: 타입을 정리한다** (표대로) — `npm run type-check` → 에러 0
- [ ] **Step 5: 스키마 spec 통과** — `DATABASE_URL=… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/shipment/supplier-shipment.schema.integration.spec.ts` → PASS
- [ ] **Step 6: 회귀** — fulfillment·inventory 통합 전체를 기준선과 비교 → 새 실패 0. `npx jest apps/core/src/modules/fulfillment apps/core/src/modules/inventory` → PASS. `shipment-writes.guard.spec.ts` 가 `owner` 때문에 빨개지면 허용 목록이 아니라 호출 모양을 고친다.
- [ ] **Step 7: Commit** — schema + 마이그 + meta + 코드 한 커밋. `git commit -m "K3 PR2 — 입점사 상자 expand: 상자 주인·넘김 묶음·못 보냄·입점사 발송 시도·알릴 취소 입점사"`

### Task 3: 창고 흐름 진입점 가드

**Files:**
- Modify(좁힘 추가 — tsc 가 못 잡는 진입점. 함수 첫머리에서 그 상자 행의 `warehouse_id` 로 `warehouseIdOf`. 행을 안 읽고 있으면 첫 조회에 `warehouseId` 를 더한다):
  - `fulfillment/services/shipment-planning.service.ts` `plan`
  - `fulfillment/picking/allocation/allocation.locks.ts` `assertStartEligibility`
  - `fulfillment/services/location-outbound.service.ts` `start`
  - `fulfillment/services/simple-outbound.service.ts` `prepare`
  - `fulfillment/services/shipment-short-pick.service.ts` `report`
  - `fulfillment/waybill/waybill.reader.ts` `loadIssueContext`(발급·재발급·일괄 발급이 모두 지난다)
  - `fulfillment/waybill/waybill.manager.ts` `registerManual`, `assertDispatchable`
  - `fulfillment/waybill/waybill-label-state.reader.ts` `forShipment`
- Modify: `fulfillment/services/carrier-tracking.poller.ts` `findTargets` — `isNotNull(wmsTables.shipments.warehouseId)` (N9)
- Create: `apps/core/src/modules/fulfillment/shipment/supplier-shipment-entry.guard.spec.ts`
- Create: `apps/core/src/modules/fulfillment/shipment/supplier-shipment-entry.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `warehouseIdOf`, Task 2 `seedDirectSupplier`·`seedBox({ supplierId })`
- Produces: 가드 spec 의 `WAREHOUSE_FLOW_ENTRIES: ReadonlyArray<{ file: string; fn: string }>` — PR 5·6 이 입점사 갈래를 열 때 이 목록에서 뺀다(줄어드는 방향만, 뺄 때 근거 주석).

- [ ] **Step 1: AST 가드 spec 을 쓴다** — 모양은 `shipment/shipment-writes.guard.spec.ts`(TypeScript compiler API). `WAREHOUSE_FLOW_ENTRIES` = Task 2 표의 «좁힘» 함수 전부 + 이 Task 의 목록(`file` 은 `apps/core/src/modules/` 기준 경로). 케이스:
  - `목록의 함수가 모두 존재한다` — 파일에서 그 이름의 함수 선언·메서드 선언을 못 찾으면 빨강(이름 바꾸기가 가드를 조용히 끄지 못하게)
  - `목록의 함수가 모두 warehouseIdOf 를 직접 부른다` — 본문에 callee 가 식별자 `warehouseIdOf` 인 CallExpression 이 있어야 한다
  - `패턴이 살아 있다` — 문자열 소스 `function f(s){ return warehouseIdOf(s); }` 는 통과, `function f(s){ return s.warehouseId; }` 는 빨강
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/fulfillment/shipment/supplier-shipment-entry.guard.spec.ts` → FAIL, 이 Task 의 목록 함수들이 «부르지 않음»으로 나온다
- [ ] **Step 3: 통합 spec 을 쓴다** — 입점사 draft 상자(라인 1, qty 1)와 같은 SKU 의 재고를 심는다. `wireLogistics`(`services/__support__/logistics-wiring.ts`)의 `Wired` 를 쓴다:
  - `예약은 입점사 상자 라인을 거부한다` — `shipmentReservations.reservePartial(lineId, 1, tx)` → `rejects.toBeInstanceOf(SupplierShipmentInWarehouseFlowError)`, 그 라인의 `reserved_qty` 는 0 그대로
  - `예약 재시도 워커는 입점사 상자 라인을 고르지 않는다` — `retryWorker.findCandidates(100, tx)` 에 그 라인 id 가 없다
  - `원장 역분개는 입점사 시도를 거부한다` — `kind: 'supplier'`·`dispatched` 시도를 심고 `command.reverseShipmentDispatch(...)` → `SupplierShipmentInWarehouseFlowError`
  - `배송 추적 폴러는 입점사 상자를 고르지 않는다` — 입점사 상자 `shipped` + `kind: 'supplier'` 시도 `dispatched` + 수기 송장 `HANJIN`·`used`, 같은 모양의 창고 상자도 하나. `new CarrierTrackingPoller(dbServiceStub, …)` 의 `findTargets(['HANJIN'], since, tx)` 결과에 창고 상자만 있다(생성자 나머지 인자는 `findTargets` 가 안 쓰므로 `{} as never` 가 아니라 기존 poller spec 의 스텁을 따른다)
- [ ] **Step 4: 진입점에 좁힘을 넣고 폴러를 거른다** (Files 대로)
- [ ] **Step 5: 통과 확인** — 가드 spec + 통합 spec → PASS. 회귀: `npx jest apps/core/src/modules/fulfillment` + fulfillment 통합 전체 기준선 비교 → 새 실패 0
- [ ] **Step 6: Commit** — `git commit -m "K3 PR2 — 창고 흐름 진입점은 입점사 상자를 거부한다(가드)"`

### Task 4: `carrier` 값 추가, 창고 경로는 계약 6개로 묶기

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:87` — N5 의 8개를 끝에 더한다
- Create: `apps/core/drizzle/<ts>_add-supplier-carriers.sql` + meta (생성; `ALTER TYPE … ADD VALUE` 8줄. 첫 줄 `SET LOCAL lock_timeout`)
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.interface.ts` — 아래 export
- Modify: `apps/core/src/modules/fulfillment/waybill/dto/waybill.dto.ts:10,19,48` — `@IsIn(EVENT_CONTRACT_CARRIERS)`, 타입 `EventContractCarrier`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts` `emitDispatchEvents`(:1191, :1215) — `isEventContractCarrier(waybill.carrier)` 가 아니면 `Error`(DTO 가 막으므로 도달 불가)
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/event-contract-carriers.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/dto/waybill.dto.spec.ts`(없으면 Create)

**Interfaces:**
- Produces:
  - `export const EVENT_CONTRACT_CARRIERS = ['CJ', 'HANJIN', 'LOTTE', 'LOGEN', 'KDEXP', 'CJGLS'] as const` — 주석: «이벤트 계약(`shipments.stream.ts`·`fulfillments.stream.ts`)이 받는 택배사. 소비자가 모르는 값이면 throw 하므로 창고 경로는 이것만 낸다. K3 PR 3 이 계약을 넓히면 지운다»
  - `export type EventContractCarrier = (typeof EVENT_CONTRACT_CARRIERS)[number]`
  - `export function isEventContractCarrier(c: CarrierCode): c is EventContractCarrier`

- [ ] **Step 1: spec 을 쓴다**
  - `event-contract-carriers.spec.ts`: 타입 단언 `Equal<EventContractCarrier, ShipmentCarrier>`·`Equal<EventContractCarrier, Carrier>`(`packages/event-contracts/streams/*` 에서 import, `type-check` 가 판정); 런타임 `EVENT_CONTRACT_CARRIERS` 가 `carrierEnum.enumValues` 의 부분집합; `carrierEnum.enumValues` 가 N5 의 8개를 모두 포함; `isEventContractCarrier('EPOST') === false`, `('HANJIN') === true`
  - DTO spec: `class-validator` `validate(plainToInstance(RegisterManualWaybillDto, { expectedManifestVersion: 1, carrier: 'EPOST', trackingNo: '1' }))` → `carrier` 에러 1개; `'HANJIN'` → 에러 0. `IssueWaybillDto` 도 `EPOST` 거절
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/fulfillment/waybill` → FAIL
- [ ] **Step 3: enum·마이그·코드** — `npm run db:generate:core -- --name add-supplier-carriers`, 스크래치 BEGIN/ROLLBACK 로 먼저 돌리고 `k6_it` 에 migrate, 위 Files 대로 고친다
- [ ] **Step 4: 통과 확인** — `npm run type-check && npx jest apps/core/src/modules/fulfillment/waybill` → 에러 0, PASS
- [ ] **Step 5: Commit** — `git commit -m "K3 PR2 — 입점사가 쓰는 택배사 8개, 창고 경로는 이벤트 계약의 6개만"`

### Task 5: 직배 SKU 는 입점사 하나 (SKU·공급사 규칙)

**Files:**
- Create: `apps/core/src/modules/inventory/sku-catalog/sku-direct-supplier.rule.ts`, `sku-direct-supplier.rule.spec.ts`
- Modify: `apps/core/src/modules/inventory/sku-catalog/sku-catalog.errors.ts` — `SkuDirectSupplierRequiredError`(`SKU_DIRECT_SUPPLIER_REQUIRED`, 400), `SkuSupplierNotFoundError`(`SKU_SUPPLIER_NOT_FOUND`, 400)
- Modify: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.ts` `create`(:23)·`update`(:75) — `assertDirectSupplier` private 추가, `supplierIds` 중복 제거
- Create: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.direct-supplier.integration.spec.ts` — 하네스는 같은 폴더 `…delivery-profile.integration.spec.ts` 의 `build`
- Modify: `…delivery-profile.integration.spec.ts:85` `drop_shipped 는 프로필 없이 만들어진다` — 직배 공급사 하나를 주도록
- Create: `apps/core/src/modules/inventory/suppliers/suppliers.errors.ts` — `SupplierHasDropShippedSkusError`(`SUPPLIER_HAS_DROP_SHIPPED_SKUS`, 409), `SupplierHasShipmentsError`(`SUPPLIER_HAS_SHIPMENTS`, 409)
- Modify: `apps/core/src/modules/inventory/suppliers/services/suppliers.service.ts` `updateSupplier`(:75)·`deleteSupplier`(:139)
- Modify: `apps/core/src/modules/inventory/suppliers/services/suppliers.service.integration.spec.ts`

**Interfaces:**
- Produces:
  - `export interface SkuSupplierState { stockType: SkuStockType; directSupplierIds: readonly string[] }` (정렬·중복 없음)
  - `export function directSupplierViolation(before: SkuSupplierState | null, after: SkuSupplierState): 'SKU_DIRECT_SUPPLIER_REQUIRED' | null` — before 가 있고 `stockType`·`directSupplierIds` 가 같으면 `null`; 아니면 `after.stockType === 'drop_shipped' && after.directSupplierIds.length !== 1` 일 때 위반. 주석은 `deliveryProfileViolation` 의 «값이 바뀔 때만» 이유를 가리킨다.

**잠금 규칙:** SKU 쪽은 `supplierIds` 의 공급사 행을 `FOR SHARE` 로 읽어 `is_direct_delivery` 를 본다. 공급사 쪽은 판정 전에 자기 행을 `FOR UPDATE` 로 먼저 잡는다(지금 `updateSupplier` 의 첫 SELECT 에 `.for('update')`). 그래서 «SKU 가 직배 공급사에 묶이는 중에 공급사가 직배 아님으로 바뀌는» 경합에서 뒤에 오는 쪽이 앞의 커밋을 본다.

- [ ] **Step 1: 순수 규칙 spec** — 생성(before=null): `drop_shipped`+`[]`·`['a','b']` 위반, `['a']` 통과, `physical`+`[]` 통과. 수정: before=after(`drop_shipped`,`[]`) → `null`(옛 SKU); `physical→drop_shipped`+`[]` 위반; `drop_shipped`+`['a']→['b']` 통과; `['a']→[]` 위반
- [ ] **Step 2: 매니저 통합 spec** (`describeIfDb`)
  - `직배 SKU 를 직배 공급사 없이 만들면 SKU_DIRECT_SUPPLIER_REQUIRED`
  - `직배 아닌 공급사만 주면 거부, 직배 하나 + 직배 아닌 것 하나는 통과`
  - `직배 공급사 둘이면 거부`
  - `모르는 공급사 id 는 400 SKU_SUPPLIER_NOT_FOUND`
  - `같은 공급사 id 두 번은 한 번으로 친다` — `[a, a]` 로 만들면 연결 1행
  - `옛 직배 SKU(연결 없음)의 이름만 바꾸면 통과` — `stockType: 'drop_shipped'` 를 같이 보내도
  - `physical → drop_shipped 전환은 직배 공급사가 있어야 한다` — `supplierIds` 를 안 보내면 기존 연결로 판정
  - `supplierIds: [] 로 직배 연결을 지우면 거부`
- [ ] **Step 3: 공급사 통합 spec 에 더한다**
  - `직배 SKU 가 묶인 공급사를 직배 아님으로 바꾸면 409 SUPPLIER_HAS_DROP_SHIPPED_SKUS`, 묶인 SKU 가 `physical` 이면 통과
  - `직배 SKU 가 묶인 공급사 삭제는 409 SUPPLIER_HAS_DROP_SHIPPED_SKUS` (연결 행이 그대로 남아 있음도 단언)
  - `입점사 상자가 있는 공급사 삭제는 409 SUPPLIER_HAS_SHIPMENTS` — Task 2 의 `seedBox({ supplierId })`. 판정은 입점사 상자·넘김 묶음·`supplier_id` 알릴 취소 중 하나라도 있으면(셋 다 FK 라 없으면 500)
  - 지운 SKU(`is_deleted`)의 연결은 세지 않는다
- [ ] **Step 4: 실패 확인** — 세 spec 을 돌려 FAIL
- [ ] **Step 5: 구현** (Files 대로). 직배 공급사 집합은 `sku_suppliers ⋈ suppliers WHERE is_direct_delivery` 로 읽는다.
- [ ] **Step 6: 통과·회귀** — 세 spec + `apps/core/src/modules/inventory` 유닛·통합(기준선 비교) → 새 실패 0. `drop_shipped` SKU 를 공급사 없이 `manager.create` 하는 다른 spec 이 빨개지면 그 spec 에 직배 공급사를 준다(규칙을 완화하지 않는다).
- [ ] **Step 7: Commit** — `git commit -m "K3 PR2 — 직배 SKU 는 직배 공급사 하나에 묶인다(SKU·공급사 양쪽)"`

### Task 6: ADR·감사 문서·게이트

**Files:**
- Create: `docs/adr/0050-drop-ship-is-a-supplier-shipment.md` — 결정: 직배 = 입점사가 보내는 상자, 판별자는 `shipments.supplier_id`(CHECK 로 창고/입점사 정확히 하나), FO 단위 `drop_ship` 모드를 새로 쓰지 않음, 넘김은 상태가 아니라 기록(N1), 창고 흐름은 `warehouseIdOf` 로 좁힌 곳만 들어온다(가드 spec 이 정본), 이벤트 계약 넓히기는 소비자 먼저(PR 3). ADR-0027 의 «직배 예외»를 대체한다고 적는다. ADR-0049 의 알릴 취소 문장은 PR 6 이 고친다고 적는다(지금은 안 고친다 — 동작이 아직 그대로다).
- Modify: `docs/order-logistics-architecture-audit-2026-10.md` §8.1 K3 — 한 줄: 입점사 상자 스키마와 창고 흐름 가드가 생겼다(PR 2), 정본은 ADR-0050 과 `supplier-shipment-entry.guard.spec.ts`.

- [ ] **Step 1: 문서 둘을 쓴다**
- [ ] **Step 2: 검증 게이트** — `npm run type-check && npx jest` → 에러 0, 실패 0. 통합 `k6_it` 기준선 외 실패 0.
- [ ] **Step 3: Commit** — `git commit -m "K3 PR2 — ADR-0050 직배는 입점사 상자"`
- [ ] **Step 4: PR** — 본문에 Task 0 실측값, 마이그 두 개와 순서(`migrate → deploy`), N1~N10, Task 2 표 밖에서 처리한 tsc 에러(있으면). 머지·배포는 사용자가 정한다.

---

## 다음 PR 에 넘기는 것

- **PR 4(읽는 쪽):** 상자를 창고로 거르지 않고 읽는 조회가 입점사 상자를 «예약 부족»·«추적 중»으로 오판할 수 있다 — `order-progress.judge-sql.ts`, `reserve-shortage.reader.ts`, `shipment-reservation-totals.sql.ts`, `order-reconcile/rules/*`(상자 규칙), `sales-orders.service.ts`·`store-sales-orders.service.ts`·`channel-order-change.reader.ts`·`channel-cancel-request.manager.ts`. `line-composition-edit.*` 의 `fulfillment_mode === 'drop_ship'` 판별은 새 FO 에서 안 걸린다(§4.1) — 상자 기준으로.
- **PR 5(발송 명령):** `WAREHOUSE_FLOW_ENTRIES` 에서 `restoreForRecall`·역분개 쪽은 입점사 갈래가 그 앞에서 갈라지므로 목록에 남는다. `shipment-writes.guard.spec.ts` 의 허용 키에 `supplierHandoffId`·라인 `unfulfillable*` 를 연다. 분할된 상자가 원래 상자의 `supplier_handoff_id` 를 물려받는지 정한다. 상자 상세·분할 화면(`getShipmentDetail`)의 예약 몫이 입점사 상자 라인을 «미예약»으로 보이지 않게 한다(§4.8 «상자 분할 화면의 예약 몫» — 이 PR 은 타입만 넓혔다).
- **PR 3:** `EVENT_CONTRACT_CARRIERS` 를 지우고 계약 zod 에 N5 의 8개를 더한다(소비자 먼저).
