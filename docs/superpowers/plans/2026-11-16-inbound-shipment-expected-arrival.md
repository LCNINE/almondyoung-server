# 선적 ④ — 입고예정 원천 (#1240) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부에서 오는 중국 선적의 «오는 중» 물량을 스토어프론트 입고예정일·보충 제안·물류 앱 «입고 예정» 목록의 원천으로 더하고, 셀메이트 시기 입고예정 원천(CSV 발주 라인·옛 스크립트)을 닫는다.

**Architecture:** «오는 중» 공식은 선적 모듈의 Nest 밖 순수 SQL 조각 한 곳(`inbound-shipment-outstanding.sql.ts`)에만 둔다 — 발주의 `purchase-order-outstanding.sql.ts` 와 같은 꼴이라 판매가능수량↔선적 모듈 순환이 없다. 세 소비자는 지금 발주를 읽는 자리 옆에서 그 조각으로 선적을 읽어 합친다(설계 §4 접근 1). 선적 동작마다 같은 트랜잭션 끝에서 영향받은 SKU 로 판매가능수량을 재발행한다.

**Tech Stack:** NestJS · Drizzle(postgres.js) · Jest(`describeIfDb` 통합) · Next.js admin-web · Tauri warehouse-app(React + vitest)

**Spec:** `docs/superpowers/specs/2026-11-16-inbound-shipment-expected-arrival-design.md` (모델: `2026-11-16-inbound-shipment-boxes-design.md` §8.6, ③: `2026-11-16-inbound-shipment-station-box-receiving-design.md`)

## Global Constraints

- «오는 중» = `kind = 'sku'` 이고 선적이 `expected`·`receiving` 인 줄의 `max(expected_qty − 유효 집계 합, 0)`, 줄이 덮는 `disposition = 'stock'` 상자 중 `status = 'open'` 이 하나라도 있는 줄만. 유효 집계 = `inbound_shipment_box_counts` 중 `canceled_at IS NULL` 이고 `line_id` 가 그 줄. **외부 선적만**(지금은 전부 외부 — 주석·스펙 이름에 «외부 선적»을 박는다).
- 늦은 선적·예정일 없는 선적도 **수량**에는 든다. 날짜는 스토어프론트 후보에만 쓴다.
- 스토어프론트 선적 후보: `approximate: true`, `expected_arrival IS NOT NULL AND >= 오늘(KST)`, 도착 창고가 `inSellableWarehouse`.
- 규칙 순서는 그대로: 수동 재입고일 → 오늘 이후 가장 이른 날짜 → 그 날짜 후보 중 하나라도 «경»이면 «경».
- 이벤트 계약(`packages/event-contracts/streams/inventory.stream.ts`)은 바꾸지 않는다.
- `GET /inventory/expected-arrivals` 는 `include=inbound_shipment` 가 없으면 지금과 **바이트 단위로 같은** 응답.
- 마이그는 추가형 하나(`inbound_shipments.promised_arrival date null` + 확정된 선적 채우기) — expand: migrate → deploy.
- 사용자 화면 문구: 빈 목록 «입고 예정이 없어요.», 지난 예정일 «예정일 지남», 처음 예정일 «처음 예정 ○/○», 보충 제안 서랍 «선적 오는 중», 핸드헬드 선적 줄 «스테이션 작업».
- 🔒 공개 레포 — 테넌트 값·업체명·사람 이름을 픽스처·커밋에 쓰지 않는다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0. E2E 스택이 떠 있으면 전체 jest·type-check 를 돌리지 않는다(메모리).
- 통합 스펙은 `describeIfDb`. 스펙 안에서 `dotenv.config()` 금지. DB 를 쓰는 통합 스펙은 `dotenv -e apps/core/.env -- npx jest <path> --runInBand`.

## Review Focus

