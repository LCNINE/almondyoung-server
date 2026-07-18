# 출고→재고원장 Cluster A (상자 워크플로) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출고 종결을 "송장 스캔=박스 open → 박스 전 라인 검수 자동완료=재고원장 소진" 흐름으로 재구조화한다 (RFC §Phase 2 클러스터 A).

**Architecture:** 박스(`shipments`)를 송장 스캔으로 lazy 생성하고, 검수는 박스(`shipment_line.inspectedQty`) 위에서 진행한다. 마지막 라인이 검수 완료되는 순간 같은 tx 안에서 `consumeShipment`가 자동 발사돼 SHIP 이벤트 append + 예약 소진 + `FOI.shippedQty` 누적을 한다. 명시적 출고 엔드포인트(`POST :id/ship`·`PUT invoices/:id/ship`)와 `assignShipment`는 은퇴하고, 검수 영속(`inspection_sessions`/`inspection_items`)은 박스로 흡수된다.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), Jest (mock-db 단위 spec), `@app/db` `DbService.run`/`DbTx`.

**전제 (steer 확정):** 프로덕션 FO 0건 → expand-contract 불필요, **1 PR**. FO↔상자는 A에선 **1:1** (`uqFulfillmentOrder` 유지). 송장분할·합배송·`partially_shipped`·M:N은 전부 Cluster B. drop_ship FO는 박스/consume 경로 안 탐(가드 유지). dead 중복 출고경로(`reservation-lifecycle:37-40` `case completed/shipped`)는 Cluster B 소관 — **A에서 안 건드림**.

