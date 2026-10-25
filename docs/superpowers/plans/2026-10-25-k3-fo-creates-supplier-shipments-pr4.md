# K3 PR 4 — FO 생성이 입점사 상자를 만든다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매주문 하나에 FO 하나를 만들고, 그 안에서 창고분은 창고 draft 상자로, 직배분은 **입점사마다 draft 상자 하나**로 가른다(«섞이면 거절» 제거). 읽는 쪽(투영·정체 보드·K6 수량 사실·판매주문 단계·직배 목록)을 FO 모드가 아니라 상자 주인으로 판정하게 옮긴다. **동작은 휴면이다** — 직배 SKU 가 라이브 0 이고 발송 명령은 PR 5 다.

**Architecture:** 생성은 `createV2` 한 경로다. SKU 의 `stock_type` 으로 FOI 를 창고분·직배분으로 나누고, 직배분은 SKU 의 직배 공급사(PR 2 규칙상 정확히 하나)로 묶어 `openShipment({ owner: { kind: 'supplier', … } })` 로 연다. 입점사 상자 라인은 예약하지 않는다. 투영(`reprojectFulfillmentOrders`)은 입점사 상자 라인 수량을 «예약된 것과 같다»로 세고, «덜 예약된 상자»의 정의(`shipmentReservationTotalsSql`)는 입점사 상자를 0 으로 센다 — 이 두 곳을 고치면 FO 상태·보드 «예약» 단계·재고 부족 읽기가 같이 맞는다. 입점사 상자의 단계(대기·넘김·발송)는 `supplier-shipment-stage.ts` 한 곳이 정의하고 SQL 읽기는 같은 술어를 쓴다. 옛 FO 단위 직배 생성 경로와 그 읽기 갈래는 지운다(라이브 0, Task 0).

**Tech Stack:** NestJS(core), Drizzle(raw `sql` 포함), Postgres, Jest(unit + `DATABASE_URL` 통합).

**Spec:** `docs/superpowers/specs/2026-10-25-k3-drop-ship-supplier-shipments-design.md` (§4.3-1, §4.5, §4.6 «판매주문 단계·정체 보드·수량 사실», §4.8, §4.9 «대기», §7 PR 4). ADR `docs/adr/0050-drop-ship-is-a-supplier-shipment.md`. 형식 본보기: `docs/superpowers/plans/2026-10-25-k3-supplier-shipments-expand-pr2.md`(그 계획의 «다음 PR 에 넘기는 것 — PR 4» 를 이 계획이 받는다).

## 이름 붙은 결정 (⛔ 사용자 확인)

- **N1. 새 FO 의 `fulfillment_mode` 는 `'in_house'`(DTO 기본값)다. 생성 DTO 는 `'drop_ship'` 을 받지 않는다**(`@IsIn(['in_house', '3pl'])` → 400). ADR-0050 §2 «새 FO 에 `drop_ship` 모드를 쓰지 않는다». 그 값을 넘기는 호출자는 저장소에 없다(백로그 워커는 안 넘기고, admin-web 은 조회 필터로만 쓴다).
- **N2. 직배분만 있는 주문의 FO `warehouse_id` 는 NULL.** 창고 몫이 없으니 창고가 없다. 창고 필수·판매 창고 검증(`assertWarehouseSellable`)은 창고 몫이 있을 때만. 기존 «직배만» spec 이 이미 `warehouseId: null` 을 단언한다(`shipment-reservation.integration.spec.ts:241`).
- **N3. 입점사를 못 정하면 fail-closed.** 직배 SKU 의 직배 공급사 연결이 0 개 또는 2 개 이상이면 400 `DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED`(응답에 `skuIds`). 백로그는 `failed` 로 남아 보드 «fo» 단계에 뜬다(스펙 §4.2). 연결은 공급사 행을 `FOR SHARE` 로 읽는다 — PR 2 의 잠금 규칙(공급사 쪽은 `FOR UPDATE` 먼저)과 짝이라 «직배 아님» 전환과 엇갈리지 않는다.
- **N4. 투영은 입점사 상자 라인을 «예약된 것과 같다»로 센다.** FOI 입력에 `supplierLineQty` 를 더하고, 준비 판정을 `confirmedReservedQty + supplierLineQty` 로 한다. `foi.reserved_qty`·`fo.total_reserved_qty` 에는 **확정 예약만** 쓴다 — 입점사 몫을 예약으로 기록하면 예약 합계가 재고 원장과 어긋난다. 결과: 창고분이 다 예약되고 직배분만 남은 FO = `ready`, 직배분만 = `ready`, 창고분 예약 0 + 직배분 = `partially_reserved`.
- **N5. «덜 예약된 상자»의 정의에서 입점사 상자는 `unreserved_qty = 0`.** `shipmentReservationTotalsSql` 한 곳을 고친다. 보드 판정과 재고 부족 읽기(`ReserveShortageReader`)가 이 정의를 같이 읽으므로 둘 다 맞는다.
- **N6. 입점사 상자 단계 = `pending`(draft·넘김 없음) / `forwarded`(draft 또는 recovery_required, 넘김 있음) / `shipped`.** canceled·superseded 는 단계가 없다(`null`). 그 밖의 상태(planned·in_transit·delivered·failed)는 입점사 상자가 쓰지 않는 전이라 `Error`. TS 정의는 `fulfillment/shipment/supplier-shipment-stage.ts` 하나이고, SQL 읽기(K6 수량 사실·보드·직배 목록·채널 주소 변경)는 같은 술어를 쓰며 주석으로 그 파일을 가리킨다.
- **N7. 정체 보드는 입점사 상자를 상자 단위로 판정한다.** 복구 코드 갈래(`cancel_replan`·`consolidation`·`recovery_unknown`)가 먼저 잡고, 그다음 입점사 상자:
  못 보냄 라인이 있음 → `dispatch`/`drop_ship_unfulfillable`(**즉시 갇힘**, 진입 = 가장 이른 보고 시각) · 넘김 없음 → `dispatch`/`drop_ship_pending`(진입 = `opened_at`) · 넘김 → `track`/`drop_ship_forwarded`(진입 = 묶음 `created_at`) · `shipped` → `done`(배송완료 감지가 없다, 스펙 §4.6). 상자별 결과(`judgedShipmentsSql`)에도 이 값이 나오지만 `SHIPMENT_STATES` 에는 넣지 않는다 — 겨누는 상자 규칙이 아직 없다.
