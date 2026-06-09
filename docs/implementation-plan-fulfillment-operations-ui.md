# 출고 운영 화면 구현 계획 (출고주문 / 피킹 / 검수 / FO 수동 생성)

> 상태: **전체 Phase(0~4) 완료 — 코드/마이그레이션/dev DB 적용/바코드 E2E/커밋 완료**
> 작성일: 2026-06-09 / 진행: 2026-06-09 (Phase 2→1→4→3 일괄)
> 대상 앱: `apps/core` (백엔드), `apps/admin-web` (프론트)
> 진행 메모: Phase 0/1/2/3/4 코드 작성·검증 및 단일 기능 커밋 완료. `npm run db:setup -- --stage dev --deployment lcnine-services` 실행으로 dev 전체 schema migration 완료(seed 건너뜀). core DB 실측 결과 검수 테이블 3종 + `inspected` enum 존재 확인.
> 재개 체크포인트 (2026-06-09): 코드 보강·검증 및 dev DB 적용 완료. `core` **build 통과**, `admin-web` **type-check/lint/production build 통과**, fulfillment service 테스트 **26/26 통과**, `git diff --check` 통과. 추가 수정 = individual picking `skuCode`, `inspected` 프론트 타입/필터, 검수 세션 소속·수량 완료 조건, force/bulk 세션 범위, reset 이력 보존, 활성 세션 재개/조회, 수동 검수 합계 자동화.
> E2E 체크포인트 (2026-06-09, 완료): dev core DB 트랜잭션에 임시 FO/SKU/창고를 생성해 `SKU-{uuid}` batch pick + `FOI-{uuid}` individual pick, 검수 `FOI` +1 → `SKU` +1, 초과 스캔 거절, `canComplete=true`, FO `inspected`/세션 `completed` 전이를 실측했다. 종료 후 강제 rollback 및 테스트 SKU 무잔존 확인. 공통 입력의 Enter→`onScan` 경로는 코드 확인(브라우저/DOM 테스트 도구는 저장소에 미설치).
> 최종 보완/검증 (2026-06-09): 배치 피킹 UI가 `SKU-{uuid}`를 raw UUID와 직접 비교한 뒤 미매칭 시 첫 미완료 SKU를 선택하던 위험을 제거했다. `SKU-` 접두사/skuCode를 정확 매칭하며 완료·미매칭 바코드는 거절한다. 최종 `core build`, admin `type-check`/`lint`/production build, fulfillment 테스트 26/26, `git diff --check` 통과.

## 1. 목표

1. **출고주문(Fulfillment Order, FO) 목록/상세** 운영 화면 신규 추가
2. 필드 불일치 등으로 안정적 사용이 어려운 **피킹/검수 기능을 실사용 가능**하게 정비
   - "실사용 가능"의 정의 = **실제 바코드를 찍어서 동작까지** 되는 것
   - 바코드를 찍는 동작은 **"바코드 문자열 + Enter" 키보드 입력과 동치** (HID 리더기 = 키보드). 따라서 물리 리더기 없이 input 에 문자열 타이핑 후 Enter 로 테스트 가능
3. **FO 수동 생성** 페이지 구현

목록/상세 화면 컨벤션은 **user** 또는 **판매상품(product)** 엔티티의 선례를 따른다.

## 2. 용어

| 약어 | 의미                                   | 테이블                              |
| ---- | -------------------------------------- | ----------------------------------- |
| SO   | Sales Order (판매주문)                 | `sales_orders`, `sales_order_lines` |
| FO   | Fulfillment Order (출고주문)           | `fulfillment_orders`                |
| FOI  | Fulfillment Order Item (출고주문 라인) | `fulfillment_order_items`           |

SO → FO 관계: `fulfillment_orders.salesOrderId` (FK, cascade), FOI 의 `salesOrderLineId` 로 원 SO 라인 추적. SO 생성/명시 호출 시 SO 라인의 variant → product-SKU 매핑으로 FO 라인이 **자동 도출**됨. SKU 매칭 실패분은 `fulfillment_order_creation_backlogs` 에 적재 후 재시도.

## 3. 현황 요약 (조사 결과)

### 3.1 백엔드 API 완성도