**확정 결정 (2026-06-30 사용자 답변):**
1. **invoice 컬럼 RFC 어휘로 리네임**: `invoiceNumber→trackingNo`, `carrierCode→carrier`(carrierEnum), `goodsflowServiceId→externalServiceId`, `fulfillmentOrderId→issuedForFulfillmentOrderId`.
2. **`assignShipment` 은퇴**: 라우트/DTO/service 메서드/spec 제거.
3. **검수 보조 메서드 제거**: `getInspectionSummary`/`getQualityMetrics`/`getInspectionHistory`/`bulkApprove`/`resetInspection` 제거. `forceShipment`는 A 핵심(#5)이라 박스 모델로 이식.

**환경 제약:**
- **dev 환경 삭제** → 통합테스트 실행 불가. GREEN 게이트 = **단위 spec(mock-db) + `nest build core` 클린**. 통합 spec은 새 모델로 갱신하되 `describeIfDb` skip 유지(통합검증 빚, RFC carry-forward).
- jest 전체 스위트 OOM 금지 → `jest --testPathPattern=<좁힌 패턴>`. eslint OOM → `NODE_OPTIONS=--max-old-space-size=6144`.
- 마이그레이션 **생성**은 로컬 가능(`npm run db:generate:core`), **적용/검증은 사용자와 확인**.
- 답변은 한국어.

---

## 어휘 ↔ 코드 매핑 (구현자 필독)

| RFC 어휘 | 코드 심볼 | 비고 |
|---|---|---|
| 상자(shipment) | `shipments` 테이블 | 박스 = 송장 한 장 = 종결 단위 |
| 상자 라인(shipment_line) | `shipmentLines` | `{shipmentId, foiId, skuId, qty, inspectedQty, forced}` |
| 운송장번호(invoice) | `invoices` 테이블 | 발급 이력, shipment 1:N |
| 출고주문(FO) | `fulfillmentOrders` | SKU 스냅샷 (A: FO↔상자 1:1) |
| FOI | `fulfillmentOrderItems` | |
| 종결 seam | `OutboundConsumptionService.consumeShipment` | ledger + 예약 소진 + shippedQty 누적 + 이벤트 |
| 박스 open(스캔) | `ShipmentService.openBoxByScan` (신규) | lazy 생성 |
| 검수 스캔 | `ShipmentService.inspectScan` (신규) | `inspectedQty++` |
| 강제출고 | `ShipmentService.forceShipment` (이식) | `forced=true` |

---

## File Structure

**신규 파일:**
- `apps/core/src/modules/fulfillment/services/shipment.service.ts` — 박스 라이프사이클(openBoxByScan·getBox·inspectScan·forceShipment·logInspectionIssue). 검수가 박스로 흡수됐으므로 inspection.service를 대체.
- `apps/core/src/modules/fulfillment/controllers/shipment.controller.ts` — `@Controller('shipments')`: `POST /scan`, `GET /:id`, `POST /:id/inspect-scan`, `POST /:id/force`.
- `apps/core/src/modules/fulfillment/services/shipment.service.spec.ts` — 단위 spec(mock-db).

**수정 파일:**
- `apps/core/src/modules/inventory/schema/inventory.schema.ts` — enums·shipments·shipmentLines·invoices·inspection 테이블.
- `apps/core/src/modules/fulfillment/services/outbound-consumption.service.ts` — `consumeShipment` 전체 종결로 확장, `ensureShipmentLines` 제거.
- `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` — `ship()` drop_ship 전용으로 축소, `assignShipment` 제거, `getOne`/`getList` shipment 매핑.
- `apps/core/src/modules/fulfillment/services/invoice.service.ts` — 컬럼 리네임, `issueInvoice` 박스 upsert 제거, `markAsShipped` 제거, `cancelInvoice` void화.
- `apps/core/src/modules/fulfillment/controllers/invoice.controller.ts` — `PUT :id/ship` 제거.
- `apps/core/src/modules/fulfillment/controllers/fulfillments.controller.ts` — `POST :id/ship`·`POST :id/assign-shipment` 제거.
- `apps/core/src/modules/fulfillment/fulfillment.module.ts` — InspectionService/Controller 제거, ShipmentService/Controller 등록.
- DTO: `dto/assign-shipment.dto.ts`(삭제), `dto/fulfillment-order-response.dto.ts`(trackingNo/carrier 출처 변경).
- spec: `fulfillments.service.spec.ts`, `invoice.service.hanjin.spec.ts`, `invoice.service.spec.ts`, `outbound-consumption.service.spec.ts`, `outbound-consumption.integration.spec.ts`.

**삭제 파일:**
- `apps/core/src/modules/fulfillment/services/inspection.service.ts`
- `apps/core/src/modules/fulfillment/controllers/inspection.controller.ts`
- `apps/core/src/modules/fulfillment/services/inspection.service.spec.ts`
- `apps/core/src/modules/fulfillment/dto/assign-shipment.dto.ts`

---

## 작업 그룹 개요 (순서 = 의존)

- **A. 스키마 + 마이그레이션** (Task 1–2) — 토대. 편집 후 컴파일이 광범위하게 깨짐(의도된 big-bang). 이후 태스크가 호출처를 고친다.
- **B. invoice 재배치** (Task 3–4) — 리네임·박스 upsert 제거·markAsShipped/cancelInvoice 재작성.
- **C. 종결 seam 확장** (Task 5–6) — `consumeShipment` 전체 종결화 + `ship()` drop_ship 전용화.
- **D. 박스 lazy 생성 + 검수** (Task 7–10) — ShipmentService(open/inspect/force) + controller.
- **E. 배선·정리·검증** (Task 11–14) — module·DTO·기존 spec·통합 spec·문서·빌드.

각 태스크는 **(M) 기계적 리팩터**(test = `nest build core` 클린 + 기존 spec 갱신) 또는 **(TDD) 신규 동작**(test-first) 으로 표시한다. TDD 태스크는 Iron Law: 실패 테스트 먼저, 실패 확인, 최소 구현.

---

## Task 1 (M): 스키마 — enums·shipments·shipment_lines·invoices·inspection 테이블

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`

이 태스크는 스키마 구조만 바꾼다(behavior 없음 → 빌드가 게이트). 편집 직후 `nest build core`는 **의도적으로 실패**한다(호출처가 옛 컬럼명을 참조). Task 2~10에서 모두 해소된다.

- [ ] **Step 1: enum 값 변경** — `inventory.schema.ts:91`, `:219`

```ts
// :91 — 'created' 제거(박스는 'open'으로 태어남), 'open'/'shipped'/'canceled' 추가
export const shipmentStatusEnum = pgEnum('shipment_status', [
  'open', 'shipped', 'in_transit', 'delivered', 'failed', 'canceled',
]);

// :219 — issued/used/voided 로 재정의 (printed/shipped/canceled 폐기)
export const invoiceStatusEnum = pgEnum('invoice_status', ['issued', 'used', 'voided']);
```

- [ ] **Step 2: `shipments` 재배치** — `inventory.schema.ts:1456-1477` 전체 교체

```ts
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 박스 = 송장 한 장. 송장 스캔(open)에서 lazy 생성 (RFC §Phase 2 #6).
    // warehouseId 는 FO 에서 denormalize — consumeShipment 가 직접 읽는다(FO 재조회 제거).
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    // 자동완료 판정 기준 FO. A 는 FO 1:1(uq 유지). nullable: 합배송(B)에서 풀림.
    openedForFulfillmentOrderId: uuid('opened_for_fulfillment_order_id').references(
      () => fulfillmentOrders.id,
      { onDelete: 'set null' },
    ),
    status: shipmentStatusEnum('status').notNull().default('open'),
    // 박스를 연 작업자 — SHIP 이벤트 actor 귀속(stock_journals.actorId).
    openedBy: uuid('opened_by'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // A: 상자당 FO 1개 (FO↔상자 1:1). Cluster B 에서 drop.
    uqFulfillmentOrder: unique('uq_shipments_fulfillment_order_id').on(t.openedForFulfillmentOrderId),
    idxOpenedForFo: index('idx_shipments_opened_for_fo').on(t.openedForFulfillmentOrderId),
  }),
);
```
제거된 컬럼: `trackingNo`·`carrier`(→invoice), `eta`·`splitStatus`·`invoiceUrl`(폐기). `fulfillmentOrderId`→`openedForFulfillmentOrderId` 리네임.

- [ ] **Step 3: `shipment_lines` 에 inspectedQty·forced 추가** — `inventory.schema.ts:1485-1508`

`qty` 다음에 추가, check 보강:
```ts
    qty: integer('qty').notNull(),
    // 검수 통과 수량 (검수 스캔이 누적). 강제출고 시 := qty.
    inspectedQty: integer('inspected_qty').notNull().default(0),
    // 강제출고 여부 — 권한 무제한·사유 없음(RFC §검수, CONTEXT 강제출고).
    forced: boolean('forced').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxShipment: index('idx_shipment_lines_shipment').on(t.shipmentId),
    uqShipmentFoi: unique('uq_shipment_lines_shipment_foi').on(t.shipmentId, t.fulfillmentOrderItemId),
    ckQtyPositive: check('ck_shipment_lines_qty_positive', sql`${t.qty} > 0`),
    ckInspectedRange: check('ck_shipment_lines_inspected_range', sql`${t.inspectedQty} >= 0 AND ${t.inspectedQty} <= ${t.qty}`),
  }),
);
```

- [ ] **Step 4: `invoices` 리네임·재배치** — `inventory.schema.ts:2232-2261` 전체 교체

```ts
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 운송장번호 = 택배사 API 발급 번호 (구 invoiceNumber).
    trackingNo: varchar('tracking_no', { length: 128 }).notNull().unique(),
    // 구 carrierCode(varchar) → carrierEnum. provider 응답 carrierCode 는 enum 으로 검증 후 저장.
    carrier: carrierEnum('carrier'),
    issueMethod: invoiceMethodEnum('issue_method').notNull(),
    // 구 goodsflowServiceId — goodsflow/hanjin 공용 외부 service id.
    externalServiceId: varchar('external_service_id', { length: 255 }),
    // 선발급(미리 출력) 추적용 — 발급 시점의 FO.
    issuedForFulfillmentOrderId: uuid('issued_for_fulfillment_order_id')
      .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
      .notNull(),
    // 박스 open(송장 스캔) 시 세팅. 선발급 동안 null. void 된 송장도 보존(이력).
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    status: invoiceStatusEnum('status').notNull().default('issued'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxIssuedForFo: index('idx_invoices_issued_for_fo').on(t.issuedForFulfillmentOrderId),
    idxTrackingNo: index('idx_invoices_tracking_no').on(t.trackingNo),
    idxStatus: index('idx_invoices_status').on(t.status),
    idxShipment: index('idx_invoices_shipment').on(t.shipmentId),
    // 박스당 active(미void) 송장 1개. 구 uqActivePerFo(FO 기반)를 대체 (RFC 정정 line 250).
    uqActivePerShipment: uniqueIndex('uq_invoices_shipment_active')
      .on(t.shipmentId)
      .where(sql`${t.status} <> 'voided'`),
  }),
);
```
제거: `printedAt`·`shippedAt`(폐기), `uqActivePerFo`.

- [ ] **Step 5: 검수 영속 붕괴 — `inspectionSessions`/`inspectionItems` 삭제, `inspectionIssues` sessionId→shipmentId** — `inventory.schema.ts:2099-2173`

`inspectionSessions`(2099-2122)와 `inspectionItems`(2125-2148) 블록을 **삭제**. `inspectionIssues`(2151-2173)는 유지하되 `sessionId` 컬럼을 `shipmentId`로 교체:
```ts
export const inspectionIssues = pgTable(
  'inspection_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foiId: uuid('foi_id')
      .references(() => fulfillmentOrderItems.id, { onDelete: 'cascade' })
      .notNull(),
    // 구 sessionId(→inspection_sessions, 폐기) → 박스 참조로 교체.
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 32 }).notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    description: text('description').notNull().default(''),
    qty: integer('qty'),
    inspectorUserId: varchar('inspector_user_id', { length: 255 }),
    photos: jsonb('photos').$type<string[]>(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (t) => ({
    idxFoi: index('idx_inspection_issues_foi').on(t.foiId),
    idxShipment: index('idx_inspection_issues_shipment').on(t.shipmentId),
  }),
);
```

- [ ] **Step 6: `wmsTables`/`wmsSchema` 에서 삭제 테이블 제거** — `inventory.schema.ts:2266`, `:3214` 부근

`wmsTables` 객체와 `wmsSchema` 객체에서 `inspectionSessions`, `inspectionItems` 항목을 삭제(둘 다 등록돼 있으면). grep 으로 확인:
```bash
grep -n "inspectionSessions\|inspectionItems" apps/core/src/modules/inventory/schema/inventory.schema.ts
```
스키마 객체 내 두 항목만 제거(테이블 export 는 이미 Step 5에서 삭제).

- [ ] **Step 7: 빌드 — 의도된 실패 확인**

Run: `nest build core 2>&1 | head -40`
Expected: 다수 컴파일 에러(invoice.service·fulfillments.service·inspection.service·spec 들이 옛 컬럼/테이블 참조). 에러 목록을 Task 2~10의 작업 체크리스트로 사용. **이 시점엔 커밋하지 않는다** — 스키마는 호출처와 함께 커밋(Task 12 끝에 일괄, 또는 그룹별 커밋).

---

## Task 2 (M): 마이그레이션 생성 + 리뷰

**Files:**
- Create: `apps/core/drizzle/<timestamp>_cluster-a-box-workflow.sql` (자동 생성)
- Modify: `apps/core/drizzle/meta/*`

> ⚠️ 적용은 사용자 확인 후(dev 환경 삭제). 이 태스크는 **생성·리뷰만**.

- [ ] **Step 1: 생성**

Run: `npm run db:generate:core -- --name cluster-a-box-workflow`
rename 프롬프트가 뜨면(컬럼/테이블) — **FO=0이라 데이터 보존 불필요**하므로 rename detection 없이 DROP+ADD 도 무방. 다만 enum 값 제거(`invoice_status`, `shipment_status`)는 drizzle 이 타입 recreate SQL 을 생성할 수 있다.

- [ ] **Step 2: 생성 SQL 리뷰** — 다음을 육안 확인

1. `shipments`: `tracking_no`/`carrier`/`eta`/`split_status`/`invoice_url` DROP, `warehouse_id`/`opened_at`/`shipped_at` ADD, `fulfillment_order_id`→`opened_for_fulfillment_order_id`.
2. `shipment_lines`: `inspected_qty`/`forced` ADD + ck.
3. `invoices`: 컬럼 리네임 4개, `shipment_id`/`voided_at` ADD, `printed_at`/`shipped_at` DROP, `uq_invoices_fo_active` DROP, `uq_invoices_shipment_active` ADD.
4. `inspection_sessions`/`inspection_items` DROP TABLE, `inspection_issues.session_id`→`shipment_id`.
5. enum: `shipment_status`·`invoice_status` 값 변경. **recreate SQL 이면 컬럼 default/타입 캐스팅 순서 확인** — 데이터 0건이라 안전하나 SQL 형태가 맞는지 본다.

SQL 이 이상하면 `git rm` 후 `schema.ts` 고쳐 재생성 (CLAUDE.md: 적용된 마이그레이션 손편집 금지 — 아직 미적용이므로 재생성 OK).

- [ ] **Step 3: 빌드만 재확인** (마이그레이션은 코드 변경 무관)

Run: `nest build core 2>&1 | tail -5` — 여전히 Task 1의 호출처 에러. 정상.

---

## Task 3 (M): invoice.service 컬럼 리네임 + issueInvoice 박스 upsert 제거

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/invoice.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/invoice.service.hanjin.spec.ts`, `invoice.service.spec.ts`

- [ ] **Step 1: 컬럼 참조 전수 리네임**

`invoice.service.ts` 전체에서 `wmsTables.invoices.<옛>` → `<새>`:
- `invoiceNumber` → `trackingNo`
- `carrierCode` → `carrier`
- `goodsflowServiceId` → `externalServiceId`
- `fulfillmentOrderId` → `issuedForFulfillmentOrderId`
- `printedAt`/`shippedAt` 셀렉트는 제거(컬럼 없음).

주의: provider 인터페이스의 `carrierCode`(DeliveryRequest/Response, `request.carrierCode`)는 **invoice 컬럼이 아니라 DTO 필드 — 건드리지 않는다.** invoice 컬럼만 리네임.

- [ ] **Step 2: `issueInvoice` — 박스 upsert 제거 + insert 값 갱신** — `invoice.service.ts:174-215`

INSERT invoices values 를 새 컬럼으로, **shipments upsert 블록(192-210) 삭제**:
```ts
        const [invoice] = await trx
          .insert(wmsTables.invoices)
          .values({
            issuedForFulfillmentOrderId: fulfillmentOrderId,
            trackingNo: invoiceNumber,
            carrier: carrierEnum.enumValues.find((v) => v === carrierCode) ?? requestCarrier ?? null,
            issueMethod,
            externalServiceId,
            status: 'issued',
            issuedAt: new Date(),
          })
          .returning();

        // 박스(shipments) upsert 제거: 박스는 송장 발급이 아니라 송장 스캔(open)에서 lazy 생성.
        // (RFC §Phase 2 #6. issueInvoice 는 선발급-only.)

        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({ status: 'invoiced' })
          .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
```
`carrier` 로컬 변수(191) 및 그를 쓰는 set 블록은 삭제. `operatorId` 파라미터는 더 이상 박스에 안 쓰이므로 시그니처에서 제거 가능(Task 11 controller 에서 인자 제거와 짝).

- [ ] **Step 3: `assertIssuable` 의 active-invoice 검사 — `canceled`→`voided`** — `invoice.service.ts:260-270`

```ts
    const existingRows = await trx
      .select({ id: wmsTables.invoices.id })
      .from(wmsTables.invoices)
      .where(
        and(
          eq(wmsTables.invoices.issuedForFulfillmentOrderId, fulfillmentOrderId),
          ne(wmsTables.invoices.status, 'voided'),
        ),
      )
      .limit(1);
```

- [ ] **Step 4: `printInvoices` — printed 전이 제거** — `invoice.service.ts:323`, `:363-377`

`status !== 'issued' && status !== 'printed'` 게이트(323) → `status !== 'issued'` 만(인쇄는 issued 에서만, 멱등). printed 전이 update 블록(363-377)은 **status 변경 없이** 제거 — 인쇄는 외부 URI 생성만 하고 상태/타임스탬프를 안 남긴다(printedAt 컬럼 폐기). `getInvoiceDetail`(536-542)의 `carrierCode`/`goodsflowServiceId`/`printedAt`/`shippedAt` 셀렉트도 새 컬럼명·제거에 맞춘다.

- [ ] **Step 5: spec 갱신 후 GREEN**

`invoice.service.hanjin.spec.ts`·`invoice.service.spec.ts` 에서 `invoiceNumber`/`carrierCode`/`goodsflowServiceId`/`fulfillmentOrderId` 어서션·mock 을 새 컬럼명으로. shipments upsert 를 검증하던 어서션은 삭제(박스 생성은 더 이상 issueInvoice 책임 아님). markAsShipped 검증은 Task 4 에서 제거.

Run: `npx jest --testPathPattern="invoice.service" --silent 2>&1 | tail -15`
Expected: PASS (또는 markAsShipped 관련만 실패 → Task 4 에서 해소).

---

## Task 4 (M): markAsShipped 은퇴 + cancelInvoice void화

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/invoice.service.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/invoice.controller.ts`

- [ ] **Step 1: `markAsShipped` 삭제** — `invoice.service.ts:389-430`

메서드 전체 삭제. `FulfillmentsService` 주입이 이 메서드에서만 쓰였다면 생성자 의존도 제거(grep 확인: `this.fulfillmentsService` 다른 사용처 없으면 제거).
```bash
grep -n "fulfillmentsService\|fulfillmentService" apps/core/src/modules/fulfillment/services/invoice.service.ts
```

- [ ] **Step 2: `cancelInvoice` → voided + 박스 정리 + inspection_sessions 참조 제거** — `invoice.service.ts:439-527`

`status==='canceled'` 분기·`'shipped'` 거부를 새 enum 으로, shipments 삭제를 박스 취소로, inspectionSessions 조회(502-511) 제거:
```ts
    if (invoice.status === 'voided') return;
    // 'used'(박스 open 됨) 송장도 void 가능하나, 박스가 이미 shipped 면 거부.
    // (선택: A 에선 cancel 은 주로 issued 단계. used→void 는 박스 취소 동반.)

    if (isProviderMethod(invoice.issueMethod) && invoice.externalServiceId) {
      const provider = this.getProvider(invoice.issueMethod);
      await provider.cancelInvoice(invoice.externalServiceId);
    }

    await this.dbService.run(async (trx) => {
      const current = await trx
        .select({ status: wmsTables.invoices.status, shipmentId: wmsTables.invoices.shipmentId })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]);

      // 박스가 이미 출고된 송장은 void 불가.
      if (current?.shipmentId) {
        const [box] = await trx
          .select({ status: wmsTables.shipments.status })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, current.shipmentId))
          .limit(1);
        if (box?.status === 'shipped') {
          throw new ConflictException('Cannot void invoice: box already shipped');
        }
        // open 박스는 취소(canceled) — 검수 진행분 무효.
        if (current.shipmentId) {
          await trx
            .update(wmsTables.shipments)
            .set({ status: 'canceled', lastUpdated: new Date() })
            .where(eq(wmsTables.shipments.id, current.shipmentId));
        }
      }

      await trx.update(wmsTables.invoices).set({ status: 'voided', voidedAt: new Date() }).where(eq(wmsTables.invoices.id, invoiceId));

      // FO 되돌리기: 발행이 만든 'invoiced' 만 picked 로 복귀(검수 영속이 박스로 옮겨가
      // inspection_sessions 조회는 제거 — 박스가 canceled 되며 검수분도 함께 무효).
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'picked' })
        .where(
          and(
            eq(wmsTables.fulfillmentOrders.id, invoice.issuedForFulfillmentOrderId),
            eq(wmsTables.fulfillmentOrders.status, 'invoiced'),
          ),
        );

      this.logger.log(`Voided invoice ${invoiceId}`);
    });
```
cancelInvoice 진입부 select(439-453)도 `fulfillmentOrderId`→`issuedForFulfillmentOrderId`, `goodsflowServiceId`→`externalServiceId` 로.

- [ ] **Step 3: `PUT :id/ship` 라우트 제거** — `invoice.controller.ts:58-62`

`@Put(':id/ship')` 핸들러 삭제. import 정리.

- [ ] **Step 4: GREEN**

Run: `npx jest --testPathPattern="invoice.service" --silent 2>&1 | tail -15`
Expected: PASS. markAsShipped/cancel 관련 spec 도 갱신(은퇴 메서드 테스트 삭제, void 동작 테스트 추가는 선택).

---

## Task 5 (TDD): consumeShipment 확장 — 전체 종결(shippedQty 누적·FO/FOI/박스 status·이벤트)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/outbound-consumption.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/outbound-consumption.service.spec.ts`

종결 seam 을 한 곳(`consumeShipment`)으로 모은다: ledger SHIP + 예약 소진(기존) + **FOI.shippedQty 누적 + FOI/FO/박스 status 전이 + FulfillmentShipped 이벤트**(ship()에서 이관). warehouseId 는 이제 shipment 컬럼에서 직접 읽음(FO 재조회 제거).

- [ ] **Step 1: 실패 테스트 — shippedQty 누적 + 박스 shipped 전이**

`outbound-consumption.service.spec.ts` 의 `consumeShipment` describe 에 추가. 기존 mock-db 패턴(`db.run = fn(tx)`, select/update 체인 jest.fn) 따름. 한 라인 박스가 소진되면 (a) `inventoryCommand.ship` 호출, (b) FOI.shippedQty 가 line.qty 만큼 누적되는 update, (c) shipment.status='shipped' update, (d) `outbox.enqueue` SHIPPED 이벤트가 발생하는지 검증:
```ts
it('소진 시 FOI.shippedQty 를 누적하고 박스를 shipped 로 전이하며 SHIPPED 이벤트를 발행한다', async () => {
  // given: shipment(open, warehouseId, openedForFO) + line{qty:3, foiId} + FOI{qty:3, shippedQty:0}
  //   (mock select 가 shipment→lines→FOI→invoice→salesOrder 순서로 반환하도록 구성)
  // when
  await service.consumeShipment('ship-1');
  // then
  expect(inventoryCommand.ship).toHaveBeenCalledTimes(1);             // line 1건
  expect(reservationLifecycle.consumeFulfillmentOrderReservations).toHaveBeenCalledWith('fo-1', expect.anything());
  expect(shippedQtyUpdate).toHaveBeenCalled();                         // FOI.shippedQty += 3
  expect(boxStatusUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'shipped' }));
  expect(outbox.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: FULFILLMENT_EVENTS.SHIPPED }),
    expect.anything(),
  );
});
```
> mock 구성은 기존 spec(`outbound-consumption.service.spec.ts:12`)의 체인 mock 패턴을 그대로 확장. `outbox`/`db` select 분기는 호출 순서로 스텁.

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern="outbound-consumption.service.spec" --silent 2>&1 | tail -20`
Expected: FAIL — shippedQty 누적/박스 전이/이벤트 미발생.

- [ ] **Step 3: 의존성 추가 + `consumeShipment` 확장**

생성자에 `OutboxService` 추가(같은 모듈 `../outbox/outbox.service`). `consumeShipment` 를 다음으로:
```ts
async consumeShipment(shipmentId: string, tx?: DbTx): Promise<void> {
  return this.db.run(async (trx) => {
    const [shipment] = await trx
      .select({
        id: wmsTables.shipments.id,
        foId: wmsTables.shipments.openedForFulfillmentOrderId,
        openedBy: wmsTables.shipments.openedBy,
        warehouseId: wmsTables.shipments.warehouseId,
        status: wmsTables.shipments.status,
      })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    if (shipment.status === 'shipped') return;          // 멱등: 이미 종결
    const fulfillmentOrderId = shipment.foId;
    if (!fulfillmentOrderId) throw new Error(`Shipment ${shipmentId} 에 openedForFulfillmentOrderId 없음 (불변식 위반)`);
    const warehouseId = shipment.warehouseId;

    const lines = await trx
      .select({
        id: wmsTables.shipmentLines.id,
        foiId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
      })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
    if (lines.length === 0) { this.logger.warn(`Shipment ${shipmentId} 에 소진할 라인 없음 (no-op)`); return; }

    const journalId = await this.ensureShipJournal(trx, shipmentId, shipment.openedBy ?? null);
    const now = new Date();

    for (const line of lines) {
      const chunks = await this.locationStrategy.resolve(line.skuId, warehouseId, line.qty, trx);
      for (const chunk of chunks) {
        await this.inventoryCommand.ship(
          {
            skuId: line.skuId, warehouseId, locationId: chunk.locationId, quantity: chunk.qty,
            idempotencyKey: `ship:${shipmentId}:${line.id}:${chunk.locationId}`,
            reason: `Shipment ${shipmentId} shipped`, journalId,
          },
          trx,
        );
      }
      // write-ownership: 출고 수량 단일 소스 = consume (검수는 inspectedQty 만). FOI.shippedQty 누적.
      const [foi] = await trx
        .select({ qty: wmsTables.fulfillmentOrderItems.qty, shippedQty: wmsTables.fulfillmentOrderItems.shippedQty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, line.foiId))
        .limit(1);
      const newShipped = (foi?.shippedQty ?? 0) + line.qty;
      await trx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: newShipped, status: newShipped >= (foi?.qty ?? newShipped) ? 'shipped' : 'pending', updatedAt: now })
        .where(eq(wmsTables.fulfillmentOrderItems.id, line.foiId));
    }

    // 예약 소진(환원 아님) — SHIP 가 위에서 emit 됐으므로 available 불변.
    await this.reservationLifecycle.consumeFulfillmentOrderReservations(fulfillmentOrderId, trx);

    // 박스 종결: shipped. A 는 박스=FO전량 → FO 도 shipped.
    await trx.update(wmsTables.shipments).set({ status: 'shipped', shippedAt: now, lastUpdated: now }).where(eq(wmsTables.shipments.id, shipmentId));
    await trx.update(wmsTables.fulfillmentOrders).set({ status: 'shipped', shippedAt: now, updatedAt: now }).where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

    await this.emitFulfillmentShipped(trx, shipmentId, fulfillmentOrderId, lines, now);
    this.logger.log(`Consumed shipment ${shipmentId}: ${lines.length} line(s) shipped to ledger`);
  }, tx);
}
```
`emitFulfillmentShipped` private — active invoice(`shipmentId`=this, status='used')에서 trackingNo/carrier, FO.salesOrderId→salesOrder.channelOrderId 읽어 `FulfillmentShippedPayload` 구성, `outbox.enqueue(FULFILLMENT_EVENTS.SHIPPED, …, trx)`. (페이로드 형태는 `fulfillments.service.ts:1257-1284` 와 동일; trackingInfo 출처만 invoice.)

- [ ] **Step 4: `ensureShipmentLines` 삭제** — 박스 라인은 스캔(openBox)에서 생성. ship-시점 packing 폐기(RFC #6).

`outbound-consumption.service.ts` 의 `ensureShipmentLines`(41-70) 삭제. spec 의 `ensureShipmentLines` describe(89)도 삭제.

- [ ] **Step 5: GREEN**

Run: `npx jest --testPathPattern="outbound-consumption.service.spec" --silent 2>&1 | tail -15`
Expected: PASS.

---

## Task 6 (M): ship() 을 drop_ship 전용 내부 연산으로 축소

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts`

`ship()` 은 이제 **drop_ship 완료 경로 전용**(direct-ship.service 가 호출). 비-drop_ship 종결은 전부 `consumeShipment`(검수 자동완료가 호출). `POST :id/ship`·`markAsShipped` 엔드포인트는 은퇴(Task 11).

- [ ] **Step 1: `ship()` 비-drop_ship 분기 제거** — `fulfillments.service.ts:1161-1288`

비-drop_ship 가드/shipment require/`ensureShipmentLines`/`consumeShipment`(1194-1201, 1242-1247) 제거하고 drop_ship 전용으로:
```ts
/** drop_ship 완료 전용(내부) — direct-ship.service 가 공급사 전달 완료 시 호출.
 *  타사 재고라 원장·예약·박스를 건드리지 않고 FO 종결 전이 + FulfillmentShipped 이벤트만.
 *  자사(in_house/3pl) 출고는 검수 자동완료→consumeShipment 가 담당(이 메서드 아님). */