- **N8. 옛 FO 단위 직배의 «읽기» 갈래는 지운다** — `fulfillment_mode = 'drop_ship'`·`direct_ship_status` 를 읽는 보드·K6 수량 사실·판매주문 단계·관리자 필터/카운트·채널 주소 변경·라인 구성 편집. 라이브 0 이고(Task 0) 이 PR 뒤로는 새로 생기지 않는다. **옛 쓰기 경로와 그 화면용 읽기**(`direct-ship.service.ts` 전부, `ship()`, `computeAdminAvailableActions`)와 칸은 그대로 둔다 — PR 5·8.
- **N9. 직배 목록 = 새 읽기 `SupplierShipmentQueueReader` + GET 둘.** `GET /direct-ship/supplier-queue`(입점사별 대기·넘김 상자 수, 못 보냄 라인 수), `GET /direct-ship/supplier-queue/:supplierId/shipments?stage=pending|forwarded`(상자와 라인). 권한 `fulfillment.order.read`. **고객 개인정보를 담지 않는다** — 수령인은 PR 5 의 내려받기에만(그래서 `@PiiResponse` 없음). 발송된 상자 목록은 넘김 묶음 화면(PR 5·7)의 일이라 여기 없다.
- **N10. 라인 구성 편집은 입점사 상자 라인에 계속 막힌다**(`DROP_SHIP_NOT_SUPPORTED`). 판별만 FO 모드에서 «그 라인의 FOI 가 열린 입점사 상자에 있다»로 바꾼다.
- **N11. 채널 주소 변경 거절(`hasDropShipInProgress`) = 그 주문에 넘긴 열린 입점사 상자가 있다.** 발송된 입점사 상자는 `isFullyShipped`·남은 상자 목록이 이미 다룬다.

## Global Constraints

- **마이그 없음.** PR 2 의 칸·인덱스(`idx_shipments_supplier_status`, `idx_shipment_lines_fulfillment_order_item`)로 충분하다. 새 인덱스가 필요해 보이면 멈추고 사용자에게 묻는다.
- 이벤트 계약(`packages/event-contracts/**`)·발송·넘김·올리기·취소 경로·admin-web 은 손대지 않는다. `CONSUMER_ROLLOUT_CARRIERS` 도 그대로(PR 5).
- 입점사 상자는 창고 흐름에 들어가지 않는다 — 예약(`reservePartial`)을 부르지 않고, `warehouseIdOf` 가드 목록(`supplier-shipment-entry.guard.spec.ts`)을 줄이지 않는다.
- FO·FOI status 는 `reprojectFulfillmentOrders` 만 쓴다. `fulfillment-order-status-writes.guard.spec.ts` 의 허용 파일 목록은 그대로이고 주석만 고친다(생성 쪽 예외가 없어진다).
- 트랜잭션·쿼리 규칙(ADR-0025, CLAUDE.md Inventory): `tx` 전파, `db.query.*`·`with`·`any`/`as` 금지(raw `execute` 결과 캐스트는 기존 파일과 같은 문서화된 캐스트만).
- 에러는 `ApplicationException` 하위 클래스(선례 `fulfillment/shipment/shipment-owner.ts`).
- 새 라우트는 `@RequirePermission` 을 단다(`route-classification.spec.ts`). 응답 DTO 는 중첩 클래스로(`@ApiProperty({ type: 'object' })` 금지).
- 통합 테스트: 스크래치 DB `k3_pr2_it`(PR 2 마이그까지 적용됨). `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k3_pr2_it npx jest --runInBand --runTestsByPath <파일…>`. 꺼져 있으면 `docker start almondyoung-server-postgres-1`. develop 에 새 마이그가 생겼으면 먼저 `DATABASE_URL=… npx drizzle-kit migrate --config apps/core/drizzle.config.ts`.
- 기준선: 브랜치 시작 때 `k3_pr2_it` 에서 `apps/core/src/modules/fulfillment apps/core/src/modules/sales-order` 의 `*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다.
- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0, 통합 기준선 외 실패 0.

## Review Focus

- **섞인 주문의 창고 상자 배송 프로필** — 직배 SKU 는 프로필이 없다(PR 2 이전부터). 창고 상자의 `shipping_profile_id` 는 **창고 SKU 만으로** 정해야 한다. 지금 코드는 전 SKU 로 정해서 직배 SKU 가 하나만 섞여도 NULL 이 된다. Task 2 케이스.
- **입점사를 못 정한 생성의 되돌림** — `DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED` 로 실패하면 FO·상자뿐 아니라 그 전에 굳힌 라인 구성(`freezeFromMatching`)도 남지 않아야 한다(백로그 워커의 savepoint). Task 2 케이스.
- **창고분 재고가 0 인 섞인 주문** — FO `partially_reserved`, 입점사 상자 라인은 그대로, 예약 재시도 워커 후보에 입점사 라인 없음. Task 2 케이스.
- **넘긴 입점사 상자 + 피킹 중인 창고 상자** — 보드 대표 단위는 더 뒤처진 창고 `pick` 이다. Task 4 케이스.
- **한 입점사 상자에 «못 보냄» 라인과 정상 라인이 섞임** — 상자는 `drop_ship_unfulfillable`(넘김 여부와 무관). Task 4 케이스.

---

## 배포

- 배포 단위: **Core 만**, 마이그 없음. 순서 제약 없음(PR 3 라이브는 2026-10-25 태그 `deploy/live/20261025-1717` 로 끝났다).
- 롤백: PR 3 의 Core 로 되돌려도 안전하다 — 단, **직배 SKU 가 0 인 동안만**이다. 입점사 상자가 하나라도 생긴 뒤 되돌리면 옛 투영·읽기가 그 상자를 예약 부족 창고 상자로 본다. 개통(첫 직배 SKU 등록)은 PR 1~7 라이브 뒤다(스펙 §7).

---

### Task 0: 착수 전 라이브 실측 (사용자 터널)

**Files:** 없음(결과는 PR 본문에).

- [ ] **Step 1: 사용자에게 터널을 부탁한다** — `npx sst tunnel --stage live`. 터널은 사용자가 띄운다.
- [ ] **Step 2: 읽기 전용으로 잰다**

```sql
SELECT count(*) AS drop_ship_fo FROM fulfillment_orders WHERE fulfillment_mode = 'drop_ship';
SELECT count(*) AS drop_ship_status_fo FROM fulfillment_orders WHERE direct_ship_status IS NOT NULL;
SELECT count(*) AS drop_skus FROM skus WHERE stock_type = 'drop_shipped' AND NOT is_deleted;
SELECT count(*) AS supplier_shipments FROM shipments WHERE supplier_id IS NOT NULL;
```

Expected: 넷 다 0. 하나라도 0 이 아니면 **멈추고 사용자에게 보고한다** — N8(옛 읽기 갈래 삭제)과 N3(fail-closed) 의 전제다.

### Task 1: 투영이 입점사 상자 라인을 «예약된 것과 같다»로 센다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-progress.service.ts` — 입력 칸과 준비 판정
- Modify: `apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.ts` `readItemInput` — 활성 라인 조회에 `shipments.supplierId`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` `getOne` 의 진행 조립(:718 근처) — 같은 칸을 채운다(라인 조회에 `supplierId`)
- Modify: `apps/core/src/modules/fulfillment/dto/fulfillment-order-response.dto.ts` — 진행 DTO 에 `supplierLineQty`
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-progress.service.spec.ts`, `apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-projection.integration.spec.ts`