| 영역    | 엔드포인트                                       | 상태                  | 비고                                     |
| ------- | ------------------------------------------------ | --------------------- | ---------------------------------------- |
| FO 목록 | `GET /fulfillments` (limit/offset)               | ✅ 완성               | 필터 파라미터 없음 (status/warehouse 등) |
| FO 상세 | `GET /fulfillments/:id`                          | ✅ 완성               |                                          |
| FO 생성 | `POST /fulfillments`                             | ✅ 완성               | standalone(items) / SO기반 상호배제      |
| FO 액션 | reserve/ship/cancel/split 등                     | ✅ 완성               | `fulfillments.controller.ts`             |
| 피킹    | `/picking/*` (batch-pick, scan, pick-by-scan 등) | ✅ 완성               | `pickedQty` DB UPDATE 정상 영속화        |
| 검수    | `/inspection/*`                                  | ⚠️ **in-memory stub** | DB 영속화 안 됨 (아래 3.3)               |

근거:

- `apps/core/src/modules/fulfillment/controllers/fulfillments.controller.ts`
- `apps/core/src/modules/fulfillment/controllers/picking.controller.ts`
- `apps/core/src/modules/fulfillment/services/picking-process.service.ts` (`pickItem` → `fulfillmentOrderItems.pickedQty` UPDATE)
- `apps/core/src/modules/fulfillment/controllers/inspection.controller.ts`
- `apps/core/src/modules/fulfillment/services/inspection.service.ts`

### 3.2 프론트 화면 현황 (`apps/admin-web`)

| 화면                       | 라우트                    | 상태                                            |
| -------------------------- | ------------------------- | ----------------------------------------------- |
| 주문내역(SO 기반)          | `/order/history`          | ✅ 있음 (Sales Order 기반, `useSalesOrderRows`) |
| **출고주문(FO) 목록/상세** | —                         | ❌ **없음** (신규 구현 대상)                    |
| 피킹                       | `/order/picking-list`     | ⚠️ 화면 있음, 필드 불일치로 표시 깨짐           |
| 검수                       | `/order/inspection`       | ⚠️ 화면 있음, 백엔드 stub + 바코드 미구현       |
| 출고 배치                  | `/order/outbound-batches` | ✅ 있음                                         |
| FO 수동 생성               | —                         | ❌ **없음** (`manual-single/bulk` 는 SO 생성용) |

- `/order/history` 는 **SO 기반**이며 FO 전용 화면이 아니다 → 출고주문 목록/상세는 **새 라우트로 신규 구현** 필요.
- FO API 클라이언트(`apps/admin-web/src/lib/api/domains/orders/fulfillment-order.client.ts`)는 정의돼 있으나 `create/delete/priority/allocate` 만 있고 **list/getOne 누락**, 사용하는 화면도 없음.

### 3.3 바코드 스캔 흐름 현황 (검수 실사용화의 핵심)

| 구분                 | 프론트 입력 | API 클라이언트         | 백엔드 라우트                       | 백엔드 서비스             | DB         | 상태       |
| -------------------- | ----------- | ---------------------- | ----------------------------------- | ------------------------- | ---------- | ---------- |
| 피킹 - 스캔 조회     | ✅          | ✅ `scanBarcode`       | ✅ `POST /picking/scan`             | ✅ `scanBarcode`          | ✅         | **구현됨** |
| 피킹 - 스캔 피킹     | ✅          | ✅ `pickByBarcodeScan` | ✅ `POST /picking/pick-by-scan`     | ✅ `pickByBarcodeScan`    | ✅         | **구현됨** |
| 피킹 - 바코드 생성   | ✅          | ✅ `generateBarcode`   | ✅ `POST /picking/generate-barcode` | ✅ `getBarcodeForPicking` | ❌(생성만) | **구현됨** |
| **검수 - 스캔 조회** | ❌          | ❌                     | ❌                                  | ❌                        | —          | **미구현** |
| **검수 - 스캔 검수** | ❌          | ❌                     | ❌                                  | ❌                        | —          | **미구현** |

- 공통 바코드 입력 컴포넌트: `apps/admin-web/src/components/common/barcode-scan-input/index.tsx`
  - `onKeyDown` 으로 Enter 감지 → 문자열 trim → `onScan()` 콜백. inbound/stocktaking/picking/inspection 공용으로 설계됨.
  - **검수 화면에서는 아직 이 컴포넌트를 쓰지 않음** (현재는 `inspect-item-dialog` 수동 수량 입력만).