async ship(id: string, tx?: DbTx) {
  return this.db.run(async (trx) => {
    await trx.execute(sql`SELECT id FROM ${wmsTables.fulfillmentOrders} WHERE ${wmsTables.fulfillmentOrders.id} = ${id} FOR UPDATE`);
    const [fo] = await trx.select().from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, id)).limit(1);
    if (!fo) throw new NotFoundException(`Fulfillment order ${id} not found`);
    if (fo.status === 'shipped') return this.getOne(id, trx);
    if (fo.status === 'completed' || fo.status === 'canceled') throw new ConflictException(`Cannot ship FO ${id} in terminal status '${fo.status}'`);

    if (fo.fulfillmentMode !== 'drop_ship') {
      throw new ConflictException(`ship() 은 drop_ship 전용입니다. 자사 출고는 검수 자동완료(consumeShipment)를 거칩니다.`);
    }
    if (fo.directShipStatus !== 'forwarded') {
      throw new ConflictException(`Cannot ship drop_ship FO ${id}: directShipStatus must be 'forwarded', got '${fo.directShipStatus ?? 'null'}'`);
    }

    await trx.execute(sql`SELECT id FROM ${wmsTables.fulfillmentOrderItems} WHERE ${wmsTables.fulfillmentOrderItems.fulfillmentOrderId} = ${id} FOR UPDATE`);
    const items = await trx.select().from(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id));
    const now = new Date();
    for (const item of items) {
      await trx.update(wmsTables.fulfillmentOrderItems).set({ shippedQty: item.qty, status: 'shipped', updatedAt: now }).where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
    }
    await trx.update(wmsTables.fulfillmentOrders).set({ status: 'shipped', shippedAt: now, updatedAt: now }).where(eq(wmsTables.fulfillmentOrders.id, id));

    const [salesOrderRow] = fo.salesOrderId
      ? await trx.select({ channelOrderId: wmsTables.salesOrders.channelOrderId }).from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, fo.salesOrderId)).limit(1)
      : [];
    const shippedPayload: FulfillmentShippedPayload = {
      fulfillmentId: id,
      orderId: fo.salesOrderId ?? '',
      channelOrderId: salesOrderRow?.channelOrderId ?? undefined,
      trackingInfo: { carrier: 'CJ', trackingNumber: '', invoiceUrl: undefined },  // drop_ship: 공급사 발송, 자사 운송장 없음
      shippedAt: now.toISOString(),
      estimatedDeliveryDate: undefined,
      shippedItems: items.map((item) => ({ fulfillmentItemId: item.id, skuId: item.skuId, shippedQty: item.qty })),
    };
    await this.outbox.enqueue(
      { eventType: FULFILLMENT_EVENTS.SHIPPED, aggregateType: 'fulfillment', aggregateId: id, partitionKey: fo.salesOrderId ?? id, payload: shippedPayload },
      trx,
    );
    return this.getOne(id, trx);
  }, tx);
}
```
`OutboundConsumptionService` 주입이 fulfillments.service 의 다른 곳에서 안 쓰이면 의존 제거(grep `this.outboundConsumption`).

- [ ] **Step 2: `assignShipment` 삭제** — `fulfillments.service.ts:1104-1159`

메서드 전체 삭제(은퇴 결정 #2).

- [ ] **Step 3: `getOne`/`getList` shipment 매핑 수정** — `fulfillments.service.ts:1522`, `:1530-1538`, `:1659`

`shipments.trackingNo`/`carrier` 셀렉트 제거(컬럼 없음). 응답의 trackingNo/carrier 가 필요하면 **active invoice**(`invoices.issuedForFulfillmentOrderId=fo.id` AND `status != 'voided'`)에서 `trackingNo`/`carrier` 를 join. `eta`/`invoiceUrl` 셀렉트 제거. `invoices.carrierCode`→`carrier`, `invoiceNumber`→`trackingNo` 로.

- [ ] **Step 4: spec 갱신 + GREEN**

`fulfillments.service.spec.ts` 에서: assignShipment 테스트 삭제; ship() 비-drop_ship 테스트는 drop_ship 케이스로 전환하거나 "비-drop_ship 은 ConflictException" 으로; `shipment.trackingNo/carrier` mock·어서션 정리; consume/ensureShipmentLines 호출 어서션 삭제.

Run: `NODE_OPTIONS=--max-old-space-size=6144 npx jest --testPathPattern="fulfillments.service.spec" --silent 2>&1 | tail -20`
Expected: PASS.

---

## Task 7 (TDD): ShipmentService.openBoxByScan — 박스 lazy 생성

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/shipment.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/shipment.service.spec.ts`