**Interfaces:**
- Produces: `FulfillmentOrderItemProgressInput.supplierLineQty: number` — 주석 «입점사 상자의 활성 라인 수량(`activeLineQty` 에 포함). 창고 예약 대상이 아니라 예약된 것과 같이 센다(K3 §4.5). `confirmedReservedQty` 에는 넣지 않는다». `supplierLineQty > activeLineQty` 면 `BadRequestException`(다른 음수·정수 검사와 같은 방식).
  - 항목: `ready` ⇔ `confirmedReservedQty + supplierLineQty >= outstandingQty`, `partially_reserved` ⇔ 그 합 `> 0`. 주문 요약도 같은 합으로 판정한다. 요약의 `confirmedReservedQty` 는 확정 예약 합 그대로.

- [ ] **Step 1: 순수 spec** — `직배분만 남은 항목은 ready`(qty 2, supplierLineQty 2, 예약 0 → `ready`); `창고분 다 예약 + 직배 항목 → 주문 ready, 요약 confirmedReservedQty 는 창고 예약만`; `창고분 예약 0 + 직배 항목 → 주문 partially_reserved`; `supplierLineQty > activeLineQty 면 던진다`; 기존 케이스 전부 `supplierLineQty: 0` 으로 그대로 통과
- [ ] **Step 2: 통합 spec 에 더한다** — `입점사 상자 라인만 있는 FO 를 투영하면 FO ready, FOI reserved_qty 0, FO total_reserved_qty 0`(PR 2 fixture `seedDirectSupplier`·`seedBox({ supplierId })`); `창고 상자 전량 확정 예약 + 입점사 상자 → FO ready, total_reserved_qty = 창고 예약 합`. PR 1 의 «직배 FO 부분 감소 → created»(옛 FO, 상자 없음) 단언은 그대로 통과해야 한다
- [ ] **Step 3: 실패 확인** — `npx jest apps/core/src/modules/fulfillment/services/fulfillment-progress.service.spec.ts` → FAIL; 통합 spec → FAIL
- [ ] **Step 4: 구현** (Files 대로)
- [ ] **Step 5: 통과 확인** — 두 spec PASS, `npm run type-check` 에러 0
- [ ] **Step 6: Commit** — `git commit -m "K3 PR4 — 투영은 입점사 상자 라인을 예약된 것과 같이 센다"`

### Task 2: FO 생성이 입점사 상자를 만든다

**Files:**
- Create: `apps/core/src/modules/fulfillment/supplier-shipment/direct-suppliers-of-skus.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` — `createV2`(:96-252), `hasWarehouseControlledDemandPreflight`, `createFulfillmentOrderFromItems`(:276-357) **삭제**
- Modify: `apps/core/src/modules/fulfillment/dto/create-fulfillment-order.dto.ts:68-71` — N1
- Modify: `apps/core/src/modules/fulfillment/fulfillment-order/fulfillment-order-status-writes.guard.spec.ts:69` — 주석을 «옛 직배 `ship()` 'shipped' — K3 PR 5·8 이 걷는다. 줄어드는 방향만»으로
- Create: `apps/core/src/modules/fulfillment/services/fulfillments.supplier-shipments.integration.spec.ts` — 주문·SKU 시드는 `fulfillments.line-composition.integration.spec.ts:160-200`(두 라인 주문, 한 SKU 를 `drop_shipped` 로)을 본보기로
- Modify(옛 동작을 단언하던 spec): `services/shipment-reservation.integration.spec.ts:181-245`(`fulfillmentMode: 'drop_ship'` 입력·`drop_ship`/`ready` 단언), `services/fulfillments.line-composition.integration.spec.ts:165-200`(`V2_MIXED_DIRECT_AND_WAREHOUSE_FULFILLMENT`)