- 바코드 포맷(프로그래매틱): `SKU-{uuid}` / `FOI-{uuid}` / `FO-{uuid}` / `LOC-{code}`.
- 물리 바코드 원천: `skuBarcodes.barcode` 테이블 (`inventory.schema.ts`) 존재하나 스캔 흐름에서는 현재 프로그래매틱 포맷 사용.

### 3.4 검수 stub 상세 (영속화 부재)

`apps/core/src/modules/fulfillment/services/inspection.service.ts` 기준:

- 세션 ID 를 `INS-${Date.now()}-${random}` 으로 생성, **DB 저장 없음** → 재요청/재시작/타 인스턴스에서 세션 조회 불가
- `getInspectionHistory()` 항상 `[]` 반환
- `getQualityMetrics()` 0/빈배열 stub
- `completeInspectionSession()` 사실상 빈 함수
- `fulfillment_order_items` 에 `inspectedQty/approvedQty/rejectedQty` 컬럼 없음

### 3.5 피킹/검수 프론트-백 필드 불일치 (대표)

- `PickingOperation`: 프론트 `id/skuCode/skuName/status/requiredQty` 기대 ↔ 백엔드 `batchId/totalQty/remainingQty/foiDetails` 반환
  - `apps/admin-web/src/lib/types/dto/fulfillment.ts` ↔ `picking-process.service.ts`
- `PickingProgress`: `progressPercent` ↔ `completionPercentage`, `totalItems` 의미 상이, `remainingItems` 누락
- `PickingSession`: 프론트 `skuCode` 기대(백엔드 없음), 백엔드 `isCompleted/totalItems/completedItems/completionPercentage` 프론트 타입에 없음
- `InspectionSession`: `startedAt/completedAt` Date↔string, 백엔드 추가 필드(`totalItems/inspectedItems/issues/items`) 프론트 누락, status `paused` 누락
- `InspectionSummary`: 프론트 `forcedItems/status` ↔ 백엔드 `pendingItems/partialItems/totalIssues/canComplete`
- 검수 complete 호출 시 body 에 `sessionId` 중복 전송(이미 URL param) — `inspection-session-drawer`

### 3.6 FO/FOI 상태머신 (검수 status 전이 배경)

FO status enum (`fulfillmentStatusEnum`, `inventory.schema.ts:184`): 정상 흐름은
`created → ready → allocated → picking → picked → inspecting → invoiced → shipped → completed` (+ pending/unfulfillable/canceled 등).

현재 전이 (코드 근거):

| 전이                        | 위치                                                               | 트리거                            |
| --------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| created → ready             | `fulfillments.service.ts:422`                                      | 재고 예약 성공                    |
| ready/pending → allocated   | `outbound-batch.service.ts:160/232`                                | 배치 할당                         |
| allocated → picking         | `outbound-batch.service.ts:349` / `picking-process.service.ts:313` | 피킹 시작                         |
| picking → picked            | `outbound-batch.service.ts:402` / `picking-process.service.ts:466` | 피킹 완료                         |
| picked → inspecting         | `inspection.service.ts:148`                                        | 검수 세션 시작                    |
| inspecting → ???            | `inspection.service.ts:265`                                        | **전이 없음 (stub)**              |
| picked → invoiced           | `invoice.service.ts:168`                                           | 송장 발행 (picked 검증 `:108`)    |
| invoiced → shipped          | `invoice.service.ts:252`                                           | 송장 발송                         |
| picked/inspecting → shipped | `fulfillments.service.ts:1085`                                     | ship() 직접 호출 (상태 검증 없음) |
| shipped → completed         | `fulfillments.service.ts:1150`                                     | 배송 완료                         |

⚠️ **핵심 충돌**: `startInspectionSession` 이 `picked → inspecting` 으로 바꾸지만, `issueInvoice` 는 FO 가 `picked` 상태일 것을 검증한다(`invoice.service.ts:108`). 따라서 **검수를 시작하면 송장 발행이 막히고**, `completeInspectionSession` 이 stub 이라 `inspecting` 에서 빠져나올 수 없다 → 검수가 막다른 길. 이것이 검수 status 측면의 실사용 불가 원인이며, §4 "검수 완료 후 FO 상태 전이" 결정으로 해소한다.