1. **줄의 마지막 상자를 0개로 확정** — 그 SKU 는 원장에 안 들어가지만 «오는 중»에서 빠지므로 입고예정일이 사라져야 한다. → Task 3 의 `receiveBox` 테스트.
2. **사람이 닫은 선적에서 상자 확정 취소** — 선적이 `receiving` 으로 다시 열리며 다른 열린 상자의 줄도 «오는 중»으로 돌아온다. 재발행 범위는 선적 전체. → Task 3 의 `cancelBoxReceipt` 테스트.
3. **범위 줄(L5~L9 합계 하나)의 일부 상자만 확정** — 잔량은 줄 단위로 `expected − 지금까지 센 합`, 상자 수로 나누지 않는다. → Task 1 통합 스펙.
4. **선적 날짜와 발주 날짜가 같은 날** — «경»이 하나라도 있으면 «경», `inboundSource` 는 고정 순서(발주 먼저)로 정해져 실행마다 흔들리지 않는다. → Task 2 유닛.
5. **옛 물류 앱·admin-web** — `include` 없이 부르면 선적이 안 섞인다. 새 앱의 발주 상세 화면(`PurchaseOrderReceiveScreen`)은 같은 캐시에서 `source === 'purchase_order'` 만 고른다. → Task 6·7 테스트.

---

## File Structure

| 파일 | 역할 | Task |
|---|---|---|
| Create `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-outstanding.sql.ts` | «오는 중» SQL 조각 (유일한 공식) | 1 |
| Create `…/inbound-shipment/services/inbound-shipment-outstanding.integration.spec.ts` | 공식·파리티 | 1 |
| Modify `…/product-sellable-quantity/services/product-restock.ts` (+ `.spec.ts`), `product-sellable-quantity.service.ts`, `product-sellable-quantity.calculator.ts`, `apps/core/src/modules/product-matching/dto/variant-matching-batch.dto.ts`, `apps/admin-web/src/lib/types/dto/matching.ts`, `…/use-product-variants-table-columns.tsx` | 스토어프론트 후보 | 2 |
| Create `…/inbound-shipment/services/inbound-shipment-affected-skus.ts`; Modify `inbound-shipment-draft.manager.ts`, `inbound-shipment-receiving.manager.ts` (+ 두 통합 스펙) | 재발행 트리거 | 3 |
| Modify `apps/core/src/modules/inventory/schema/inventory.schema.ts`, new `apps/core/drizzle/<ts>_add-inbound-shipment-promised-arrival.sql` + meta, `inbound-shipment-draft.manager.ts`, `inbound-shipment-view.dto.ts`, `inbound-shipment.reader.ts` | 처음 약속일 | 4 |
| Create `apps/admin-web/src/features/inventory/inbound-shipments/arrival-overdue.ts` (+ `.spec.ts`); Modify `shipment-list/index.tsx`, `shipment-detail/index.tsx`, admin-web 선적 DTO 타입 | «예정일 지남»·«처음 예정» | 5 |
| Modify `…/stock-projection/controllers/stock-projection.controller.ts`, `services/expected-arrivals.reader.ts`, `services/stock-projection.service.ts`, `dto/expected-arrivals.dto.ts` | `include=inbound_shipment` | 6 |
| Modify `native/warehouse-app/src/domains/inbound/{types.ts,queries.ts,ExpectedArrivalListScreen.tsx,PurchaseOrderReceiveScreen.tsx}` (+ tests) | 앱 목록 | 7 |
| Modify `…/stock-projection/services/inbound-pipeline.reader.ts`, `replenishment/suggestion/{suggestion.types.ts,suggestion.assembler.ts,replenishment-suggestion.reader.ts}`, `replenishment/dto/replenishment-suggestion.dto.ts`, admin-web `lib/types/dto/inventory.ts`, `features/inventory/replenishment/components/sku-drawer/index.tsx` | 보충 제안 | 8 |
| Modify `scripts/ops/cutover-preflight/checks/inbound.ts` | 판정 항목 | 9 |
| Create `scripts/ops/close-sellmate-csv-inbound.ts`; Delete `scripts/sellmate/load-inbound-from-csv.ts`, `apps/channel-adapter/scripts/sync-restock-to-medusa.ts`; Modify `scripts/sellmate/inbound-run.sh`, `docs/runbooks/selmate-stock-pipeline.md`, `docs/adr/0028-coming-soon-is-stock-gated.md`, `procurement/services/purchase-order-outstanding.sql.ts`, `expected-arrivals-parity.integration.spec.ts` | 옛 원천 닫기 | 10 |

---

### Task 1: «오는 중» SQL 조각

**Files:**
- Create: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-outstanding.sql.ts`
- Test: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-outstanding.integration.spec.ts`