**Interfaces:**
- Produces:
  - `export async function directSuppliersOfSkus(tx: DbTx, skuIds: readonly string[]): Promise<Map<string, string>>` — SKU id → 직배 공급사 id. `sku_suppliers ⋈ suppliers WHERE is_direct_delivery`, 공급사 행 `FOR SHARE`. 연결 0 개·2 개 이상인 SKU 가 하나라도 있으면 `DropShippedSkuSupplierUnresolvedError`
  - `export class DropShippedSkuSupplierUnresolvedError extends ApplicationException` — `DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED`, 400, `details: { skuIds: string[] }`(응답 본문에 실리는지 기존 `ApplicationException` 의 details 규약을 따른다)
- `createV2` 의 새 순서(판매주문 잠금·기존 FO·셀메이트 출고·항목 만들기·굳히기·`validateSkuRows` 는 지금 그대로):
  1. 항목을 SKU `stock_type` 으로 가른다: `drop_shipped` = 직배분, 그 밖 = 창고분.
  2. 직배분이 있으면 `directSuppliersOfSkus` 로 입점사를 정한다(N3).
  3. 창고분이 있으면 `dto.warehouseId` 필수(`V2_PHYSICAL_FULFILLMENT_REQUIRES_WAREHOUSE`)·`validateWarehouseExists`. FO `warehouseId` = 창고분이 있을 때만 `dto.warehouseId`, 아니면 NULL(N2). `fulfillmentMode` = `dto.fulfillmentMode ?? 'in_house'`.
  4. FO·FOI 삽입은 지금 그대로(전 항목).
  5. 창고분이 있으면 창고 draft 상자 하나 — 배송 프로필은 **창고분 SKU 만**으로 `compatibleShippingProfileId`.
  6. 입점사마다 draft 상자 하나(입점사 id 순): `owner: { kind: 'supplier', supplierId }`, `shippingProfileId: null`, 수령인·공동현관 비번은 창고 상자와 같은 값. 라인은 그 입점사 SKU 의 FOI 들.
  7. 창고 상자 라인 예약은 지금 그대로(잠금 → `reservePartial` → `!mutated` 면 `recompute`). **입점사 상자는 5~6 에서 예약 전에 연다** — 예약이 부르는 투영이 입점사 라인을 보게.
  8. 창고분이 없으면 `reprojectFulfillmentOrders(trx, [fo.id])` 를 직접 부른다.
- `hasWarehouseControlledDemandPreflight` 앞의 `dto.fulfillmentMode !== 'drop_ship'` 조건은 없앤다.

- [ ] **Step 1: 통합 spec 을 쓴다** (`describeIfDb`, `wireLogistics` 의 `wired.fulfillments.create`)
  - `섞인 주문은 FO 하나에 창고 상자와 입점사 상자를 만든다` — 창고 SKU 1 + 입점사 A SKU 1: FO 1(`in_house`, `warehouseId` = 창고), 상자 2: 창고 상자(라인 = 창고 FOI, 확정 예약 = 재고만큼), 입점사 상자(`supplierId` A, `warehouseId` null, 라인 = 직배 FOI, 예약 행 0, `shippingProfileId` null, `recipientSnapshot`·`entrancePassword` = 창고 상자와 같음)
  - `입점사 둘이면 상자도 둘, 같은 입점사의 SKU 둘은 상자 하나` — A SKU 2개 + B SKU 1개 → 입점사 상자 2(A 라인 2, B 라인 1)
  - `직배분만이면 FO 창고 NULL, 입점사 상자만, FO ready` — `warehouseId` 를 넘겨도 FO 는 NULL
  - `창고분이 다 예약되면 섞인 FO 는 ready` / `창고분 재고 0 이면 partially_reserved` — 뒤엣것에서 `retryWorker.findCandidates(100, tx)` 에 입점사 라인 id 가 없다
  - `창고 상자의 배송 프로필은 창고 SKU 로만 정한다` — 창고 SKU 에 프로필 P, 직배 SKU 는 프로필 없음 → 창고 상자 `shippingProfileId === P`
  - `직배 공급사 연결이 없으면 DROP_SHIPPED_SKU_SUPPLIER_UNRESOLVED 이고 아무것도 남지 않는다` — 연결 행을 지운 뒤 savepoint 안에서 `create` → 그 에러(코드·`skuIds`), savepoint 밖에서 그 주문의 FO·상자·`sales_order_line_compositions` 0 행
  - `생성 DTO 는 drop_ship 모드를 거절한다` — `validate(plainToInstance(CreateFulfillmentOrderDto, { salesOrderId, fulfillmentMode: 'drop_ship' }))` 에 `fulfillmentMode` 에러(이 케이스는 같은 폴더 유닛 spec 에 둬도 된다)
  - `정합성 점검이 섞인 FO 를 위반으로 보지 않는다` — 생성 직후 `fulfillment-invariant.service.ts` 의 점검을 그 FO 에 돌려 `ACTIVE_LINE_QUANTITY` 위반 0
- [ ] **Step 2: 실패 확인** — 새 spec → FAIL(섞인 주문이 `V2_MIXED_DIRECT_AND_WAREHOUSE_FULFILLMENT`)
- [ ] **Step 3: 구현** (Interfaces 의 순서대로). `createFulfillmentOrderFromItems` 와 `V2_MIXED_DIRECT_AND_WAREHOUSE_FULFILLMENT` 는 저장소에서 사라진다(`grep -rn` 으로 0 확인)
- [ ] **Step 4: 옛 spec 을 새 동작으로 고친다** — «직배만»은 위 새 케이스가 대신하므로 옛 케이스는 지우거나 `mode: in_house`·입점사 상자 단언으로 바꾼다. `fulfillmentMode: 'drop_ship'` 을 넘기던 디지털 전용 케이스(:191)는 모드 없이
- [ ] **Step 5: 통과·회귀** — 새 spec PASS, `npm run type-check` 에러 0, `npx jest apps/core/src/modules/fulfillment` PASS, fulfillment 통합 기준선 비교 → 새 실패 0
- [ ] **Step 6: Commit** — `git commit -m "K3 PR4 — FO 생성이 입점사마다 draft 상자를 만든다, 섞이면 거절과 옛 직배 생성 제거"`