송장 스캔 → 박스 open: invoice(status=issued) 찾기 → shipment{open} 생성 → invoice.shipmentId 세팅·status=used → FO 미출고 FOI 미러해 shipment_line 생성(`qty=잔량, inspectedQty=0`).

- [ ] **Step 1: 실패 테스트**

```ts
// shipment.service.spec.ts — mock-db 패턴(new ShipmentService(dbStub, barcodeStub, consumeStub))
describe('ShipmentService.openBoxByScan', () => {
  it('issued 송장 스캔 시 박스를 open 하고 송장을 used 로, FO 미출고 FOI 를 라인으로 미러한다', async () => {
    // given: invoice{status:issued, issuedForFO:'fo-1', shipmentId:null}, FO{warehouseId:'wh-1'},
    //   FOI[{id:'foi-1', skuId:'sku-1', qty:3, shippedQty:0}]
    const result = await service.openBoxByScan('TRACK-1', 'op-1');
    expect(shipmentInsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'open', openedBy: 'op-1', openedForFulfillmentOrderId: 'fo-1', warehouseId: 'wh-1',
    }));
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'used' /* + shipmentId */ }));
    expect(lineInsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ fulfillmentOrderItemId: 'foi-1', skuId: 'sku-1', qty: 3, inspectedQty: 0 }),
    ]));
    expect(result.shipmentId).toBeDefined();
  });

  it('이미 used/voided 송장은 ConflictException', async () => {
    // invoice.status='used'
    await expect(service.openBoxByScan('TRACK-USED', 'op-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('shippedQty 만큼 차감한 잔량을 라인 qty 로 미러한다(부분출고 방어)', async () => {
    // FOI{qty:5, shippedQty:2} → line.qty=3
    await service.openBoxByScan('TRACK-1', 'op-1');
    expect(lineInsert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ qty: 3 })]));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern="shipment.service.spec" --silent 2>&1 | tail -20`