부수 사항:

- `inspectItem` 은 FOI status 를 안 바꿈(`updatedAt` 만) → 검수 판정이 FOI 에 기록되지 않음
- `bulkApprove`/`forceShipment` 는 FOI `shippedQty` 만 갱신하고 FO status 는 유지
- FOI status 는 enum 없는 `varchar` (관찰된 값: pending/shipped/approved/rejected/partial)

## 4. 결정 사항

- **검수 영속화 방식**: **전용 테이블 신설(정석)**. `inspection_sessions` / `inspection_items` / `inspection_issues` 3종 신규. (FOI 컬럼 추가 방식 대신 선택)
- **검수 실사용 정의**: 바코드 스캔 흐름까지 포함. 피킹의 바코드 패턴을 검수에 이식한다.
- **검수 스캔당 수량**: 입고 `fullscan-mode` 하이브리드 차용 — 스캔 1회 = `approvedQty` +1 누적 + 불량/부분은 수동 입력 병행. (상세 → Phase 3-C)
- **검수 필수성**: **선택 단계**. `picked` 에서 바로 송장 발행 가능하고, 검수를 거치면 추가 검증이 붙는 구조 (현재 코드 동작 유지). 모든 FO 에 검수를 강제하지 않는다.
- **불량(reject) 처리**: **양품만 부분배송, 불량은 보류**. 검수 통과(approved) 수량만 `shippedQty` 로 배송하고, rejected 분은 별도 처리(재피킹/반품)로 보류. FOI status 에 `approved`/`rejected`/`partial` 을 기록. (기존 `bulkApprove`/`forceShipment` 메커니즘 활용)
- **검수 완료 후 FO 상태 전이**: **`inspected` 신규 상태 추가로 확정·구현 완료**. `completeInspectionSession` 이 `inspecting → inspected` 로 전이하고, 송장 발행은 `picked` 와 `inspected` 둘 다 허용하도록 `issueInvoice` 검증을 완화했다. `picked`(검수 전)와 `inspected`(검수 완료)가 의미·이력에서 구분됨. (배경 → §3.6, 구현 → Phase 3)
- **진행 방식**: 본 문서의 Phase 순서대로 코드 구현 완료. dev DB 마이그레이션 적용과 E2E 수동검증 후 커밋한다.

## 5. 단계별 계획

### Phase 0 — 공통 기반 (FO 프론트 타입/클라이언트 정돈) ✅ 완료 (2026-06-09)

이후 모든 단계가 재사용하는 토대.

- [x] `dto/fulfillment.ts` — `FulfillmentOrderStatus` enum 을 백엔드 `fulfillmentStatusEnum` 전체값으로 확장 + `FulfillmentOrderDetail`/`FulfillmentOrderListItem`/`FulfillmentInvoiceSummary`/`FulfillmentOrdersQuery` 응답 타입 추가 (`FulfillmentOrderResponseDto` 1:1)
- [x] `fulfillment-order.client.ts` — `list(query)`, `getOne(id)` 추가 (경로 `/fulfillments` = 메인 `FulfillmentsController`. 기존 create/delete/priority/allocate 는 `/fulfillment-orders`)
- [x] `query-keys.ts` 에 `fulfillmentsList(params)` 추가 + `queries.ts` 의 `useFulfillmentOrders`/`useFulfillmentOrder` 를 stub 에서 실제 API 호출로 교체 (`useFulfillments`/`useFulfillment` 는 별칭으로 통합)
- 선례: `lib/services/users/queries.ts`, `lib/services/products/queries.ts`
- ⚠️ 피킹/검수 타입 정합화는 각 Phase(2/3) 소관. 상세 FOI 라인(items)·목록 total/count 는 Phase 1 에서 백엔드 확장과 함께 처리.

### Phase 1 — 출고주문(FO) 목록/상세 화면 (신규) ✅ 완료 (2026-06-09)

라우트 (user 컨벤션):