### Task 3: 입점사 상자 단계 · K6 수량 사실 · 판매주문 단계

**Files:**
- Create: `apps/core/src/modules/fulfillment/shipment/supplier-shipment-stage.ts`, `supplier-shipment-stage.spec.ts`
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantities.sql.ts:176-179` + 머리 주석(:94-95)
- Modify: `apps/core/src/modules/sales-order/services/fulfillment-phase.ts` — `dropShipStatuses` → `supplierShipmentStages: SupplierShipmentStage[]`, `dropShipUnitPhase` 는 `pending→preparing`, `forwarded→shipping`, `shipped→delivered`(스펙 §4.6 «지금 동작을 유지»)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts` `loadFoRows`·`loadFulfillmentPhaseInput`·`loadActiveShipmentStatuses`(:700-756)
- Modify: `apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures.ts` — `seedHandoff(tx, supplierId): Promise<string>`, `seedBox` 에 `supplierHandoffId?: string`·`unfulfillable?: { lineIndex: number; reason: string; at: Date }`(Task 4·6 도 쓴다). 옛 `seedFo({ dropShip })` 칸은 쓰는 spec 이 없어지면(Task 4 끝) 지운다
- Test: `apps/core/src/modules/sales-order/line-quantities/line-quantities.integration.spec.ts`, `order-fulfillment-phase.integration.spec.ts`, `sales-order/services/store-sales-orders.service.spec.ts`, `fulfillment-phase` 유닛 spec(있으면 그 파일, 없으면 `store-sales-orders.service.spec.ts` 안)

**Interfaces:**
- Produces:
  - `export type SupplierShipmentStage = 'pending' | 'forwarded' | 'shipped'`
  - `export function supplierShipmentStage(box: { id: string; status: ShipmentStatus; supplierHandoffId: string | null }): SupplierShipmentStage | null` — N6. `ShipmentStatus` 는 `shipment/shipment-transitions.ts` 의 것. 머리 주석에 같은 술어를 SQL 로 쓰는 곳(이 Task 의 `line-quantities.sql.ts`, Task 4 의 `order-progress.judge-sql.ts`, Task 5 의 `channel-order-change.reader.ts`, Task 6 의 큐 읽기)을 적는다
- K6 수량 사실(FOI 단위, `item_delivered` 처럼 범위 FOI 를 한 번에 묶어 FOI id 로 되붙이는 파생 테이블 하나로):
  - `forwarded` = 그 FOI 의 라인 중 입점사 상자 status ∈ (`draft`, `recovery_required`) 이고 `supplier_handoff_id IS NOT NULL` 인 것의 `sl.qty` 합
  - `partner_completed` = 그 FOI 의 라인 중 입점사 상자 status = `shipped` 인 것의 `sl.qty` 합
  - 옛 `fo.fulfillment_mode = 'drop_ship' and fo.direct_ship_status …` 식은 없앤다(N8). 뜻(«넘겼을 뿐 출고 아님», «배송완료 아님, 표시용»)은 주석 그대로
- 고객 화면: `supplierShipmentStages` 는 FO 상태와 무관하게 늘 읽는다(옛 `dropShipStatuses` 도 늘 읽었다) — 이 주문의 입점사 상자(`supplier_id IS NOT NULL`, canceled·superseded 제외)를 `supplierShipmentStage` 로. `loadActiveShipmentStatuses` 는 `s.warehouse_id IS NOT NULL` 로 창고 상자만 — 안 그러면 입점사 상자가 두 번, 그것도 «배송 중»으로 세진다. `PhaseFoRow` 에서 `dropShipStatuses` 만을 위해 읽던 칸은 뺀다

- [ ] **Step 1: 단계 유닛 spec** — draft+넘김 없음 → `pending`; draft+넘김 → `forwarded`; recovery_required+넘김 → `forwarded`; shipped → `shipped`; canceled·superseded → `null`; planned → throw(메시지에 상자 id)
- [ ] **Step 2: 수량 사실 통합 spec 에 더한다** — 섞인 주문(창고 라인 1, 직배 라인 2): 넘김 전 `forwarded 0`; 넘김 묶음(`seedHandoff` + `seedBox({ supplierHandoffId })`) 뒤 직배 SKU 의 `forwarded 2`, `partner_completed 0`; 입점사 상자를 `shipped` 로, FOI `shipped_qty 2` 로 심으면 `forwarded 0`, `partner_completed 2`, `shipped 2`, `delivered 0`, `claimable 0`. 옛 `drop_ship`/`direct_ship_status` FO 를 심던 케이스는 이 모양으로 바꾼다
- [ ] **Step 3: 단계 사다리 통합 spec** — 직배만 넘김 → `shipping`; 직배만 발송 → `delivered`(배송완료 0 이지만 `partner_completed ≥ required`); 섞인 주문에서 창고 배송완료 + 직배 발송 → `delivered`; 창고 배송완료 + 직배 넘김 → `shipping`
- [ ] **Step 4: 고객 진행 요약 spec** — 입점사 상자 `pending`·`forwarded`·`shipped` 하나씩 + 창고 상자 `delivered` → `{ total: 4, shipped: 3, delivered: 2 }`; 입점사 상자는 `activeShipmentStatuses` 에 들어가지 않는다
- [ ] **Step 5: 실패 확인 → 구현 → 통과** — 위 spec 전부, `npx jest apps/core/src/modules/sales-order` PASS, 통합 기준선 비교 → 새 실패 0. `line-quantity-read.guard.spec.ts` 가 빨개지면 가드가 아니라 읽는 쪽을 고친다
- [ ] **Step 6: Commit** — `git commit -m "K3 PR4 — 입점사 상자 단계 하나, K6 수량 사실·판매주문 단계가 상자로 읽는다"`

