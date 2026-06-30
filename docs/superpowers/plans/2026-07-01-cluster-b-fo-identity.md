# 출고→재고원장 Cluster B (FO 정체성) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출고주문(FO)을 "판매주문(SO)의 SKU 스냅샷, SO 0..1:0..1 FO" 정체성으로 못박는다 — 1:1 을 깨던 연산(FO-split·SO-merge·dead 중복출고경로)을 제거하고, FO↔상자 모델을 M:N 으로 열고, `fulfillment_orders(sales_order_id)` 부분 unique 로 SO:FO 1:1 을 DB 강제한다 (RFC §Phase 3 클러스터 B).

**Architecture:** B 는 **순수 제거 + 스키마 제약 변경 PR**이다 (새 흐름 없음 — `splitShipment`·합배송은 M:N 위에 런칭 때 additive). ① **제거**: `fulfillment_order_lines`(FOL, dead) drop · FO-split 체인(`split()`+`handleFulfillmentOrderSplit`+dead `handleFulfillmentOrderMerge`) · SO-merge(`merge()`+route+emit) · dead 중복출고경로(`shipFulfillmentOrder`/`completeFulfillmentOrder` + lifecycle `case 'completed'/'shipped'/'partially_shipped'`). ② **개방**: shipments 의 `uq_shipments_fo_active` 부분 unique drop (FO↔상자 M:N). `openedForFulfillmentOrderId` 는 Cluster A 가 이미 nullable 로 사전 스테이징 → 컬럼 alter 불필요. ③ **강제**: `fulfillment_orders(sales_order_id) WHERE sales_order_id IS NOT NULL` 부분 unique 추가.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), Jest (mock-db 단위 spec), `@app/db` `DbService.run`/`DbTx`.