- 목록: `apps/admin-web/src/app/(admin)/order/fulfillments/page.tsx`
- 상세: `apps/admin-web/src/app/(admin)/order/fulfillments/[id]/page.tsx`
- 기능: `apps/admin-web/src/features/order/fulfillments/{template,components}`

> ℹ️ 3-레벨 훅 패턴의 실제 위치는 `features/` 가 아니라 **전역 `src/hooks/table/{query,columns,filters}/`** + `src/hooks/use-data-table.ts` + `src/components/data-table` 였음 (users 선례 그대로). 테이블 셀은 `src/components/table/table-cells/<domain>/` 에 둔다.

작업:

- [x] **백엔드 확장**: `GET /fulfillments/:id` 에 FOI 라인(items) + SKU(code/name) 조인 추가 (`getOne`, `FulfillmentOrderItemDto`). `GET /fulfillments` 를 `{data,total}` 페이지네이션 응답 + `status` 단일 필터로 확장 (`list`, `FulfillmentOrderListResponseDto`, `isFulfillmentStatus` 타입가드)
- [x] 목록 — `GET /fulfillments`. 3-레벨 훅 복제: `hooks/table/query/use-fulfillments-table-query.tsx`, `columns/use-fulfillments-table-columns.tsx`(주문번호/상태배지/창고/모드/우선순위/아이템수/생성일), `filters/use-fulfillments-table-filters.ts`(status). `DataTable` + 서버 페이지네이션(URL page) + `RouteGuard`. 상태/우선순위/모드 셀: `components/table/table-cells/fulfillment/`
- [x] 상세 — `GET /fulfillments/:id`. FO 헤더 카드 + FOI 라인 테이블(skuCode/skuName/qty/reservedQty/pickedQty/shippedQty/status) + 액션. `features/order/fulfillments/components/detail/`
  - ship/cancel = FO-level POST 재사용 (AlertDialog 확인). reserve = **FOI 라인별** `POST /:id/reserve`(잔여수량 예약) 버튼 — reserve 엔드포인트가 FOI 단위라 FO-level 단일 버튼 대신 라인별로 배치
  - mutations: `useShipFulfillment`/`useCancelFulfillment`/`useReserveFulfillmentItem` 신규
- [x] 클라이언트 `fulfillment-order.client.ts`: `list`({data,total}, page→offset, status), `ship`/`cancel`/`reserveItem` 추가. DTO `FulfillmentOrderItem`/`FulfillmentOrdersListResponse` + 쿼리 `status`/`page`
- [x] 네비게이션 메뉴(`lib/utils/menu.ts`) 출고 그룹에 "출고주문"(`/order/fulfillments`) 추가
- ⚠️ 필터는 **status 단일만** 구현. warehouse/날짜/검색 필터는 백엔드 쿼리 확장 합의 필요(§7) — 보류. getOne 은 미존재 시 null 반환(상세 화면이 "찾을 수 없음" 처리)

### Phase 2 — 피킹 안정화 (필드 정합화) ✅ 완료 (2026-06-09, 바코드 E2E 수동검증만 남음)

백엔드 영속화는 정상이므로 DTO/화면만 정합화. 백엔드 응답을 정본으로 잡는다.

- [x] 프론트 `dto/fulfillment.ts` 의 `PickingOperation/PickingProgress/PickingSession` 을 백엔드 실제 응답명으로 교체 (`requiredQty→totalQty`, `progressPercent→completionPercentage`, `foiDetails` 구조 반영). `PickingOperationFoiDetail`/`PickingSessionItem` 분리 export
- [x] 백엔드 피킹 조회에 SKU 조인 추가하여 `skuCode/skuName` 제공 — `getPickingOperations`(skus innerJoin 신규), `startIndividualPicking`/`getIndividualPickingSession`(기존 skuName 조인에 `skuCode` 추가). 인터페이스 `PickingOperation`/`IndividualPickingSession` 에 필드 추가
- [x] 화면 반영: `batch-picking-tab/`(필드명 `progressPercent→completionPercentage`, `requiredQty→totalQty`, `op.id→op.skuId` key, `op.status`→`operationStatus(op)` 헬퍼로 도출), `picking-session-drawer/`(skuCode 표시 정상화)
- [x] `picking-session-drawer` 의 `warehouseId: ''` 하드코딩 수정 — `useFulfillmentOrder(foId)`(Phase 0)로 FO 상세 조회해 `fo.warehouseId` 전달
- [x] 바코드 흐름 회귀 테스트: dev DB rollback 트랜잭션에서 `SKU-{uuid}` batch pick + `FOI-{uuid}` individual pick 실측(`pickedQty=2`). `barcode-scan-input` Enter→onScan→mutation 경로 코드 확인