### Task 4: 정체 보드 — 입점사 상자를 상자로 판정

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/shipment-reservation-totals.sql.ts` `shipmentReservationTotalsSql` — N5(상자 행을 조인해 `supplier_id IS NOT NULL` 이면 `unreserved_qty` 0. `line_qty`·`reserved_qty` 는 그대로). 머리 주석에 한 줄
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts` — `fo` CTE 의 `mode`·`ds` 제거, `box_line` 에 `sl.unfulfillable_reported_at`, `box` 에 `s.supplier_id`·`s.supplier_handoff_id`·묶음 `created_at`(`supplier_handoffs` 조인)·`bool_or(unfulfillable_reported_at IS NOT NULL)`·`min(unfulfillable_reported_at)`, `box_kind`·`units` 에 N7 갈래, 옛 `UNION ALL … fo.mode = 'drop_ship'` 갈래 삭제, 머리 주석의 «직배는 shipment_id NULL» 정정
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts` — `ORDER_PROGRESS_STATES.dispatch` 에 `'drop_ship_unfulfillable'`, `STUCK_AFTER_MS_BY_STATE.drop_ship_unfulfillable = 0`, `SHIPMENT_STAGES` 주석 «직배는 상자가 없다» → «입점사 상자의 drop_ship_* 는 겨누는 상자 규칙이 아직 없다»
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts:97-104,133-136` — `passthrough` 의 `dropShip`(direct_ship_status enum 접두) 제거(이제 판정 SQL 에 리터럴로 있다), 상자 어휘 케이스 이름을 위 주석과 맞춘다
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts:89-90` — `@ts-expect-error` 주석 이유를 같은 뜻으로
- Modify: `apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures.ts` — 옛 `seedFo({ dropShip })` 칸 삭제(이 Task 가 마지막 사용처를 바꾼다)
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts`, `reserve-shortage.reader` 통합 spec(같은 폴더)

- [ ] **Step 1: 판정 통합 spec** — 옛 `dropShip` FO 케이스를 입점사 상자로 바꾸고 더한다:
  - `넘기지 않은 입점사 상자 → dispatch/drop_ship_pending, 진입 = opened_at` (예약 0 인데 `reserve` 가 아니다)
  - `넘긴 입점사 상자 → track/drop_ship_forwarded, 진입 = 묶음 created_at`
  - `못 보냄 라인이 있는 입점사 상자 → dispatch/drop_ship_unfulfillable, 진입 = 가장 이른 보고 시각, 바로 갇힘` — 넘긴 상자에 라인 둘, 하나만 못 보냄
  - `발송된 입점사 상자 → done` — 주문의 유일한 단위면 기존 «done» 단위와 같은 결과
  - `넘긴 입점사 상자 + 피킹 중 창고 상자 → 대표 pick`
  - `CANCEL_REPLAN_PENDING 입점사 상자 → cancel`(복구 갈래가 먼저)
  - 상자별 결과(`judgedShipmentsSql`)에 입점사 상자 행이 같은 단계·상태로 나온다
- [ ] **Step 2: 재고 부족 읽기 spec** — 입점사 draft 상자만 있는 주문은 맵에 없다; 덜 예약된 창고 상자 + 입점사 상자인 주문의 대표 상자는 창고 상자
- [ ] **Step 3: 실패 확인 → 구현 → 통과** — 두 통합 spec + `npx jest apps/core/src/modules/fulfillment/order-progress apps/core/src/modules/fulfillment/order-reconcile` PASS, `npm run type-check` 에러 0, 통합 기준선 비교 → 새 실패 0
- [ ] **Step 4: Commit** — `git commit -m "K3 PR4 — 정체 보드가 입점사 상자를 상자로 판정한다(대기·넘김·못 보냄·발송)"`