Expected: FAIL — ShipmentService/openBoxByScan 없음.

- [ ] **Step 3: ShipmentService 골격 + openBoxByScan 구현**

```ts
@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    private readonly barcode: BarcodeService,
    private readonly outboundConsumption: OutboundConsumptionService,
  ) {}

  async openBoxByScan(trackingNo: string, operatorId?: string, tx?: DbTx): Promise<{ shipmentId: string }> {
    return this.db.run(async (trx) => {
      // 송장 잠그고 검증
      const [invoice] = await trx
        .select({ id: wmsTables.invoices.id, foId: wmsTables.invoices.issuedForFulfillmentOrderId, status: wmsTables.invoices.status, shipmentId: wmsTables.invoices.shipmentId })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.trackingNo, trackingNo))
        .for('update')
        .limit(1);
      if (!invoice) throw new NotFoundException(`운송장번호 ${trackingNo} 송장 없음`);
      if (invoice.status !== 'issued') throw new ConflictException(`송장 ${trackingNo} 는 이미 ${invoice.status} 상태 (박스 open 불가)`);

      const [fo] = await trx
        .select({ id: wmsTables.fulfillmentOrders.id, warehouseId: wmsTables.fulfillmentOrders.warehouseId, mode: wmsTables.fulfillmentOrders.fulfillmentMode })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, invoice.foId))
        .limit(1);
      if (!fo?.warehouseId) throw new ConflictException(`FO ${invoice.foId} 에 warehouseId 없음 (박스 open 불가)`);
      if (fo.mode === 'drop_ship') throw new ConflictException(`drop_ship FO 는 박스 스캔 경로를 타지 않습니다`);

      const [shipment] = await trx
        .insert(wmsTables.shipments)
        .values({ status: 'open', openedBy: operatorId ?? null, openedForFulfillmentOrderId: fo.id, warehouseId: fo.warehouseId, openedAt: new Date() })
        .returning({ id: wmsTables.shipments.id });

      await trx.update(wmsTables.invoices).set({ shipmentId: shipment.id, status: 'used' }).where(eq(wmsTables.invoices.id, invoice.id));

      const items = await trx
        .select({ id: wmsTables.fulfillmentOrderItems.id, skuId: wmsTables.fulfillmentOrderItems.skuId, qty: wmsTables.fulfillmentOrderItems.qty, shippedQty: wmsTables.fulfillmentOrderItems.shippedQty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
      const lines = items
        .map((it) => ({ shipmentId: shipment.id, fulfillmentOrderItemId: it.id, skuId: it.skuId, qty: it.qty - it.shippedQty, inspectedQty: 0, forced: false }))
        .filter((l) => l.qty > 0);
      if (lines.length > 0) {
        await trx.insert(wmsTables.shipmentLines).values(lines).onConflictDoNothing({ target: [wmsTables.shipmentLines.shipmentId, wmsTables.shipmentLines.fulfillmentOrderItemId] });
      }
      this.logger.log(`Opened box ${shipment.id} for FO ${fo.id} (${lines.length} line(s)) via scan ${trackingNo}`);
      return { shipmentId: shipment.id };
    }, tx);
  }
}
```