### Phase 3 — 검수 실사용화 ★ (영속화 + 바코드) ✅ 코드 + dev DB 적용 완료 (2026-06-09)

#### 3-A. 스키마 (drizzle, additive → 1 PR 가능) ✅ 코드/마이그레이션/dev DB 적용 완료

- [x] `fulfillmentStatusEnum` 에 **`inspected` 값 추가** (`inventory.schema.ts`, `inspecting` 와 `invoiced` 사이)
- [x] `apps/core` inventory.schema.ts 에 테이블 3종 추가 (status/type/severity 는 varchar — FOI status 컨벤션). `wmsTables` 등록 완료
  - `inspection_sessions` (id, fulfillmentOrderId, type, status, inspectorUserId, totalItems, inspectedItems, completedItems, issues, startedAt, completedAt, createdAt, updatedAt)
  - `inspection_items` (id, sessionId fk, foiId fk, inspectedQty, approvedQty, rejectedQty, status, lastInspectedAt + unique(sessionId,foiId))
  - `inspection_issues` (id, foiId fk, sessionId fk, type, severity, description, qty, inspectorUserId, photos jsonb, reportedAt, resolvedAt, resolution)
- [x] `npm run db:generate:core -- --name add-inspection-tables` → SQL 생성 완료 (`apps/core/drizzle/20260609030422_add-inspection-tables.sql`). 검토 완료(additive)
- [x] **`npm run db:setup -- --stage dev --deployment lcnine-services` dev 적용 완료** — 전체 schema migration 성공, seed 단계 건너뜀. core DB에서 검수 테이블 3종 + `inspected` enum 실측 확인
- [x] schema.ts + `drizzle/<ts>_*.sql` + `drizzle/meta/` **단일 기능 커밋에 포함**

#### 3-B. 백엔드 서비스 재구현 (`inspection.service.ts`) ✅ 완료

- [x] in-memory 세션 → 실제 DB insert/select 로 교체 (세션 ID `defaultRandom()` uuid). 세션 시작 시 inspection_items 행 생성
- [x] `inspectItem` 결과를 `inspection_items` 에 upsert 영속화 + 이슈를 `inspection_issues` 에 insert + **FOI status(approved/rejected/partial) 기록**. 양품(approvedQty)만 `shippedQty` 로 (rejected 보류 — §4 양품 부분배송)
- [x] `completeInspectionSession` 실제 구현: 세션 status=completed + **FO `inspecting → inspected` 전이** (1안). 세션 카운터 재계산(`refreshSessionCounters`)
- [x] `issueInvoice` 검증 완화 — `status !== 'picked' && status !== 'inspected'` (검수=선택, 둘 다 허용)
- [x] `getInspectionHistory`(inspection_items+sessions 조인) / `getQualityMetrics`(승인/반려율·commonIssues·inspectorPerformance 집계) 실제 쿼리. `getInspectionSummary`·`bulkApprove`·`forceShipment`·`resetInspection` 도 DB 반영
- [x] 후속 검증 보강: FOI-세션 소속 및 active 상태 검증, `inspectedQty >= pickedQty` 완료 조건을 summary/complete 양쪽에서 강제, force/bulk 를 요청 세션으로 제한, reset 은 활성 세션만 초기화해 과거 이력 보존
- [x] 활성 검수 세션 재개/조회: `POST /inspection/sessions` 는 이미 `inspecting` 인 FO의 active 세션을 반환하고, `GET /inspection/sessions/:sessionId` 로 최신 라인/이슈 상태 재조회
- [x] 트랜잭션 전파는 inventory 규칙(`inTx` / `tx?: DbTx`) 준수

#### 3-C. 검수 바코드 스캔 신규 구현 (피킹 패턴 이식)