**Interfaces:**
- Produces:
  - `outstandingShipmentLineWhere(): SQL` — 호출자가 `inbound_shipment_lines` 에 `inbound_shipments` 를 `innerJoin` 했다고 가정. `kind='sku'` · 선적 상태 · 열린 입고용 상자 EXISTS · 잔량 > 0 · (외부 선적 — 지금은 조건 없음, 주석으로 자리만).
  - `outstandingShipmentQtySql(): SQL<number>` — `GREATEST(expected_qty − COALESCE((유효 집계 합 상관 서브쿼리), 0), 0)`.
  - 둘 다 Nest 밖 순수 함수(모듈 순환 회피 — 설계 §5.2). 파일 머리 주석에 «외부 선적만, 1.5단계가 내부 선적을 만들면 여기서 뺀다(설계 §12)»와 파리티 스펙 이름을 적는다.

- [ ] **Step 1: 통합 스펙 작성** — 기존 `inbound-shipment-receiving.manager.integration.spec.ts` 의 `build`·`inRollbackTx`·업로드 픽스처 방식을 그대로 쓴다. 스펙 안의 질의는 `select({ lineId, skuId, qty: outstandingShipmentQtySql() }).from(lines).innerJoin(shipments).where(and(outstandingShipmentLineWhere(), eq(shipments.id, id)))`.

  테스트(각각 선적 하나를 만들어 확정한 뒤):
  - `counts full expected qty for a confirmed shipment with no receipts` — 줄 예정 10 → 10.
  - `range line partially received keeps line-level remainder` — `L5-L9` 줄 예정 1076, L5 만 센 300 → 776 (상자 수로 나누지 않음).
  - `drops a line when its last stock box is confirmed with zero` — 상자 하나 줄 예정 5, 0개 확정 → 줄 없음.
  - `excludes lines covering only forward boxes`.
  - `excludes draft, manually closed, canceled shipments`.
  - `canceled box receipt restores the remainder` — 확정 후 취소 → 원래 예정 수량.
  - `includes shipments with null expected_arrival and past expected_arrival`.
  - `matches detail view line remainders` — 같은 선적에서 `InboundShipmentReader.detail` 이 내는 줄별 (예정 − 실제) 합(열린 입고용 상자가 남은 줄만)과 이 조각의 합이 같다(파리티).