- [ ] **Step 4: GREEN**

Run: `npx jest --testPathPattern="shipment.service.spec" --silent 2>&1 | tail -15`
Expected: PASS (openBoxByScan 3 케이스).

---

## Task 8 (TDD): ShipmentService.inspectScan — 검수 누적 + 자동완료 트리거

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/shipment.service.spec.ts`

검수 스캔: 박스 `FOR UPDATE` → 바코드→skuId 로 라인 resolve → `inspectedQty += quantity`(qty 상한) → 박스 전 라인 `inspectedQty>=qty` 면 같은 tx 안에서 `consumeShipment` 자동 발사. 더블파이어 방지 = 박스 락.

- [ ] **Step 1: 실패 테스트**

```ts
describe('ShipmentService.inspectScan', () => {
  it('스캔한 sku 라인의 inspectedQty 를 누적하되 박스가 미완료면 consume 하지 않는다', async () => {
    // given: box(open) lines[{sku-1, qty:3, inspectedQty:0}, {sku-2, qty:1, inspectedQty:0}]
    await service.inspectScan('ship-1', 'BARCODE-SKU1', 1, 'op-1');
    expect(lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ inspectedQty: 1 }));
    expect(consume.consumeShipment).not.toHaveBeenCalled();          // sku-2 미검수
  });

  it('마지막 라인까지 검수 완료되면 같은 tx 에서 consumeShipment 자동 발사', async () => {
    // given: box lines[{sku-1, qty:3, inspectedQty:2}] (마지막 1개)
    await service.inspectScan('ship-1', 'BARCODE-SKU1', 1, 'op-1');
    expect(lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ inspectedQty: 3 }));
    expect(consume.consumeShipment).toHaveBeenCalledWith('ship-1', expect.anything());
  });

  it('open 아닌 박스 스캔은 ConflictException', async () => {
    // box.status='shipped'
    await expect(service.inspectScan('ship-shipped', 'BARCODE-SKU1', 1, 'op-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('inspectedQty 는 qty 를 초과하지 않는다', async () => {
    // line{qty:3, inspectedQty:2}, quantity:5 → inspectedQty:3
    await service.inspectScan('ship-1', 'BARCODE-SKU1', 5, 'op-1');
    expect(lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ inspectedQty: 3 }));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern="shipment.service.spec" --silent 2>&1 | tail -20`
Expected: FAIL — inspectScan 없음.

- [ ] **Step 3: 구현**

```ts
async inspectScan(shipmentId: string, barcode: string, quantity = 1, operatorId?: string, tx?: DbTx): Promise<void> {
  return this.db.run(async (trx) => {
    const [box] = await trx
      .select({ id: wmsTables.shipments.id, status: wmsTables.shipments.status })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .for('update')                                  // 더블파이어 방지 락
      .limit(1);
    if (!box) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    if (box.status !== 'open') throw new ConflictException(`박스 ${shipmentId} 는 ${box.status} 상태 (검수 불가)`);

    const skuId = await this.resolveSkuFromBarcode(barcode, trx);    // 바코드→sku (private; BarcodeService 활용)
    const lines = await trx
      .select({ id: wmsTables.shipmentLines.id, skuId: wmsTables.shipmentLines.skuId, qty: wmsTables.shipmentLines.qty, inspectedQty: wmsTables.shipmentLines.inspectedQty })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
    // 미완료(inspectedQty<qty) 라인 우선, 같은 sku.
    const target = lines.filter((l) => l.skuId === skuId).sort((a, b) => (a.inspectedQty - a.qty) - (b.inspectedQty - b.qty))[0];
    if (!target) throw new ConflictException(`박스 ${shipmentId} 에 sku ${skuId} 라인 없음`);

    const next = Math.min(target.qty, target.inspectedQty + quantity);
    await trx.update(wmsTables.shipmentLines).set({ inspectedQty: next }).where(eq(wmsTables.shipmentLines.id, target.id));

    // 자동완료: 갱신 후 전 라인 inspectedQty>=qty 면 종결.
    const fresh = lines.map((l) => (l.id === target.id ? { ...l, inspectedQty: next } : l));
    if (fresh.every((l) => l.inspectedQty >= l.qty)) {
      await this.outboundConsumption.consumeShipment(shipmentId, trx);
    }
  }, tx);
}
```
`resolveSkuFromBarcode(barcode, trx)` — 구 inspection.service 의 `resolveFoiFromBarcode`(svc:1032-1093) 에서 **sku 해석 부분만** 포팅(FOI/세션 의존 제거): `barcodeService.parseBarcode` → SKU 바코드/skuCode 폴백으로 skuId 반환.

- [ ] **Step 4: GREEN**

Run: `npx jest --testPathPattern="shipment.service.spec" --silent 2>&1 | tail -15`
Expected: PASS.

---

## Task 9 (TDD): ShipmentService.forceShipment — 강제출고(override)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/shipment.service.spec.ts`

강제출고: 막힌 박스의 유일한 override. 대상 라인(또는 박스 전체) `inspectedQty:=qty, forced=true` → 같은 자동완료 게이트(consume). 작업자 누구나, 사유 없음.

- [ ] **Step 1: 실패 테스트**

```ts
describe('ShipmentService.forceShipment', () => {
  it('박스 전체 강제 시 모든 라인 inspectedQty:=qty, forced=true 후 consume', async () => {
    // box lines[{qty:3, inspectedQty:1}, {qty:1, inspectedQty:0}]
    await service.forceShipment('ship-1', undefined, 'op-1');
    expect(lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ forced: true /* inspectedQty=qty */ }));
    expect(consume.consumeShipment).toHaveBeenCalledWith('ship-1', expect.anything());
  });

  it('foiId 지정 시 해당 라인만 강제(나머지 미완료면 consume 안 함)', async () => {
    // box lines[{foi-1, qty:3, inspectedQty:0}, {foi-2, qty:1, inspectedQty:0}]
    await service.forceShipment('ship-1', 'foi-1', 'op-1');
    expect(consume.consumeShipment).not.toHaveBeenCalled();          // foi-2 미완료
  });

  it('open 아닌 박스는 ConflictException', async () => {
    await expect(service.forceShipment('ship-shipped', undefined, 'op-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx jest --testPathPattern="shipment.service.spec" --silent 2>&1 | tail -20` → FAIL.

- [ ] **Step 3: 구현**

```ts
async forceShipment(shipmentId: string, foiId: string | undefined, operatorId?: string, tx?: DbTx): Promise<void> {
  return this.db.run(async (trx) => {
    const [box] = await trx.select({ id: wmsTables.shipments.id, status: wmsTables.shipments.status }).from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId)).for('update').limit(1);
    if (!box) throw new NotFoundException(`Shipment ${shipmentId} not found`);
    if (box.status !== 'open') throw new ConflictException(`박스 ${shipmentId} 는 ${box.status} 상태 (강제출고 불가)`);

    const lines = await trx.select({ id: wmsTables.shipmentLines.id, foiId: wmsTables.shipmentLines.fulfillmentOrderItemId, qty: wmsTables.shipmentLines.qty }).from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
    const targets = foiId ? lines.filter((l) => l.foiId === foiId) : lines;
    if (targets.length === 0) throw new ConflictException(`박스 ${shipmentId} 에 대상 라인 없음`);
    this.logger.warn(`FORCED SHIPMENT box=${shipmentId} foi=${foiId ?? 'ALL'} by ${operatorId ?? 'unknown'}`);
    for (const t of targets) {
      await trx.update(wmsTables.shipmentLines).set({ inspectedQty: t.qty, forced: true }).where(eq(wmsTables.shipmentLines.id, t.id));
    }
    const updated = lines.map((l) => (targets.some((t) => t.id === l.id) ? { ...l, inspectedQty: l.qty } : l));
    if (updated.every((l) => l.inspectedQty >= l.qty)) {
      await this.outboundConsumption.consumeShipment(shipmentId, trx);
    }
  }, tx);
}
```
(라인 inspectedQty 를 위에서 미러하려면 select 에 inspectedQty 포함 — `updated` 계산용. 위 select 에 `inspectedQty` 추가.)

- [ ] **Step 4: GREEN** — Run: `npx jest --testPathPattern="shipment.service.spec" --silent 2>&1 | tail -15` → PASS.

---

## Task 10 (M): ShipmentController + inspection.service/controller 삭제

**Files:**
- Create: `apps/core/src/modules/fulfillment/controllers/shipment.controller.ts`
- Delete: `inspection.service.ts`, `inspection.controller.ts`, `inspection.service.spec.ts`

- [ ] **Step 1: ShipmentController 작성**

```ts
@Controller('shipments')
export class ShipmentController {
  constructor(private readonly shipments: ShipmentService) {}

  // 송장(운송장번호) 스캔 → 박스 open
  @Post('scan')
  async scan(@Body() dto: { trackingNo: string }, @User() user?: AuthUser) {
    return this.shipments.openBoxByScan(dto.trackingNo, this.userId(user));
  }

  // 상품 바코드 스캔 → 검수 누적(+자동완료)
  @Post(':id/inspect-scan')
  async inspect(@Param('id') id: string, @Body() dto: { barcode: string; quantity?: number }, @User() user?: AuthUser) {
    await this.shipments.inspectScan(id, dto.barcode, dto.quantity ?? 1, this.userId(user));
    return { ok: true };
  }

  // 강제출고(override)
  @Post(':id/force')
  async force(@Param('id') id: string, @Body() dto: { foiId?: string }, @User() user?: AuthUser) {
    await this.shipments.forceShipment(id, dto.foiId, this.userId(user));
    return { ok: true };
  }

  private userId(user?: AuthUser): string | undefined { return user?.id ?? user?.userId ?? user?.sub; }
}
```
> `@User()`/`AuthUser` 데코레이터는 `fulfillments.controller.ts` 의 패턴(getUserId, `:166-168`)을 따른다. 검수는 이제 **인증 operator → openedBy** 로 작업자 귀속(구 inspection 의 body `inspectorUserId` 의존 탈피). Zod 검증은 기존 컨트롤러 스타일대로 추가(선택).

- [ ] **Step 2: inspection 파일 삭제**

```bash
git rm apps/core/src/modules/fulfillment/services/inspection.service.ts \
       apps/core/src/modules/fulfillment/controllers/inspection.controller.ts \
       apps/core/src/modules/fulfillment/services/inspection.service.spec.ts
```
`inspection_issues` 로깅이 필요하면 ShipmentService 에 `logInspectionIssue(shipmentId, foiId, issue)` 로 최소 포팅(선택 — A 핵심 경로 아님).

- [ ] **Step 3: 빌드** — Run: `nest build core 2>&1 | grep -i "inspection\|error TS" | head` — inspection import 잔재 없는지. 잔재(다른 모듈이 InspectionService import)면 Task 11 에서 정리.

---

## Task 11 (M): 모듈 배선 · 컨트롤러 라우트 은퇴 · DTO

**Files:**
- Modify: `fulfillment.module.ts`, `fulfillments.controller.ts`, `invoice.controller.ts`
- Delete: `dto/assign-shipment.dto.ts`
- Modify: `dto/fulfillment-order-response.dto.ts`

- [ ] **Step 1: 모듈 배선** — `fulfillment.module.ts`

`InspectionService`·`InspectionController` 를 providers/controllers 에서 제거. `ShipmentService`·`ShipmentController` 추가. `OutboxService`(이미 등록) 가 `OutboundConsumptionService` 에 주입되는지 확인. `BarcodeService` 가 ShipmentService 에 주입되는지 확인.

- [ ] **Step 2: fulfillments.controller — ship·assign-shipment 라우트 제거** — `fulfillments.controller.ts:45-58`

`POST :id/ship`(53-58)·`POST :id/assign-shipment`(45-51) 핸들러 삭제. `AssignShipmentDto` import 제거. (markDelivered `POST :id/deliver` 는 유지.)

- [ ] **Step 3: assign-shipment.dto 삭제 + 응답 DTO 수정**

```bash
git rm apps/core/src/modules/fulfillment/dto/assign-shipment.dto.ts
```
`fulfillment-order-response.dto.ts:86,89` 의 `trackingNo`/`carrier` 는 유지하되 출처가 active invoice(getOne join, Task 6 Step 3)임을 주석. `:14` `carrierCode` → `carrier` 정합.

- [ ] **Step 4: direct-ship.service 확인** — `direct-ship.service.ts:329-331`

`markOrdersAsCompleted` 가 `fulfillmentsService.ship(fo.id, tx)` 호출 — ship() 이 이제 drop_ship 전용이므로 **그대로 동작**(drop_ship FO 만 호출). 변경 불필요. 단 spec(`direct-ship.service.spec.ts`)이 ship() mock 을 쓰면 그대로 통과.

- [ ] **Step 5: 빌드 클린** — Run: `nest build core 2>&1 | tail -20` → **에러 0**. 남은 옛 컬럼/테이블/메서드 참조를 전부 해소. (참고: `inspection`·`assignShipment`·`markAsShipped`·`invoiceNumber`·`carrierCode`·`goodsflowServiceId`·`trackingNo on shipments` 전수 grep.)
```bash
grep -rn "inspectionSessions\|inspectionItems\|assignShipment\|markAsShipped\|invoices.invoiceNumber\|invoices.carrierCode\|goodsflowServiceId\|shipments.trackingNo\|shipments.carrier" apps/core/src --include=*.ts | grep -v ".spec.ts"
```
Expected: 빈 결과(테스트 제외).

---

## Task 12 (M): 기존 단위 spec 전수 GREEN + 커밋

**Files:**
- Modify: 영향받은 모든 `*.spec.ts` (위 태스크에서 부분 갱신됨)

- [ ] **Step 1: 영향 spec 좁혀 실행**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=6144 npx jest --testPathPattern="fulfillment/(services|controllers)/(shipment|outbound-consumption|fulfillments|invoice|direct-ship)" --silent 2>&1 | tail -30
```
Expected: 전부 PASS. 실패 잔재(옛 컬럼/메서드 mock)를 갱신.

- [ ] **Step 2: 타입체크 최종** — Run: `nest build core 2>&1 | tail -5` → 클린.

- [ ] **Step 3: 커밋** (스키마+코드+마이그레이션 한 커밋 — CLAUDE.md DB 규칙)

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle apps/core/src/modules/fulfillment
git commit -m "feat(outbound): Cluster A 상자 워크플로 — 송장 스캔 박스 open·검수 자동완료 소진

- 검수 영속 붕괴: inspection_sessions/items → shipment/shipment_line, inspection_issues 유지
- shipment_line{inspectedQty,forced}, write-ownership 역전(FOI.shippedQty consume-driven)
- invoice FK 뒤집기(invoice.shipmentId + active 부분 unique), 컬럼 RFC 어휘 리네임
- 자동완료 소진 트리거, 박스 lazy 생성, 명시적 ship/assignShipment/markAsShipped 은퇴

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13 (M): 통합 spec 갱신 (skip 유지) + outbound-consumption 통합

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/outbound-consumption.integration.spec.ts`

> dev 환경 삭제로 실행 불가 → `describeIfDb` skip 유지. **새 모델로 갱신만** 해 DB 복구 시 실증 가능하게(통합검증 빚, RFC carry-forward).

- [ ] **Step 1: 셋업 갱신** — `outbound-consumption.integration.spec.ts:140` 등

shipment INSERT 를 새 컬럼(`warehouseId`, `openedForFulfillmentOrderId`, `status:'open'`)으로. shipment_line 에 `inspectedQty`/`forced`. `ensureShipmentLines` 호출 제거(폐기). `consumeShipment` 가 ledger + FOI.shippedQty 누적 + 박스 shipped 까지 함을 검증. ShipmentService.openBoxByScan→inspectScan(자동완료) end-to-end 케이스 추가(skip 채로).

- [ ] **Step 2: 성공 기준 주석화** — "상자 N개 출고 → on_hand N↓·available 불변·SHIP 1건/라인·작업자 journal 귀속" 어서션이 DB 복구 시 통과하도록.

- [ ] **Step 3: skip 확인** — Run: `npx jest --testPathPattern="outbound-consumption.integration" --silent 2>&1 | tail -5` → `describe.skip` 로 0 실행(green/skipped).

---

## Task 14: 문서 갱신 + 최종 검증

**Files:**
- Modify: `docs/outbound-shipment-ledger-rfc.md` (Progress 표)

- [ ] **Step 1: RFC Progress 갱신** — Phase 2 클러스터 A 행을 `🟩 구현·develop 머지(통합 미검증)` 로, 구현 요약·통합 빚 명시.

- [ ] **Step 2: lint** — Run: `NODE_OPTIONS=--max-old-space-size=6144 npm run lint -- apps/core/src/modules/fulfillment 2>&1 | tail -10` (스펙 `any`-mock lint·`inventory.schema.ts` unused import 은 repo baseline — 무시).

- [ ] **Step 3: 최종 빌드** — Run: `nest build core 2>&1 | tail -3` → 클린.

- [ ] **Step 4: 문서 커밋**
```bash
git add docs/outbound-shipment-ledger-rfc.md docs/superpowers/plans/2026-06-30-cluster-a-box-workflow.md
git commit -m "docs(outbound): Cluster A 구현 반영 — RFC Progress 갱신

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (spec coverage)

RFC §Phase 2 (클러스터 A) 8항목 ↔ 태스크 매핑:

| RFC #항목 | 태스크 |
|---|---|
| 1. 검수 영속 붕괴(sessions/items→shipment/line, issues 유지) | Task 1.5, 10.2 |
| 2. shipment_line{qty,inspectedQty,forced}, approved/rejected 폐기 | Task 1.3 |
| 3. write-ownership 역전(검수→inspectedQty, FOI.shippedQty consume-driven) | Task 5.3, 8 |
| 4. invoice.shipmentId FK + active 부분 unique, trackingNo/carrier 이주 | Task 1.4, 3, 6.3 |
| 5. 소진 트리거=자동완료, 명시적 ship 엔드포인트 은퇴 | Task 8, 4, 6, 11.2 |
| 6. 박스 lazy 생성(스캔), issueInvoice/assignShipment 박스 upsert 제거 | Task 3.2, 6.2, 7 |
| 7. shipment status 확장(open/shipped/canceled), warehouseId/openedForFO denormalize | Task 1.1-1.2 |
| 8. 멱등·동시성(박스 FOR UPDATE, consume 멱등) | Task 5.3, 8.3, 9.3 |

부수: drop_ship 가드(Task 6, 7.3) · dead 중복경로 미접촉(B) · 통합 빚(Task 13).

**미해결(잔가지, 구현 중 결정):**
- 검수 스캔 바코드→sku resolve 세부: 구 `resolveFoiFromBarcode` 의 sku 부분 포팅(Task 8.3). FOI 가 같은 sku 를 2라인 가지면 미완료 우선 정렬로 결정.
- shipment 배송추적(in_transit/delivered) 출처: A 핵심 밖 — `markDelivered`(기존) 유지, 별도.