**스캔당 수량 정책: 입고 `fullscan-mode` 하이브리드 차용 (결정됨 — §7 참조)**

- 기본 = **스캔 1회 = `approvedQty` +1 누적** (피킹/입고/실사 사내 컨벤션과 일관, 작업자 학습비용 0)
- 예외 = **불량/부분 검수는 기존 `inspect-item-dialog` 수동 입력 병행** (rejectedQty, 이슈 등록)
- 즉 양품은 스캔으로 빠르게 쳐내고, reject 판정은 수동 다이얼로그로 분리 처리한다. 검수는 피킹과 달리 양품/불량 판정이 섞이므로 단순 "+1 누적"만으로는 부족하다.
- 참고 선례: `apps/admin-web/src/features/inventory/inbound/components/receive-dialog/fullscan-mode.tsx` (스캔 +1 누적 + 인라인 수량 보정 하이브리드)

- [x] 백엔드 엔드포인트 추가 (`inspection.controller.ts` + service, BarcodeService 주입)
  - `POST /inspection/scan` — 바코드(`SKU-`/`FOI-`) → 세션 내 검수 대상 FOI 식별 + 현재 검수 상태 반환 (`resolveFoiFromBarcode`/`loadInspectionItem`)
  - `POST /inspection/inspect-by-scan` — 바코드(+수량 기본 1) → 현재 approved 읽어 누적 후 `inspectItem` 위임. 스캔 1회 = `approvedQty` +1
- [x] 프론트 검수 화면 (피킹/입고 스캔 UX 일관)
  - `inspection-session-drawer` 에 공통 `barcode-scan-input` 배치(autoFocus), Enter → `useInspectByScan` (양품 +1) + summary refetch. 검수 대상 라인 목록(session.items) 표시 + 라인별 `foiId` 로 검수/강제출고 다이얼로그 연결
  - 불량/수량 보정은 기존 `inspect-item-dialog` (수동 입력) 경로 유지
- [x] API 클라이언트 `inspection.client.ts` 에 `scan` / `inspectByScan` 추가 + `useInspectByScan` mutation

#### 3-D. 검수 프론트 정합화 ✅ 완료

- [x] `dto/fulfillment.ts` 의 `InspectionSession`(+items/카운터/paused)/`InspectionSummary`(pendingItems/partialItems/totalIssues/canComplete)/`InspectionItem`(신규)/`InspectionHistoryItem`(count 기반)/`QualityMetrics`(totalInspections/commonIssues/inspectorPerformance) 백엔드 응답에 맞춤
- [x] complete: 백엔드 `CompleteSessionSchema` 를 `{inspectorUserId}` 만으로(URL param 사용), 프론트 `CompleteInspectionSessionRequest`·드로어 호출에서 중복 `sessionId` 제거
- [x] `quality-metrics-card` 백엔드 필드(totalInspections/approvalRate/rejectionRate/commonIssues)로 교체. 드로어 summary 도 forcedItems→partialItems/totalIssues 로 정합

### Phase 4 — FO 수동 생성 페이지 (신규) ✅ 완료 (2026-06-09)

라우트: `apps/admin-web/src/app/(admin)/order/(input)/fulfillment-manual/page.tsx`

- [x] `POST /fulfillments` **standalone 모드** 사용: `items[]`(skuId+quantity), `warehouseId`, `fulfillmentMode`(in_house|3pl|drop_ship), `priority`(normal|high|urgent), `shippingAddress`(AddressDto 5필드 필수 + deliveryNote 선택). 클라이언트 `fulfillmentOrder.createStandalone` 신규(`POST /fulfillments` — 기존 `create` 의 `/fulfillment-orders` 와 구분)
- [x] ⚠️ 제약 준수: `salesOrderId` 미전송(items 기반 standalone). SKU 검색 UI = `useSkus({name})` 결과 클릭 추가 + 수량 입력 + 제거. 창고 select = `useWarehouses()`
- [x] mutation 훅 `useCreateFulfillmentOrder` 추가 (성공 시 목록 invalidate + 생성된 FO 상세로 router.push)
- [x] 폼 컴포넌트 `features/order/fulfillments/components/manual-create-form/`, DTO `CreateStandaloneFulfillmentRequest`/`FulfillmentShippingAddress`/`CreateStandaloneFulfillmentItem`
- [x] 네비게이션 메뉴 주문입력 그룹에 "출고주문 생성 (수동)"(`/order/fulfillment-manual`) 추가
- ⚠️ 배송지 입력은 토글(선택). 켜면 메모 제외 전 필드 필수(백엔드 AddressDto 검증). 미사용 시 shippingAddress 생략