**전제 (steer 확정 — RFC B6, 2026-07-01 게이트 점검으로 재확인):**
- 프로덕션 출고 트래픽 0 → expand-contract 세리머니 붕괴, **1 PR**. (live FO 10건은 06-30 QA 잔재 — 전부 `unfulfillable`·예약0·출고0.)
- **B 게이트 = 클린**: read-only 점검 결과 중복 `sales_order_id` 0건·SO-merge 흔적 0건·FO 전부 1:1·FOL 0행 → 부분 unique 위반 없이 추가 가능, 데이터 정리 불필요. (RFC 후속 추적 #5 해소.)
- **A → B 순서**: B 마이그레이션이 A 의 `openedForFulfillmentOrderId`/박스 status 를 참조. A 는 develop 머지·live 적용 완료.
- **B = 구조만, 흐름 미룸**: 합배송/`splitShipment` 흐름 구현은 B 밖. B 는 모델만 연다.

**확정 결정 (RFC §Phase 3 + 2026-07-01 surface 매핑):**
1. **`mergeGroups`/`mergeGroupId`/`isMerged` 는 보존** — 합배송(상자 레이어) 대체 도메인 인프라. SO-merge 제거는 `merge()` 가 `isMerged:true` 를 쓰는 것만 없앤다.
2. **`'ORDER_MERGED'` enum 값(`inventory.schema.ts:240`)은 스키마에 그대로 둔다** — Postgres 는 enum 값을 깨끗이 drop 못 함(enum 재생성 destructive). emit 만 제거(불활성 값으로 잔존, YAGNI).
3. **`openedForFulfillmentOrderId` 컬럼 변경 없음** — 이미 nullable (Cluster A `20260630125603` line 41). 동반 인덱스 `idx_shipments_opened_for_fo` 도 유지(M:N 조회 인덱스).
4. **`consumeShipment` 의 "박스=1 FO" 가정은 B 에서 안 건드린다** (known-gap, 아래 §Non-Goals). B 후 단일-FO 박스만 생성되므로 회귀 없음. M:N rework 는 합배송 흐름 런칭 시 additive.
5. **인접 dead 정리**: `handleFulfillmentOrderItemTransfer`(호출자 0)는 같은 파일 편집 김에 제거. `createFulfillmentOrder`(controller 가 `GoneException`)·`adjustReservationOnQuantityChange`(호출자 0 의심) 는 **선택적**(Task 6 §optional, 0-caller 재확인 후) — 핵심 경로 아님.

**환경 제약:**
- **dev 환경 삭제** → 통합테스트 실행 불가. GREEN 게이트 = **단위 spec(mock-db) 갱신 + `nest build core` 클린**. 부분 unique 의 실 강제는 단위테스트 불가(DB 제약) → **마이그레이션 live 적용 전 BEGIN…ROLLBACK 드라이런 + 적용 후 read-only 게이트 재점검**으로 실증(통합검증 빚 일관).
- jest 전체 스위트 OOM 금지 → `jest --testPathPattern=<좁힌 패턴>`. eslint OOM → 경로 한정 + `NODE_OPTIONS=--max-old-space-size=6144`.
- 마이그레이션 **생성**은 로컬 가능(`npm run db:generate:core`). **적용/드라이런은 사용자와 확인** (live 터널 필요 — 메모리 `project_live_db_readonly_access`).
- **destructive 마이그레이션 드라이런 필수** (메모리 `feedback_migration_dryrun_before_live`): 파일을 `--> statement-breakpoint` 로 split → 트랜잭션 안 문장별 실행 → 첫 실패+pg 에러 출력 → ROLLBACK.
- 답변은 한국어.

---

## 어휘 ↔ 코드 매핑 + RFC drift 교정 (구현자 필독)

RFC §Phase 3 의 심볼/줄 힌트가 Cluster A 머지로 drift 됨. **실제 surface (2026-07-01 매핑 확정):**

| RFC 표현 | 실제 코드 심볼·위치 | 상태 | 비고 |
|---|---|---|---|
| `uqFulfillmentOrder` (shipments) | `uqActivePerFo`=`uq_shipments_fo_active` `inventory.schema.ts:1473-1475` (`WHERE status<>'canceled'`) | drop 대상 | Cluster A EU7 이 full unique→부분 unique 로 개명. 동반 `idxOpenedForFo`(1477) 유지 |
| `openedForFO` nullable 化 | `opened_for_fulfillment_order_id` `:1463` | **이미 nullable** | 컬럼 alter 불필요(A 사전 스테이징) |
| SO:FO 부분 unique | `fulfillment_orders` `:1250` (2-arg pgTable, 제약 콜백 **없음**) | 신설 | `(t)=>({...})` 콜백 추가 |
| FO-split `split()` | `FulfillmentsService.split()` `fulfillments.service.ts:856-1099` | LIVE | controller `:id/split` + tests |
| `handleFulfillmentOrderSplit` | `reservation-lifecycle.service.ts:239-357` | LIVE (split() 전용) | |
| `handleFulfillmentOrderMerge` | `reservation-lifecycle.service.ts:362-394` | **DEAD** (호출자 0) | |
| SO-merge `sales-orders.service:721` | `SalesOrdersService.merge()` `sales-orders.service.ts:618-748` (FO 생성 719-733) | route-reachable, FO-생성 branch **런타임 dead**(`fulfillments` 미주입) | `POST /sales-orders/merge` |
| reservation `case 'completed'\|'shipped'` | `handleFulfillmentOrderStatusChange` `reservation-lifecycle.service.ts:37-40` (+ dead `case 'partially_shipped'` 42-45) | **DEAD** | **FO `fulfillmentStatusEnum` 분기** (reservation status 아님!) |
| `FulfillmentOrderTransactionService.ship/complete` | `shipFulfillmentOrder` `:233-260` / `completeFulfillmentOrder` `:202-231` | **DEAD** (호출자 0) | 정확한 메서드명은 `*FulfillmentOrder` |

**보존(절대 제거 금지):** `fulfillmentStatusEnum` 의 `'shipped'`/`'completed'` (consumeShipment·markDelivered·ship() 가 사용) · `releaseFulfillmentOrderReservations`·`consumeFulfillmentOrderReservations` (`'canceled'` + Cluster A consume seam 사용) · `mergeGroups`/`mergeGroupId`/`isMerged` (합배송 인프라) · `ReservationLifecycleService` 클래스·생성자(다른 live 메서드 보유).

---

## Non-Goals (B 밖 — 모델만 열고 흐름은 미룸)

- **`consumeShipment` M:N rework** (`outbound-consumption.service.ts:50-216`): 현재 박스의 단일 `openedForFulfillmentOrderId`(`:55`, null 이면 throw `:71-73`)에서 FO 를 도출해 그 FO 의 예약 전량 소진(`:136`)·FO `shipped` 세팅(`:145`)·단일 `FulfillmentShipped` emit(`:149`) — **박스=1 FO 가정.** B 가 unique 를 drop 해도 **단일-FO 박스만 생성**(openBoxByScan `shipment.service.ts:96` 이 단일 FO 세팅)되므로 회귀 없음. M:N(합배송) 박스가 생기는 흐름이 런칭될 때 `shipment_lines→FOI→fulfillmentOrderId` iterate 로 rework — **그 흐름과 함께 additive.** (RFC B 가드 #1.)
- **`store-sales-orders.service.ts:786-794,837-840`** 고객 추적뷰가 null-FO(합배송) 박스를 drop — 동일하게 합배송 흐름 소관.
- **admin-web 프론트 조율**: B 가 `POST /fulfillments/:id/split`·`POST /sales-orders/merge` 라우트를 제거 → admin-web `split-tab.tsx` 가 404 (merge 클라이언트는 애초에 호출자 0). 별도 프론트 작업 (RFC 후속 추적 #1).
- **직배(drop-ship) 추출**: 별도 워크스트림 (RFC). B 선결조건 아님.

---

## File Structure

**수정 파일:**
- `apps/core/src/modules/inventory/schema/inventory.schema.ts` — FOL 테이블/relations/types 제거, shipments `uqActivePerFo` 제거, `fulfillment_orders` 제약 콜백 신설(SO:FO 부분 unique), `case 'completed'/'shipped'/'partially_shipped'` 와 무관(스키마엔 enum 값 잔존).
- `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` — `split()`(856-1099) 제거, `'split'` admin action(1312) 제거, import 정리.
- `apps/core/src/modules/fulfillment/controllers/fulfillments.controller.ts` — `POST :id/split`(37-42)+import(8) 제거.
- `apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts` — `handleFulfillmentOrderSplit`(239-357)·`handleFulfillmentOrderMerge`(362-394)·`handleFulfillmentOrderItemTransfer`(399-458) 제거, `handleFulfillmentOrderStatusChange` 의 `case 'completed'/'shipped'/'partially_shipped'`(37-45) 제거.
- `apps/core/src/modules/sales-order/services/sales-orders.service.ts` — `merge()`(618-748)·`IFulfillmentsService` iface(144-150)·`@Optional()` ctor 주입(167) 제거.
- `apps/core/src/modules/sales-order/controllers/sales-orders.controller.ts` — `POST merge`(73-78)+import(8) 제거.
- `apps/core/src/modules/fulfillment/services/fulfillment-order-transaction.service.ts` — `shipFulfillmentOrder`(233-260)·`completeFulfillmentOrder`(202-231) 제거.
- spec: `fulfillments.service.spec.ts`, `fulfillment-reservations.facade.integration.spec.ts`.

**삭제 파일:**
- `apps/core/src/modules/fulfillment/dto/split-fulfillment-order.dto.ts`
- `apps/core/src/modules/sales-order/dto/merge-sales-orders.dto.ts`

**생성 파일:**
- `apps/core/drizzle/<timestamp>_cluster-b-fo-identity.sql` (+ `drizzle/meta/` 갱신) — drizzle-kit generate 산출.

---

## 작업 그룹 개요 (순서 = 의존)

- **A. 스키마 + 마이그레이션** (Task 1–2) — FOL drop · unique swap · SO:FO 부분 unique. FOL 은 dead 라 빌드 광범위 깨짐 **없음**(self-contained).
- **B. FO-split 제거** (Task 3) — controller→service→lifecycle→DTO→admin action + dead merge/transfer + spec.
- **C. SO-merge 제거** (Task 4) — controller→service `merge()`→DTO→emit.
- **D. dead 중복출고경로 제거** (Task 5–6) — transaction service dead 메서드 + lifecycle dead case + 선택적 인접 dead.
- **E. 검증** (Task 7) — `nest build core` 클린 + 좁힌 spec 스윕 + 마이그레이션 드라이런 + 문서/RFC 갱신.

모든 태스크는 **(M) 기계적 제거/리팩터** — test = `nest build core` 클린 + 영향 spec 갱신/GREEN. B 는 신규 동작이 없어 TDD 태스크 없음(부분 unique 강제는 DB 드라이런으로 실증). 각 태스크 끝에 커밋.

---

## Task 1 (M): 스키마 — FOL drop · shipments unique drop · FO SO:FO 부분 unique

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`

이 태스크는 스키마 구조만 바꾼다. FOL 은 dead(런타임 참조 0)라 편집 후 `nest build core` 가 **그대로 GREEN** 이어야 한다(깨지면 놓친 FOL 참조가 있다는 신호 → 조사). 커밋은 Task 2(마이그레이션 동반)에서.

- [ ] **Step 1: FOL 테이블 const 제거** — `inventory.schema.ts:1317-1332`

`export const fulfillmentOrderLines = pgTable('fulfillment_order_lines', {...});` 블록 전체(1317–1332) 삭제.

- [ ] **Step 2: FOL relations 제거** — `:2704-2713`

`export const fulfillmentOrderLinesRelations = relations(fulfillmentOrderLines, ...)` 블록 전체 삭제.

- [ ] **Step 3: FOL 을 가리키는 cross-relations 2곳 제거**

```ts
// :2390  skusRelations 안 — 이 줄 삭제
fulfillmentOrderLines: many(fulfillmentOrderLines),
// :2685  fulfillmentOrdersRelations 안 — 이 줄 삭제
lines: many(fulfillmentOrderLines),
```

- [ ] **Step 4: aggregate 등록 제거** — `wmsTables`(:2253)·`wmsRelations`(:3123)

```ts
// :2253  wmsTables 안 — fulfillmentOrderLines 항목 삭제
// :3123  wmsRelations 안 — fulfillmentOrderLinesRelations 항목 삭제
```

- [ ] **Step 5: FOL 타입 export 제거** — `:3298-3299`

```ts
// 두 줄 삭제
export type FulfillmentOrderLine = InferSelectModel<typeof fulfillmentOrderLines>;
export type NewFulfillmentOrderLine = InferInsertModel<typeof fulfillmentOrderLines>;
```

- [ ] **Step 6: shipments `uqActivePerFo` 부분 unique 제거** — `:1473-1475`

`shipments` pgTable 의 3번째 인자 콜백에서 아래 항목 삭제(동반 `idxOpenedForFo`(:1477)는 **유지**):

```ts
// 삭제
uqActivePerFo: uniqueIndex('uq_shipments_fo_active')
  .on(t.openedForFulfillmentOrderId)
  .where(sql`${t.status} <> 'canceled'`),
```

- [ ] **Step 7: `fulfillment_orders` 에 SO:FO 부분 unique 추가** — `:1250` pgTable 에 3번째 인자 콜백 신설

현재 `fulfillment_orders` 는 `pgTable('fulfillment_orders', { ... })` 2-arg 형(제약 콜백 없음). 닫는 `})` 를 `}, (t) => ({ ... }))` 로 바꿔 콜백 추가. 패턴은 같은 파일 `:1216-1218`(`uniq_sales_order_full_cancellation`)·`:2211`(`uq_invoices_shipment_active`) 와 동일. `uniqueIndex`·`sql` 는 이미 import 됨.

```ts
export const fulfillmentOrders = pgTable(
  'fulfillment_orders',
  {
    // ... 기존 컬럼 (변경 없음) ...
  },
  (t) => ({
    // SO:FO 0..1:0..1 강제. standalone/보상 FO(salesOrderId=null)는 'FO 쪽 0'으로 자연 제외.
    uqSalesOrder: uniqueIndex('uq_fulfillment_orders_sales_order')
      .on(t.salesOrderId)
      .where(sql`${t.salesOrderId} IS NOT NULL`),
  }),
);
```

- [ ] **Step 8: 빌드가 GREEN 인지 확인 (FOL 제거의 self-containment 검증)**

Run: `npx nest build core 2>&1 | tail -20`
Expected: `webpack ... compiled successfully` (exit 0). 만약 `fulfillmentOrderLines`/`FulfillmentOrderLine` 미해결 참조로 깨지면, 그 위치가 FOL agent 가 false-positive 로 분류한 DTO(`*FulfillmentOrderLineDto`)가 아닌 진짜 누락 참조다 — 찾아 제거.

(커밋 없음 — Task 2 에서 마이그레이션과 함께.)

---

## Task 2 (M): 마이그레이션 생성 · 검토 · 단일 커밋

**Files:**
- Create: `apps/core/drizzle/<timestamp>_cluster-b-fo-identity.sql`
- Modify: `apps/core/drizzle/meta/*`

- [ ] **Step 1: 마이그레이션 생성**

Run: `npm run db:generate:core -- --name cluster-b-fo-identity`
Expected: 새 `apps/core/drizzle/<ts>_cluster-b-fo-identity.sql` 생성. rename 없음(drop+add only)이라 인터랙티브 프롬프트 없어야 정상. 프롬프트가 뜨면(예기치 못한 rename 추정) 중단하고 스키마 재확인.

- [ ] **Step 2: 생성 SQL 검토 — 3개 DDL + ordering**

기대 문장(순서 무관하지만 ordering 버그 없어야):
```sql
DROP TABLE "fulfillment_order_lines" CASCADE;   -- (FK 2개 자동 제거)
DROP INDEX "uq_shipments_fo_active";
CREATE UNIQUE INDEX "uq_fulfillment_orders_sales_order"
  ON "fulfillment_orders" USING btree ("sales_order_id")
  WHERE "sales_order_id" IS NOT NULL;
```
체크리스트(메모리 `feedback_migration_dryrun_before_live` 의 ordering 버그 패턴):
- `DROP TABLE … CASCADE` 뒤에 같은 FK 를 중복 `DROP CONSTRAINT` 하는 문장이 **없어야** 함(있으면 `IF EXISTS` 로 멱등화).
- 부분 unique `CREATE` 가 어떤 컬럼 타입/enum 변경에 막히지 **않아야** 함(B 엔 타입 변경 없음 — 해당 없음 예상).
- enum 관련 `ALTER TYPE` 가 **없어야** 함(`'ORDER_MERGED'` 값 보존 결정 — 있으면 스키마에서 enum 을 잘못 건드린 것).
SQL 이 이상하면 `git rm` 후 스키마 고쳐 재생성(생성 마이그레이션 hand-edit 금지).

- [ ] **Step 3: 스키마 + 마이그레이션 + meta 단일 커밋** (CLAUDE.md 규칙 — 분리 시 다른 체크아웃 desync)

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle/<ts>_cluster-b-fo-identity.sql \
        apps/core/drizzle/meta/
git commit -m "feat(outbound): Cluster B 스키마 — FOL drop·shipments FO-unique drop·SO:FO 부분 unique

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 (M): FO-split 제거 — split() 체인 + dead merge/transfer + spec

**Files:**
- Modify: `apps/core/src/modules/fulfillment/controllers/fulfillments.controller.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts`
- Modify: `apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts`
- Delete: `apps/core/src/modules/fulfillment/dto/split-fulfillment-order.dto.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.integration.spec.ts`

- [ ] **Step 1: 컨트롤러 split 라우트+import 제거** — `fulfillments.controller.ts`

```ts
// :37-42  삭제
@Post(':id/split')
split(@Param('id') id: string, @Body() dto: SplitFulfillmentOrderDto) {
  return this.service.split(id, dto);
}
// :8  import 삭제 (SplitFulfillmentOrderDto)
```

- [ ] **Step 2: 서비스 `split()` 메서드 + import 제거** — `fulfillments.service.ts`

`async split(id, dto, tx?)` 전체(`:856-1099`) 삭제. `:21` 의 `SplitFulfillmentOrderDto` import 삭제. (split() 만 쓰던 헬퍼가 있으면 dead 가 되니 빌드 에러로 드러남 — 그때 함께 제거.)

- [ ] **Step 3: `'split'` admin action 제거** — `fulfillments.service.ts:1312`

```ts
// computeAdminAvailableActions() 안 — 이 줄 삭제
if (!hasShippedItems) actions.push('split');
```

- [ ] **Step 4: lifecycle split/merge/transfer 제거** — `reservation-lifecycle.service.ts`

세 메서드 블록 삭제 (클래스·생성자·다른 메서드는 유지):
```ts
// :239-357  handleFulfillmentOrderSplit (LIVE — split() 전용, 이제 호출자 0)
// :362-394  handleFulfillmentOrderMerge (DEAD)
// :399-458  handleFulfillmentOrderItemTransfer (DEAD, 인접)
```
`unifiedReservation`/`productSellableQuantity` 등 생성자 의존성은 다른 live 메서드가 계속 쓰므로 **그대로 둔다.**

- [ ] **Step 5: split DTO 파일 삭제**

```bash
git rm apps/core/src/modules/fulfillment/dto/split-fulfillment-order.dto.ts
```
(`SplitFulfillmentOrderItemDto`/`SplitFulfillmentOrderLineDto`/`SplitFulfillmentOrderDto` 전부 split 전용 — controller·service 외 참조 없음.)

- [ ] **Step 6: spec 갱신** — `fulfillments.service.spec.ts`

- `describe('split guard')` 블록 전체(`:1354-1591`) 삭제.
- reservationLifecycle mock 의 `handleFulfillmentOrderSplit` stub(`:225-227`) 삭제.
- `computeAdminAvailableActions` 단언에서 `'split'` 기대 제거(`:1723`, `:1733` 부근 — `actions` 가 `'split'` 을 **포함하지 않음**으로 변경하거나 해당 단언 삭제). 정확한 단언은 실행 시 확인:
  Run: `jest --testPathPattern="fulfillments\.service\.spec" -t "computeAdminAvailableActions" 2>&1 | tail -30`

- [ ] **Step 7: integration spec 의 split 블록 제거** — `fulfillment-reservations.facade.integration.spec.ts`

`it('FO 분할 예약 이동...')`(`:212-264`, `lifecycle.handleFulfillmentOrderSplit` 호출 `:218`) 블록만 삭제. 파일·transfer-candidates 테스트는 유지. `ReservationLifecycleService` import(`:9`)·선언(`:33`)·생성(`:56-60`)이 다른 테스트에서 쓰이면 유지, split 전용이면 제거(`describeIfDb` skip 이라 빌드만 보면 됨).

- [ ] **Step 8: 빌드 + 좁힌 spec**

Run: `npx nest build core 2>&1 | tail -20`
Expected: compiled successfully.
Run: `jest --testPathPattern="fulfillments\.service\.spec" 2>&1 | tail -30`
Expected: PASS (split describe 제거분 빼고 전부 GREEN).

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "refactor(outbound): Cluster B — FO-split 은퇴(split 체인·dead merge/transfer 제거)

상자 레이어 splitShipment(B 밖)로 대체. SO:FO 1:1 을 깨던 FO-split 제거.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4 (M): SO-merge 제거 — merge() · route · DTO · emit

**Files:**
- Modify: `apps/core/src/modules/sales-order/controllers/sales-orders.controller.ts`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts`
- Delete: `apps/core/src/modules/sales-order/dto/merge-sales-orders.dto.ts`

- [ ] **Step 1: 컨트롤러 merge 라우트+import 제거** — `sales-orders.controller.ts`

```ts
// :73-78  삭제
@Post('merge')
merge(@Body() dto: MergeSalesOrdersDto) {
  return this.service.merge(dto);
}
// :8  import 삭제 (MergeSalesOrdersDto)
```

- [ ] **Step 2: 서비스 `merge()` + collaborator 제거** — `sales-orders.service.ts`

- `merge(dto, tx?)` 전체(`:618-748`) 삭제 — 이 메서드가 merged SO 생성·source SO/FO cancel·예약 release·`ORDER_MERGED` emit 을 모두 담고 있어 통째 제거로 SO:FO 1:1 위반 경로가 사라진다.
- `IFulfillmentsService` 로컬 인터페이스(`:144-150`) 삭제.
- 생성자의 `@Optional() ... fulfillments: IFulfillmentsService`(`:167`) 주입 파라미터 삭제.
- 주의: `create()` 의 `mergeGroupId: dto.mergeGroupId ?? null`·`isMerged: false`(`:189-190`)는 **정상 주문 경로 — 유지.**

- [ ] **Step 3: merge DTO 파일 삭제**

```bash
git rm apps/core/src/modules/sales-order/dto/merge-sales-orders.dto.ts
```

- [ ] **Step 4: 빌드 + 좁힌 spec**

Run: `npx nest build core 2>&1 | tail -20`
Expected: compiled successfully.
Run: `jest --testPathPattern="sales-orders\.service\.spec" 2>&1 | tail -30`
Expected: PASS (merge 테스트는 애초에 없음 — 기존 cancel/update/confirm 등 GREEN 유지).

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "refactor(outbound): Cluster B — SO-merge 은퇴(merge route·메서드·DTO·ORDER_MERGED emit 제거)

여러 SO 를 합쳐 단일 FO 를 만들던 SO-merge 제거 → SO:FO 1:1 회복. 합배송(상자 M:N)으로 대체(B 밖).
mergeGroups/mergeGroupId/isMerged(합배송 인프라)·ORDER_MERGED enum 값(불활성)은 보존.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5 (M): dead 중복출고경로 제거 — transaction service + lifecycle case

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-order-transaction.service.ts`
- Modify: `apps/core/src/modules/inventory/shared/services/reservation-lifecycle.service.ts`

- [ ] **Step 1: dead transaction 메서드 2개 제거** — `fulfillment-order-transaction.service.ts`

```ts
// :202-231  completeFulfillmentOrder (호출자 0 — consumeShipment 가 대체)
// :233-260  shipFulfillmentOrder    (호출자 0 — consumeShipment 가 대체)
```
`cancelFulfillmentOrder`/`updateFulfillmentOrderPriority`/`allocateToOutboundBatch`(active)는 유지.

- [ ] **Step 2: lifecycle dead case 제거** — `reservation-lifecycle.service.ts:37-45`

`handleFulfillmentOrderStatusChange` 의 `switch (newStatus)` 에서:
```ts
// :37-40  삭제 (어떤 active 경로도 'completed'/'shipped' 를 안 넘김 — Step 1 제거로 정적 unreachable)
case 'completed':
case 'shipped':
  await this.releaseFulfillmentOrderReservations(foId, trx, `FO ${newStatus}`);
  break;
// :42-45  삭제 ('partially_shipped' 는 enum 멤버도 아닌 pure dead string)
case 'partially_shipped':
  await this.handlePartialShipment(foId, trx);
  break;
```
`case 'canceled'`(`:33-35`)는 **유지**. 그 결과 `handlePartialShipment`(private, `:140`) 가 호출자 0 이 되면 함께 제거(빌드 경고/확인 후). `releaseFulfillmentOrderReservations`(`:91-120`)는 `'canceled'`+consume seam 이 쓰므로 **유지.**

- [ ] **Step 3: 빌드 + 좁힌 spec**

Run: `npx nest build core 2>&1 | tail -20`
Expected: compiled successfully.
Run: `jest --testPathPattern="(fulfillments\.service|outbound-consumption\.service|shipment\.service)\.spec" 2>&1 | tail -30`
Expected: PASS. (이 경로들엔 전용 spec 없음 — `handleFulfillmentOrderStatusChange` mock 은 `'canceled'` 만 행사하므로 무영향.)

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "refactor(outbound): Cluster B — dead 중복출고경로 제거(shipFulfillmentOrder/completeFulfillmentOrder·lifecycle completed/shipped/partially_shipped case)

Cluster A consumeShipment 가 FO 종결을 일원화 → 옛 경로는 호출자 0. fulfillmentStatusEnum 값은 보존.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6 (M, optional): 인접 dead 정리 — 0-caller 재확인 후

핵심 경로 아님. 시간 여유 시 같은 PR 에서 처리, 아니면 별도 hygiene 이슈.

- [ ] **Step 1: 0-caller 재확인**

Run: `rg -n "createFulfillmentOrder\b|adjustReservationOnQuantityChange\b" apps --type ts | rg -v "\.spec\.|def |async createFulfillmentOrder|async adjustReservation"`
Expected: 호출 site 0. (`createFulfillmentOrder` 는 controller `fulfillment-order.controller.ts:19` 가 `GoneException` throw 로 대체됨.)

- [ ] **Step 2: 확인되면 제거**

- `fulfillment-order-transaction.service.ts:51-167` `createFulfillmentOrder` (dead, controller Gone). 관련 생성용 DTO 가 다른 곳에서 안 쓰이면 함께.
- `reservation-lifecycle.service.ts:463` `adjustReservationOnQuantityChange` (호출자 0 의심).
- `consolidation.service.ts:171` `FulfillmentOrderTransactionService` 미사용 주입 제거(멤버 접근 0).

- [ ] **Step 3: 빌드 + 커밋**

Run: `npx nest build core 2>&1 | tail -20` → compiled successfully.
```bash
git add -A && git commit -m "chore(outbound): Cluster B — 인접 dead 코드 정리(createFulfillmentOrder·adjustReservationOnQuantityChange·미사용 주입)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7 (M): 검증 — 빌드 · spec 스윕 · 마이그레이션 드라이런 · 문서

**Files:**
- Modify: `docs/outbound-shipment-ledger-rfc.md` (Progress/Immediate Next Step Phase 3 → 구현 반영)

- [ ] **Step 1: 전체 빌드 클린**

Run: `npx nest build core 2>&1 | tail -20`
Expected: `compiled successfully` (exit 0).

- [ ] **Step 2: 영향 spec 좁힌 스윕**

Run: `jest --testPathPattern="(fulfillments\.service|sales-orders\.service|outbound-consumption\.service|shipment\.service|invoice\.service)\.spec" 2>&1 | tail -40`
Expected: PASS. (사전 존재 적색 `store-sales-orders.service.spec.ts` 11건은 B 무관 — RFC 후속 #5? 아니, 핸드오프 #5 별개. 손대지 않음.)

- [ ] **Step 3: 마이그레이션 BEGIN…ROLLBACK 문장별 드라이런 (live, 사용자 터널 필요)**

메모리 `feedback_migration_dryrun_before_live` + `project_live_db_readonly_access`. 파일을 `--> statement-breakpoint` 로 split → 각 문장을 트랜잭션 안에서 실행 → 첫 실패+pg 에러 출력 → ROLLBACK. 특히 `CREATE UNIQUE INDEX uq_fulfillment_orders_sales_order … WHERE sales_order_id IS NOT NULL` 가 **현재 live 데이터(FO 10건, 중복 0)에서 성공**하는지 확인 = 게이트의 최종 실증.
- 접속: `cd deployments/lcnine/services && npx sst shell --stage live -- npx tsx <dry-run script>` (postgres.js 직접 시 `ssl:{rejectUnauthorized:false}` 필수).
- TCP 는 붙는데 `ECONNRESET` 이면 터널 닫힘 → 사용자에게 요청.

- [ ] **Step 4: 배포 직전 게이트 재점검 (caveat)**

B 배포 *전에* 출고가 프로덕션 라이브가 됐을 수 있으므로, unique 적용 직전 read-only 재점검: `SELECT sales_order_id, count(*) FROM fulfillment_orders WHERE sales_order_id IS NOT NULL GROUP BY 1 HAVING count(*)>1` 가 공집합인지. 위반자 있으면 정리/expand-contract 로 전환(현재는 0).

- [ ] **Step 5: RFC Progress/Next Step 갱신 + 커밋**

`docs/outbound-shipment-ledger-rfc.md` Phase 3 행을 🟦 설계확정 → 🟩 구현·머지 상태로, Immediate Next Step #9 를 완료로 갱신. admin-web 조율(split-tab 404·merge 클라이언트)을 후속 추적 #1 로 명시 연결.
```bash
git add docs/outbound-shipment-ledger-rfc.md
git commit -m "docs(outbound): RFC — Cluster B 구현 반영(FO 정체성·제거 surface·게이트 실증)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (작성자 체크 — 2026-07-01)

**1. Spec coverage (RFC §Phase 3 B4 vs tasks):**
- FOL drop → Task 1·2 ✅
- FO-split(`split`+`handleFulfillmentOrderSplit`+`handleFulfillmentOrderMerge`) 은퇴 → Task 3 ✅
- SO-merge FO 생성 은퇴 → Task 4 ✅
- dead 중복출고경로(`shipFulfillmentOrder`/`completeFulfillmentOrder` + reservation `completed`/`shipped` case) → Task 5 ✅
- M:N 개방(`uq_shipments_fo_active` drop + openedForFO nullable) → Task 1(unique drop); nullable 은 A 가 이미 처리(확정 결정 3) ✅
- SO:FO 부분 unique → Task 1 Step 7 + Task 2 + Task 7 Step 3 실증 ✅
- B 가드(shipment lazy·합배송 로직 분리) → Non-Goals 에 known-gap 으로 명시(consumeShipment rework 미포함) ✅

**2. Placeholder scan:** 모든 제거 step 에 정확한 file:line + 삭제 대상 코드 인용. "적절히 처리" 류 없음. 추가/변경 코드(부분 unique 콜백)는 전체 코드 제시. ✅

**3. Type consistency:** 신규 식별자는 `uq_fulfillment_orders_sales_order`(인덱스명) 하나뿐 — Task 1/2/7 에서 동일 표기. 보존 심볼(`releaseFulfillmentOrderReservations`·`fulfillmentStatusEnum`·`mergeGroups`)은 "보존" 으로 일관 표기. ✅

**4. 알려진 리스크:** ① drizzle 생성 SQL 의 ordering 버그(Cluster A 전례) → Task 2 Step 2 + Task 7 Step 3 드라이런으로 차단. ② admin-web 404(split-tab) → Non-Goals + 후속 추적 연결, B 가 깨는 의존성으로 명시. ③ `merge()` 제거가 source-FO cancel/예약 release 로직도 없앰(다른 caller 없음 — 안전).