### Task 5: 관리자 주문 목록·채널 주소 변경·라인 구성 편집을 상자로

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` — `'direct'` 필터(:755-768)와 `directShip` 카운트(:1090-1101): `fulfillment_mode = 'drop_ship'` → «이 주문의 FO 에 입점사 상자(`supplier_id IS NOT NULL`, canceled·superseded 제외)가 있다». 카운트는 판매주문 수(`count(distinct)`)로
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.reader.ts` `hasDropShipInProgress`(:90-104) — N11, `HANDED_OFF_DIRECT_SHIP_STATUSES` 삭제
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.manager.ts:150` — N10: 그 라인의 FOI 중 열린(`ACTIVE_SHIPMENT_STATUSES`) 입점사 상자에 라인이 있는 것이 있으면 `DROP_SHIP_NOT_SUPPORTED`. 판정은 같은 폴더 reader 의 새 메서드 `lineInSupplierShipment(tx, salesOrderLineId): Promise<boolean>`
- Modify: `apps/core/src/modules/fulfillment/line-composition-edit/line-composition-edit.reader.ts:227` — 후보 조회의 FO 모드 조건을 «그 FOI 가 열린 입점사 상자에 없다»(`NOT EXISTS`)로
- Test: `sales-order/services/sales-orders-stats.integration.spec.ts`, `sales-order/channel-order-change/channel-order-change.integration.spec.ts`, `fulfillment/line-composition-edit/line-composition-edit.integration.spec.ts`, `apply-to-existing-lines.integration.spec.ts`

- [ ] **Step 1: spec 을 고치고 더한다** (옛 `drop_ship` FO 시드를 입점사 상자로)
  - 통계: `직배 카운트 = 입점사 상자가 있는 판매주문 수` — 입점사 상자 둘인 주문 하나 → 1; 취소된 입점사 상자만 → 0. `'direct'` 필터가 같은 주문만 돌려준다
  - 채널 주소 변경: `넘긴 열린 입점사 상자가 있으면 SHIPMENT_NOT_REVISABLE`; `넘기지 않은 입점사 상자만이면 이 검사로는 거절하지 않는다`(`hasDropShipInProgress` 가 false — 리더 단위로 단언)
  - 라인 구성 편집: `입점사 상자에 있는 라인의 구성 변경은 DROP_SHIP_NOT_SUPPORTED`; 일괄 적용 후보에 그 라인이 없다
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — 네 spec PASS, `npm run type-check` 에러 0, 통합 기준선 비교 → 새 실패 0. 끝나면 `grep -rnE "fulfillmentMode, 'drop_ship'|fulfillment_mode = 'drop_ship'|directShipStatus" apps/core/src --include=*.ts | grep -v '\.spec\.'` 의 남은 줄이 N8 이 남기는 것(`direct-ship.service.ts`, `direct-ship.controller.ts`, `fulfillments.service.ts` 의 `ship()`·`computeAdminAvailableActions`·응답 매핑, 스키마, DTO, `unboxed-demand-cancellation.ts` 의 알릴 취소 — PR 6)뿐인지 본다. 그 밖이 남으면 PR 본문에 적고 처리 여부를 사용자에게 묻는다
- [ ] **Step 3: Commit** — `git commit -m "K3 PR4 — 주문 목록 직배 필터·채널 주소 변경·라인 구성 편집이 입점사 상자로 판정한다"`

### Task 6: 직배 목록 — 입점사 대기열 읽기

**Files:**
- Create: `apps/core/src/modules/fulfillment/supplier-shipment/supplier-shipment-queue.reader.ts`
- Create: `apps/core/src/modules/fulfillment/dto/supplier-shipment-queue.dto.ts`
- Modify: `apps/core/src/modules/fulfillment/controllers/direct-ship.controller.ts` — GET 둘
- Modify: fulfillment 모듈 providers(`DirectShipController` 가 있는 모듈)
- Create: `apps/core/src/modules/fulfillment/supplier-shipment/supplier-shipment-queue.reader.integration.spec.ts`

**Interfaces:**
- Produces(reader, `@InjectTypedDb<typeof wmsSchema>()`):
  - `summaryBySupplier(tx?: DbTx): Promise<SupplierQueueSummary[]>` — `{ supplierId, supplierCode, supplierName, pendingShipments, forwardedShipments, unfulfillableLines }`. 셋 중 하나라도 0 보다 큰 입점사만, `supplierName` 순
  - `openShipments(supplierId: string, stage: 'pending' | 'forwarded', tx?: DbTx): Promise<SupplierQueueShipment[]>` — `{ shipmentId, stage, salesOrderId, orderNo, openedAt, handoffId: string | null, handoffAt: Date | null, lines: SupplierQueueLine[] }`, `openedAt, shipmentId` 순. `orderNo = displayOrderNo ?? channelOrderId`
  - `SupplierQueueLine = { shipmentLineId, skuId, skuName, supplierSku: string | null, qty, unfulfillableReason: string | null, unfulfillableReportedAt: Date | null }` — `supplierSku` 는 **그 입점사**와의 `sku_suppliers.supplier_sku`
  - 단계 술어는 N6 과 같다(주석으로 `supplier-shipment-stage.ts` 를 가리킨다). 상자 조회는 `idx_shipments_supplier_status` 를 탄다
- 라우트: `GET /direct-ship/supplier-queue` → `SupplierQueueSummaryDto[]`, `GET /direct-ship/supplier-queue/:supplierId/shipments?stage=` → `SupplierQueueShipmentDto[]`. 둘 다 `@RequirePermission('fulfillment.order.read')`. `supplierId` 는 `ParseUUIDPipe`, `stage` 는 둘 중 하나가 아니면 400. 응답에 수령인·연락처·주소를 넣지 않는다(N9)

- [ ] **Step 1: 통합 spec** — 입점사 A: 넘김 없는 상자 2, 넘긴 상자 1(라인 하나 못 보냄); 입점사 B: 발송된 상자 1, 취소된 상자 1; 입점사 C: 상자 없음
  - `요약은 A 만, pending 2 · forwarded 1 · unfulfillable 1` (B 는 셋 다 0, C 는 상자 없음)
  - `A 의 pending 은 상자 2개, opened_at 순, 라인에 그 입점사의 supplierSku`
  - `A 의 forwarded 는 묶음 id·시각, 못 보냄 라인의 사유`
  - `다른 입점사의 상자는 섞이지 않는다` — B 의 id 로 pending → 빈 배열
- [ ] **Step 2: 실패 확인 → 구현** — reader, DTO(중첩 클래스), 라우트
- [ ] **Step 3: 통과·가드** — 통합 spec PASS, `npx jest libs/authorization scripts/security apps/core/src/modules/fulfillment` PASS(`route-classification`·`pii-routes` 가 초록인지), `npm run type-check` 에러 0
- [ ] **Step 4: Commit** — `git commit -m "K3 PR4 — 직배 목록: 입점사별 대기·넘긴 상자 읽기"`

### Task 7: ADR·감사 문서·게이트·PR

**Files:**
- Modify: `docs/adr/0050-drop-ship-is-a-supplier-shipment.md` — Decision 에 8번 «FO 생성은 입점사마다 draft 상자를 연다, 입점사 상자 라인은 예약하지 않고 투영·«덜 예약» 정의가 예약된 것과 같이 센다(N4·N5)», 9번 «입점사 상자 단계(N6)의 정의는 `supplier-shipment-stage.ts` 하나». Consequences 의 «PR 4 가 상자 기준으로 옮긴다» 줄을 «옮겼다(PR 4) — 옛 FO 단위 직배 읽기는 없다»로
- Modify: `docs/order-logistics-architecture-audit-2026-10.md` §8.1 K3 — 한 줄: FO 생성이 입점사 상자를 만들고 «섞이면 거절»이 없어졌다(PR 4), FO status 직접 쓰기 예외는 옛 `ship()` 하나
- Modify: 설계 문서 §7 표 아래 «PR 5 구현자에게» 에 이 계획의 «다음 PR» 중 PR 5 몫을 한 줄씩

- [ ] **Step 1: 문서 셋을 쓴다**
- [ ] **Step 2: 검증 게이트** — `npm run type-check && npx jest` → 에러 0, 실패 0. 통합 `k3_pr2_it` 기준선 외 실패 0
- [ ] **Step 3: Commit** — `git commit -m "K3 PR4 — ADR-0050 에 입점사 상자 생성·단계"`
- [ ] **Step 4: PR** — 본문에 Task 0 실측값, «마이그 없음·Core 만·휴면», N1~N11, Task 5 Step 2 grep 에 남은 줄. 머지·배포는 사용자가 정한다

---

## 다음 PR 에 넘기는 것

- **PR 5(발송 명령):** 입점사 상자 `draft → shipped` 전이와 발송 시도·수기 송장·`shippedQty`·투영·이벤트. 고객 추적(`buildV2TrackingShipments`)은 시도 행으로 읽으므로 PR 5 가 시도 행을 만들면 따라온다 — 그때 draft 입점사 상자가 추적 화면에 «준비 중»으로 어떻게 보이는지 확인. 분할된 상자가 원래 상자의 `supplier_handoff_id` 를 물려받는지(PR 2 에서 넘어온 것). 큐 읽기(Task 6)는 내려받기·«넘긴 것» 화면이 그대로 쓴다.
- **PR 6(취소):** 이 PR 뒤로 직배 주문에도 상자가 생기므로 `SalesOrdersService.cancel` 은 직배 주문을 상자 후 취소로 보낸다. 옛 «알릴 취소»(`UnboxedDemandCancellation.recordPartnerNotices`)는 `drop_ship` FO 만 보므로 **새 입점사 상자의 취소는 PR 6 전까지 알림 행을 남기지 않는다**(휴면이라 실제 피해는 없다). 상자 후 취소가 예약 0 인 입점사 draft 상자에서 무해한지 PR 6 이 확인한다.
- **채널 주소 변경:** 넘기지 않은 입점사 상자는 `reviseRecipientFromChannel` 로 간다. 그 경로가 입점사 상자에서 안전한지(창고 전용 단계를 타지 않는지)는 확인하지 않았다 — 직배는 외부 채널에서 팔지 않으므로(비목표) 막히지 않지만, 판다면 그 전에 확인할 것.
- **PR 5:** K6 사다리의 `delivered`(발송된 입점사 상자)는 발송 명령이 FOI `shipped_qty` 를 써야 선다(규칙 6 이 미결 0 을 요구) — 읽기 픽스처가 그 모양을 가정한다.
- **PR 5:** 합포장(한 입점사 상자에 여러 주문) — 직배 목록 읽기(Task 6)는 상자 단위 `salesOrderId`·`orderNo` 만 낸다. 합포장 상자는 라인별 주문 칸이 필요하다.
- **PR 5:** 보드에서 회수 대기 입점사 상자(recovery_required + DISPATCH_RECALL_PENDING)는 복구 갈래가 먼저 잡아(N7) `unclassified/<code>` 로 보인다. 그게 운영자가 원하는 모양인지 정한다.
- **PR 5:** 내려받기·넘김은 `recovery_code IS NOT NULL` 인 상자를 넘기지 않는다 — 직배 목록은 recovery_required 상자를 열린 것(N6 의 대기·넘김)으로 세지만 보드는 취소·재계획 상자를 `cancel` 로 보여 준다.
- **PR 5:** K6 `forwarded` 는 «못 보냄» 라인을 포함해 고객에게 「배송 중」으로 보인다 — 입점사가 못 보낸다고 한 라인이 그렇게 보여도 되는지 정한다.
- **PR 6:** `cancelAfterBoxing` 은 이제 입점사 상자가 있는 모든 주문의 취소 경로이고 `warehouseIdOf` 에 걸릴 수 있다 — 이 PR 이 만든 가장 큰 휴면 위험이다.
- **PR 7:** `getOne` 의 FO 상세 `shipments[]` 에 `supplierId` 가 없어 admin-web 이 입점사 상자를 구별하지 못한다.
- **PR 8:** FO 목록 필터 `fulfillmentMode='drop_ship'`(`fulfillments.controller.ts:138`, `list-fulfillments-query.dto.ts:16`)은 이제 옛 FO(라이브 0)만 맞춘다 — 모드와 함께 지운다.
- **PR 6:** K6 `forwarded` 는 넘긴 열린 입점사 라인의 Σ `sl.qty` 다. 입점사 상자 취소가 FOI `canceled_qty` 와 함께 `sl.qty` 를 줄여야(`shrinkDraftLines` 경로) 맞다.
- **PR 7:** admin-web 에 보드 상태 `drop_ship_unfulfillable` 라벨이 없다(원값 표시). admin-web FO 진행 타입에 `supplierLineQty` 가 없다.
- **PR 8(contract):** `direct_ship_status` 칸·`drop_ship` 모드 값·옛 `direct-ship.service.ts`·`ship()`·`computeAdminAvailableActions`·옛 응답 칸. 그리고 PR 2 N10 으로 남긴 옛 FO 모드 가드(`allocation.locks.ts`·`outbound-batch-orchestrator.service.ts`·`shipment-planning.service.ts`), 옛 쓰기 경로 스펙 여섯이 쓰는 `seedFo({ dropShip })` 픽스처, 라인 구성 편집 읽기가 고르고 안 쓰는 `fulfillmentMode`.
- **머지 전(사용자):** Task 0 라이브 실측은 돌지 못했다(자동 모드가 운영 읽기를 막았다). 네 쿼리를 머지 전에 돌린다 — 기대값은 전부 0.