## 6. 권장 진행 순서 (착수 시)

```
Phase 0  →  Phase 2(피킹 정합화)  →  Phase 1(FO 목록/상세)  →  Phase 4(FO 수동생성)  →  Phase 3(검수)
```

- 피킹: 가장 가벼운 정합화 → 빠른 가시 성과 + 바코드 패턴 재확인(검수 이식의 레퍼런스)
- 검수: DB 마이그레이션 + 서비스 재구현 + 바코드 신규라 가장 무겁고 독립적 → 마지막

## 7. 잔여 리스크 / 확인 필요

- [ ] FO 목록 필터/검색 요구 시 백엔드 `GET /fulfillments` 쿼리 확장 범위 합의
- [x] ~~검수 바코드 스캔당 수량 정책~~ **결정·구현 완료**: 입고 `fullscan-mode` 하이브리드 차용 — 스캔 1회 = `approvedQty` +1 누적(기본) + 불량/부분은 `inspect-item-dialog` 수동 입력 병행. `POST /inspection/scan`, `POST /inspection/inspect-by-scan`, 검수 드로어 입력까지 반영
- [x] ~~검수 완료 후 FO status 전이~~ **`inspected` 신규 상태로 확정·구현 완료**: `inspecting → inspected`, `issueInvoice` 는 `picked`·`inspected` 둘 다 허용. enum/서비스/마이그레이션 SQL 반영 완료
- [ ] **송장 발행 수량 정합성**: 코드 확인 결과 Goodsflow 요청은 아직 FOI `qty`를 사용한다(`invoice.service.ts:141-145`). 양품 부분배송 정책대로 `shippedQty`(approved 분)를 사용할지, 주문 전체 수량을 유지할지 운영 정책 확정 후 구현 정합 필요
- [x] ~~검수 테이블 마이그레이션 분할 여부~~ additive 단일 마이그레이션으로 확정: enum 값 추가 + 신규 테이블/FK/index만 포함하며 기존 FOI destructive 변경 없음. 생성 SQL 검토 완료
- [x] ~~피킹 개별 세션의 `warehouseId` 출처~~ FO 상세 `warehouseId`를 `useFulfillmentOrder(foId)`로 조회해 스캔 mutation에 전달하도록 수정
- [x] ~~dev DB에 `npm run db:setup -- --stage dev --deployment lcnine-services` 적용~~ 완료 (seed 건너뜀, 스키마 실측 확인)
- [x] ~~피킹/검수 바코드 E2E~~ dev DB rollback 트랜잭션 실측 완료 (`SKU-{uuid}` / `FOI-{uuid}`); Enter→onScan UI 경로 코드 확인
- [x] 스키마 + drizzle SQL/meta를 포함해 전체 변경 단일 기능 커밋

## 8. 핵심 참고 경로

백엔드:

- `apps/core/src/modules/fulfillment/controllers/{fulfillments,picking,inspection,fulfillment-order}.controller.ts`
- `apps/core/src/modules/fulfillment/services/{picking-process,inspection}.service.ts`
- `apps/core/src/modules/fulfillment/dto/create-fulfillment-order.dto.ts`
- `apps/core/src/modules/inventory/schema/inventory.schema.ts` (fulfillment_orders/\_items, skus, skuBarcodes)

프론트:

- `apps/admin-web/src/features/order/{picking-list,inspection,outbound-batches,history}/`
- `apps/admin-web/src/lib/api/domains/orders/{picking,inspection,fulfillment-order}.client.ts`
- `apps/admin-web/src/lib/types/dto/fulfillment.ts`
- `apps/admin-web/src/lib/services/orders/{queries,mutations,query-keys}.ts`
- `apps/admin-web/src/components/common/barcode-scan-input/index.tsx`
- 선례: `apps/admin-web/src/features/users/`, `apps/admin-web/src/features/mall/products-list|products-detail/`