- [ ] **Step 2: 실패 확인** — `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-outstanding.integration.spec.ts --runInBand` → 모듈 없음으로 FAIL.
- [ ] **Step 3: 구현** — 위 두 함수.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(core): 선적 «오는 중» SQL 조각 — 외부 선적 (#1240)`

### Task 2: 스토어프론트 입고예정 후보에 선적을 더한다

**Files:**
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-restock.ts`, `product-restock.spec.ts`
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts:157-192`
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.ts:56`, `apps/core/src/modules/product-matching/dto/variant-matching-batch.dto.ts:153`, `apps/admin-web/src/lib/types/dto/matching.ts:286`, `apps/admin-web/src/features/**/use-product-variants-table-columns.tsx:446`

**Interfaces:**
- Consumes: Task 1 `outstandingShipmentLineWhere`, `outstandingShipmentQtySql`.
- Produces:
  - `export type RestockSource = 'manual' | 'purchase_order' | 'inbound_shipment'`
  - `export interface RestockArrival { expectedArrival: string; approximate: boolean; source: 'purchase_order' | 'inbound_shipment' }`
  - `resolveRestockSchedule(policy, arrivals: RestockArrival[], stockBoundQuantity: number, today: string): RestockSchedule` — `inboundSource: RestockSource | null`. 이긴 날짜의 후보가 여럿이면 `purchase_order` 먼저(고정 순서).

- [ ] **Step 1: 유닛 테스트 추가** (`product-restock.spec.ts`):
  - `uses shipment date when it is the only arrival` → `{ inboundDate: '2026-12-01', inboundApproximate: true, inboundSource: 'inbound_shipment' }`
  - `earlier purchase order beats later shipment` (PO 11-25 domestic, 선적 12-01) → `'2026-11-25'`, `false`, `'purchase_order'`
  - `earlier shipment beats later purchase order`
  - `same day: approximate if any, source purchase_order first` (PO 12-01 domestic + 선적 12-01) → `true`, `'purchase_order'`
  - `past shipment date is ignored` (today 12-02, 선적 12-01) → 빈 결과
  - `manual restock date still wins over shipment`
  - 기존 테스트의 후보에 `source: 'purchase_order'` 를 더한다.
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/inventory/product-sellable-quantity/services/product-restock.spec.ts` → FAIL.
- [ ] **Step 3: `product-restock.ts` 구현** — 위 시그니처.
- [ ] **Step 4: 서비스 질의** — `getByVariantIds` 에서 발주 `arrivalRows` 다음에 선적 줄을 읽는다: `inbound_shipment_lines` ⋈ `inbound_shipments` ⋈ `product_variant_sku_links`(sku) ⋈ `product_matchings`, where `inArray(variantId, existingVariantIds)`, `outstandingShipmentLineWhere()`, `isNotNull(expectedArrival)`, `gte(expectedArrival, today)`, `inSellableWarehouse(shipments.warehouseId)`. 둘 다 `source` 를 실어 `arrivalsByVariant` 에 넣는다. 유니언 `inboundSource` 를 calculator·product-matching DTO·admin-web 타입에 넓히고, admin-web 열은 `'inbound_shipment'` 를 «선적»으로 표시한다.
- [ ] **Step 5: 통과 확인** — restock 스펙 PASS, `npx jest apps/core/src/modules/inventory/product-sellable-quantity --maxWorkers=2` PASS.
- [ ] **Step 6: 커밋** — `feat(core): 스토어프론트 입고예정 후보에 선적을 더한다 (#1240)`

### Task 3: 선적 동작마다 판매가능수량 재발행

**Files:**
- Create: `apps/core/src/modules/inventory/inbound-shipment/services/inbound-shipment-affected-skus.ts`
- Modify: `inbound-shipment-draft.manager.ts` (생성자에 `ProductSellableQuantityService`), `inbound-shipment-receiving.manager.ts:156-159, 251-253`
- Test: `inbound-shipment-draft.manager.integration.spec.ts`, `inbound-shipment-receiving.manager.integration.spec.ts` (기존 `recalculateAndPublishForSkus` jest.fn 자리; draft 스펙의 `new InboundShipmentDraftManager(dbService, matcher)` 에 세 번째 인자 추가)

**Interfaces:**
- Produces:
  - `shipmentSkuIds(trx: DbTx, shipmentId: string): Promise<string[]>` — 그 선적의 `kind='sku'` 줄 SKU (중복 제거).
  - `boxSkuIds(trx: DbTx, boxId: string): Promise<string[]>` — 그 상자를 덮는 `kind='sku'` 줄 SKU ∪ 그 상자의 리스트에 없던 물건 집계(`line_id IS NULL`) SKU — 취소된 집계 포함(취소 직후에도 부르므로).

| 메서드 | 조건 | 재발행 SKU |
|---|---|---|
| `confirm` | 항상 | `shipmentSkuIds` |
| `cancel` | 취소 전 상태가 `expected` 일 때만 | `shipmentSkuIds` |
| `updateHeader` | `patch.expectedArrival !== undefined` 이고 상태 `expected`·`receiving` | `shipmentSkuIds` |
| `editLine` | 상태 `expected`·`receiving` | 고치기 전 SKU ∪ 고친 뒤 SKU (null 제외) |
| `editBox` | `patch.disposition` 이 바뀌고 상태 `expected`·`receiving` | `boxSkuIds` (상태가 바뀌었으면 `shipmentSkuIds`) |
| `close`·`reopen` | 항상 | `shipmentSkuIds` |
| `receiveBox` | 항상 | `boxSkuIds` (지금의 `receivedSkuIds` 를 대체) |
| `cancelBoxReceipt` | 항상 | 취소 전 선적 상태가 `closed` 이고 `closedReason !== null` 이면 `shipmentSkuIds`, 아니면 `boxSkuIds` |

- [ ] **Step 1: 테스트 추가** — 각 행마다 «동작 뒤 `recalculateAndPublishForSkus` 가 기대 SKU 집합(`expect.arrayContaining` + 길이)과 같은 tx 로 불렸다». 꼭 넣을 것:
  - `receiveBox recalculates a sku counted zero on its last box` (Review Focus 1)
  - `cancelBoxReceipt on a manually closed shipment recalculates every sku line` (Review Focus 2)
  - `updateHeader on a draft does not recalculate`
  - `cancel of a draft does not recalculate`
- [ ] **Step 2: 실패 확인** — `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/inventory/inbound-shipment --runInBand` → 새 테스트 FAIL.
- [ ] **Step 3: 구현** — 표대로. 재발행은 각 트랜잭션의 마지막(응답 만들기 전). 빈 집합이면 부르지 않는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(core): 선적 동작마다 판매가능수량을 재발행한다 (#1240)`

### Task 4: 처음 약속한 도착 예정일

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`inboundShipments` 에 `promisedArrival: date('promised_arrival', { mode: 'string' })`)
- Create: `apps/core/drizzle/<ts>_add-inbound-shipment-promised-arrival.sql` + `drizzle/meta/` 갱신
- Modify: `inbound-shipment-draft.manager.ts` (`confirm`, `updateHeader`), `dto/inbound-shipment-view.dto.ts`, `services/inbound-shipment.reader.ts` (`list`·`detail` 에 `promisedArrival`)
- Test: `inbound-shipment-draft.manager.integration.spec.ts`

**Interfaces:**
- Produces: `InboundShipmentSummaryDto.promisedArrival: string | null`, 상세 헤더도 같은 필드.

- [ ] **Step 1: 테스트** — `confirm copies expected_arrival into promised_arrival`; `first PATCH after a null-date confirm sets promised_arrival`; `later PATCH changes expected_arrival but not promised_arrival`; `draft PATCH does not set promised_arrival`.
- [ ] **Step 2: 실패 확인** (Task 3 과 같은 명령).
- [ ] **Step 3: 스키마 + 마이그** — `npm run db:generate:core -- --name add-inbound-shipment-promised-arrival`. 생성된 SQL 끝에(아직 어디에도 적용 전이므로) `--> statement-breakpoint` 뒤 `UPDATE "inbound_shipments" SET "promised_arrival" = "expected_arrival" WHERE "confirmed_at" IS NOT NULL AND "promised_arrival" IS NULL;` 를 붙인다. 로컬 적용: `npm run db:setup -- --stage dev --deployment lcnine-services` (core DB 가 깨져 있으면 스크래치 DB — 메모리).
- [ ] **Step 4: 구현** — `confirm` 의 UPDATE 에 `promisedArrival: shipment.expectedArrival`; `updateHeader` 는 상태 `expected`·`receiving` 이고 현재 `promisedArrival === null` 이고 새 값이 non-null 이면 같이 채운다.
- [ ] **Step 5: 통과 확인** + `npm run type-check`.
- [ ] **Step 6: 커밋** — schema·SQL·meta·코드 한 커밋. `feat(core): 선적의 처음 약속한 도착 예정일을 남긴다 (#1240)`

### Task 5: admin-web «예정일 지남»·«처음 예정»

**Files:**
- Create: `apps/admin-web/src/features/inventory/inbound-shipments/arrival-overdue.ts`, `arrival-overdue.spec.ts`
- Modify: `…/inbound-shipments/components/shipment-list/index.tsx`, `…/shipment-detail/index.tsx`, admin-web 선적 DTO 타입(요약·상세에 `promisedArrival`)

**Interfaces:**
- Consumes: Task 4 `promisedArrival`.
- Produces: `isArrivalOverdue(status: ShipmentStatus, expectedArrival: string | null, today: string): boolean` — `expected`·`receiving` 이고 `expectedArrival !== null && expectedArrival < today`. `showPromisedArrival(expectedArrival, promisedArrival): boolean` — 둘 다 있고 다를 때만.

- [ ] **Step 1: 스펙** — overdue: `receiving` + 어제 → true; 오늘 → false; null → false; `closed` + 어제 → false. promised: 같음 → false; 다름 → true; promised null → false.
- [ ] **Step 2: 실패 확인** — `npm run test:admin-web -- arrival-overdue` → FAIL.
- [ ] **Step 3: 구현** + 목록 줄·상세 머리에 «예정일 지남» 배지, 상세 예정일 옆 «처음 예정 M/D». 오늘은 `apps/admin-web/src/lib/utils/date.ts` 의 KST yyyy-MM-dd 헬퍼.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `(cd apps/admin-web && npx tsc --noEmit)` (CI 가 admin-web tsc 를 안 돈다 — 메모리).
- [ ] **Step 5: 커밋** — `feat(admin-web): 선적 «예정일 지남»·«처음 예정» (#1240)`

### Task 6: `GET /inventory/expected-arrivals?include=inbound_shipment`

**Files:**
- Modify: `apps/core/src/modules/inventory/stock-projection/controllers/stock-projection.controller.ts:149-160`, `services/stock-projection.service.ts:61-63`, `services/expected-arrivals.reader.ts`, `dto/expected-arrivals.dto.ts`
- Test: `apps/core/src/modules/inventory/stock-projection/services/expected-arrivals.reader.integration.spec.ts` (새로; `describeIfDb`)

**Interfaces:**
- Consumes: Task 1 조각.
- Produces:
  - 쿼리 `include` — 쉼표 목록, 지금 아는 값은 `inbound_shipment` 하나. 모르는 값은 400.
  - `ExpectedArrivalDto` 를 `PurchaseOrderExpectedArrivalDto`(지금 모양 그대로, `source: 'purchase_order'`) | `InboundShipmentExpectedArrivalDto { source: 'inbound_shipment'; documentId; name; expectedDate: string | null; totalOutstandingQuantity; receivedBoxes; stockBoxes }` 유니언으로. Swagger 는 `oneOf`/discriminator(`@ApiExtraModels`) — `@ApiProperty({ type: 'object' })` 금지.
  - `listByWarehouse(warehouseId, opts: { includeShipments: boolean }, tx?)`.
- 선적 문서: 그 창고, `outstandingShipmentLineWhere()` 를 만족하는 줄이 있는 선적만, 합은 `outstandingShipmentQtySql()`. `stockBoxes` = `disposition='stock'` 상자 수, `receivedBoxes` = 그중 `received`. 정렬: 전체를 `expectedDate` 오름차순, null 뒤, 같으면 `documentId`. 머리 합계(`totalDocuments`, `totalOutstandingQuantity`)는 포함한 문서 전부.

- [ ] **Step 1: 테스트** — `without include returns only purchase orders (unchanged shape)`(선적이 있어도); `include=inbound_shipment adds open shipments with outstanding`; `fully received shipment is not listed`; `other warehouse shipment is not listed`; `unknown include value is 400`(컨트롤러 유닛).
- [ ] **Step 2: 실패 확인** — `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/inventory/stock-projection --runInBand`.
- [ ] **Step 3: 구현**.
- [ ] **Step 4: 통과 확인** + `npm run type-check`.
- [ ] **Step 5: 커밋** — `feat(core): 입고 예정 목록에 선적을 opt-in 으로 (#1240)`

### Task 7: 물류 앱 «입고 예정» 목록

**Files:**
- Modify: `native/warehouse-app/src/domains/inbound/types.ts`, `queries.ts`, `ExpectedArrivalListScreen.tsx`, `PurchaseOrderReceiveScreen.tsx`
- Test: `ExpectedArrivalListScreen.test.tsx`, `PurchaseOrderReceiveScreen` 기존 테스트

**Interfaces:**
- Consumes: Task 6 응답 유니언.
- Produces: `ExpectedArrival = PurchaseOrderArrival | InboundShipmentArrival` (core DTO 와 같은 필드).

- [ ] **Step 1: 테스트** — `requests include=inbound_shipment`; `renders a shipment row with name, date, boxes and remaining`; `shipment row links to /inbound/boxes on station`; `shipment row is not a link on handheld and shows 스테이션 작업`; `past date shows 예정일 지남`; `empty list says 입고 예정이 없어요.`(간편입고 안내 문구 없음); `PurchaseOrderReceiveScreen ignores shipment documents with the same cache`.
- [ ] **Step 2: 실패 확인** — `(cd native/warehouse-app && npx vitest run src/domains/inbound)`.
- [ ] **Step 3: 구현** — 쿼리에 `include: 'inbound_shipment'`; 목록은 `source` 로 갈라 그린다(발주 줄은 지금 그대로); 스테이션 판정은 `isStationDevice()`; 지난 날짜 판정은 기기 로컬 날짜 문자열 비교.
- [ ] **Step 4: 통과 확인** — `(cd native/warehouse-app && npx tsc -b && npx vitest run)`.
- [ ] **Step 5: 커밋** — `feat(warehouse-app): 입고 예정 목록에 선적 (#1240)`

### Task 8: 보충 제안이 «선적 오는 중»을 센다

**Files:**
- Modify: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.reader.ts`, `stock-projection/dto/inbound-pipeline.dto.ts`
- Modify: `apps/core/src/modules/inventory/replenishment/suggestion/{suggestion.types.ts,suggestion.assembler.ts,replenishment-suggestion.reader.ts:232-240}`, `replenishment/dto/replenishment-suggestion.dto.ts`
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:1440-1455`, `apps/admin-web/src/features/inventory/replenishment/components/sku-drawer/index.tsx:53-62`, `suggestion-model.spec.ts` 픽스처
- Test: `suggestion.assembler.spec.ts`, `replenishment-suggestion.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 조각.
- Produces:
  - `InboundPipelineRow` 에 `inboundShipmentQty: number`, `inboundShipmentToSellableQty: number`, `inboundShipmentEta: string | null`(판매 창고행 중 가장 이른 `expected_arrival`).
  - `SkuStockInput` 에 `inboundShipmentTotal: number`, `inboundShipmentToSellable: number`.
  - `CompanyAxis.inboundShipment: number`, `SellableAxis.inboundShipment: number`.
  - `company.position = onHand + inTransfer + onOrder + inboundShipmentTotal − reserved`; `sellable.position = onHandSellable − reservedSellable + inTransit + onOrderDirect + inboundShipmentToSellable`.

- [ ] **Step 1: 테스트** — 어셈블러: `shipment remainder lowers purchase suggestion`(오는 중 만큼 `qty` 감소); `shipment to sellable warehouse lowers transfer suggestion`; `shipment to non-sellable warehouse counts only on company axis`. 통합: `pipeline counts late shipments`(예정일 지남도 셈); `pipeline ignores manually closed shipments`.
- [ ] **Step 2: 실패 확인** — `npx jest apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.spec.ts` 및 통합은 `dotenv … --runInBand`.
- [ ] **Step 3: 구현** + admin-web 서랍에 «선적 오는 중» 두 줄(전사·판매 창고, `'inboundShipment' in axis`).
- [ ] **Step 4: 통과 확인** — core 스펙 + `npm run test:admin-web -- suggestion-model` + admin-web tsc.
- [ ] **Step 5: 커밋** — `feat(core·admin-web): 보충 제안이 선적 오는 중을 센다 (#1240)`

### Task 9: 컷오버 판정 스크립트 입고 항목

**Files:**
- Modify: `scripts/ops/cutover-preflight/checks/inbound.ts`

**Interfaces:**
- Consumes: 같은 공식 — 스크립트는 raw `postgres` SQL 이라 조각을 import 할 수 없다. 파일에 «식은 `inbound-shipment-outstanding.sql.ts` 와 같아야 한다» 주석.

- [ ] **Step 1: 항목 변경·추가** (`r.section` 꼴 그대로):
  - «입고 2» 안내 → `'#1240 배포 뒤 scripts/ops/close-sellmate-csv-inbound.ts 로 닫는다'`.
  - «입고 3» 주석·info → 선적 원천: 열린 선적 수, «오는 중» SKU 수.
  - 새 «입고 4. 비판매 창고 재고» — 비판매 창고 ON_HAND 합. 0 이면 ok, 아니면 fail(`'선적 잔량과 두 번 센다 — 설계 #1240 §11'`).
  - 새 «입고 5. 선적과 겹치는 실발주» — CSV 표지 밖 열린 발주 라인 중 «오는 중» 선적 줄과 SKU 가 겹치는 줄 수. 0 이면 ok, 아니면 fail.
  - 새 «입고 6. 예정일 지난 열린 선적» — `expected`·`receiving` 이고 `expected_arrival < current_date` 인 선적의 이름·예정일·받은 상자/입고용 상자. 컷오버 전엔 `r.dayOf`(«T 전 도착분이면 셀메이트로 받은 뒤 사유 ‘셀메이트로 받음’으로 닫는다»), 뒤엔 «예정일을 고치거나 닫는다» — 컷오버 전/후 구분은 이 스크립트의 기존 `--after-cutover` 방식대로.
- [ ] **Step 2: 확인** — `npx jest scripts/ops/cutover-preflight` PASS(기존 스펙), `npm run type-check`. 라이브 실행은 하지 않는다(터널은 사용자가).
- [ ] **Step 3: 커밋** — `feat(ops): 컷오버 판정에 선적 입고예정 항목 (#1240)`

### Task 10: 셀메이트 시기 입고예정 원천을 닫는다

**Files:**
- Create: `scripts/ops/close-sellmate-csv-inbound.ts`
- Delete: `scripts/sellmate/load-inbound-from-csv.ts`, `apps/channel-adapter/scripts/sync-restock-to-medusa.ts`
- Modify: `scripts/sellmate/inbound-run.sh`(`sync-restock` 단계 제거), `docs/runbooks/selmate-stock-pipeline.md`(①③ 입고예정 절 — «#1240 으로 폐지, 원천은 선적·발주»), `docs/adr/0028-coming-soon-is-stock-gated.md:94`, `apps/core/src/modules/inventory/procurement/services/purchase-order-outstanding.sql.ts:8` 주석, `expected-arrivals-parity.integration.spec.ts`(지운 스크립트를 가리키는 부분)

**Interfaces:**
- Consumes: `PurchaseOrderReceivingManager.shortCloseLine(poId, skuId, { reason }, userId, tx)` (이미 SKU 마다 재발행), `ProductSellableQuantityService.recalculateAndPublishForSkus`.
- 스크립트: `bash scripts/sellmate/run.sh <stage> …` 처럼 `DATABASE_URL` 주입(`scripts/sellmate/recalc-sellable.ts` 가 Nest 서비스를 손으로 만드는 선례). 기본 dry-run(대상 발주·라인·SKU 수와 열린 선적 SKU 수만 출력), `--apply` 로:
  1. `audit_notes LIKE 'sellmate-csv-inbound%'` 발주의 `closed_at IS NULL` 라인마다 `shortCloseLine`, `reason = 'sellmate-csv-inbound: closed by #1240'`, `userId = '00000000-0000-0000-0000-000000000000'`. 이미 닫혔거나 전량 입고된 라인의 409 는 건너뛰고 센다(멱등).
  2. 열린 선적(`expected`·`receiving`)의 `kind='sku'` 줄 SKU 로 `recalculateAndPublishForSkus`.

- [ ] **Step 1: 스크립트 작성** + 머리 주석(왜·언제 한 번·dry-run 먼저).
- [ ] **Step 2: 로컬 확인** — 로컬 core DB 에 CSV 표지 발주 1건(라인 2)과 확정 선적 1건을 만든 상태에서 dry-run → 아무것도 안 바뀜, `--apply` → 라인 2 닫힘·재발행, 다시 `--apply` → 0건.
- [ ] **Step 3: 옛 스크립트 삭제·문서 고치기** — `grep -rn "load-inbound-from-csv\|sync-restock" --include=*.ts --include=*.sh --include=*.md .` 결과가 이 계획·설계·런북의 «폐지» 문장만 남을 때까지.
- [ ] **Step 4: 게이트** — `npm run type-check`, `npx jest --maxWorkers=2` (E2E 스택이 꺼져 있을 때).
- [ ] **Step 5: 커밋** — `chore: 셀메이트 입고예정 원천을 닫는다 — CSV 라인 닫기 스크립트, 옛 스크립트 삭제 (#1240)`

---

## 이 계획 밖 (사람 손)

- 배포 순서: 마이그 → core → admin-web·warehouse-app. ③(#1343)과 같은 묶음이어도 된다. 배포 전 판정 스크립트 «입고 4·5»가 0.
- 배포 뒤 `close-sellmate-csv-inbound.ts` dry-run → `--apply`, 스토어프론트 눈 확인(설계 §13).
- 이슈 본문 교정(사용자 확인 뒤): #1240 «확인 필요» 체크 + 답, #1243 «셀메이트 CSV 가 만든 열린 발주 라인» → «#1240 이 닫는다», #1335 의 «CSV 거울 … #1243 이 닫는다» → «#1240».
- 1.5단계(중국 창고 편입) 브레인스토밍.
