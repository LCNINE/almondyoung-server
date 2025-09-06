# WMS 재고관리(Inventory) & 입고(Inbound) 개요

본 문서는 WMS 마이크로서비스에서 현재 실사용 중인 코어 재고관리(Inventory)와 입고(Inbound) 기능의 구조, 주요 엔드포인트, 데이터 흐름, 의존 스키마, 그리고 구현 상태를 요약합니다. 다른 도메인은 대체로 스텁 수준이므로 본 문서 범위에서 제외합니다.

## 구성요소 개요

- Controllers
  - `InventoryController` (`/wms/inventory`): 재고 조회/이력/요약, SKU/바코드, 창고 관리 API
  - `ProductMatchingController` (`/wms/matchings`): PIM Variant ↔ SKU 매칭 관리 API
  - `LocationController` (`/wms/locations`): 로케이션(열/랙/빈/구역) 관리 API
  - `InboundController` (`/wms/inbound`): 개별/간편/전수조사 간편입고, 입고 예정/검수, 입고 라인 메모, 적치/회송/입고취소, 각종 조회 API
  - `PurchaseOrderController` (`/wms/purchase-orders`): 발주 관리 API(스텁)

- Services (핵심 로직)
  - `InventoryService`: SKU/창고/요약 조회, SKU/바코드/창고 CRUD, 시스템 로케이션 프로비저닝 트리거
  - `InventoryCommandService`: 재고 상태 전이 명령(입고/예약/이동/조정 등) → 이벤트 생성
  - `InventoryQueryService`: 가용/수량 등 조회 보조
  - `StockEventStore`: 이벤트 생성/역분개 + 레저 투영(upsert) + 이력/통계 쿼리
  - `LocationService`: 시스템 로케이션 보장, 열/랙/빈/구역 CRUD, 페이징/검색
  - `StockEventService`: 초기 재고 생성용 입고 이벤트 래퍼(기타 출고/예약 등은 TODO)
  - `InboundService`: 개별/간편/전수조사 간편입고, 입고 예정/검수, 입고 라인 메모, 적치/회송/입고취소(원위치 실수량 검증, 당일 제한), 실적/타임라인/현황 조회, 바코드 검수
  - `ProductMatchingService`: 매칭 생성/해결/전략별 매핑, 매칭 정책 관리

- Database Schemas (발췌)
  - 재고 이벤트/레저: `stock_events`, `stock_ledgers`, `stock_summary`
  - 마스터/메타: `skus`, `sku_barcodes`, `warehouses`, `locations`, `location_columns`, `location_racks`
  - 매칭: `product_matchings`, `product_variant_sku_links`, `product_option_matchings`
  - 발주/입고: `purchase_orders`, `purchase_order_lines`, `inbound_lists`

## 재고 도메인

### 상태 모델과 전이

- 상태(`stock_state`): `ON_HAND`, `RESERVED_SALES`, `RESERVED_MOVE`, `DEFECTIVE`, `IN_TRANSFER`
- 전이(`transition_type`): `RECEIVE`, `RESERVE_SALES`, `UNRESERVE_SALES`, `SHIP`, `MOVE_*`, `TRANSFER_*`, `MARK_DEFECT`, `REWORK_GOOD`, `ADJUST_UP`, `ADJUST_DOWN`, … (양방향/역분개 포함)

### 이벤트 소싱 흐름(핵심)

1) 명령 호출: `InventoryCommandService`가 비즈니스 입력을 검증하고 `StockEventStore.createEvent(...)` 호출
2) 이벤트 기록: `stock_events`에 멱등키 기준 삽입(중복 방지), 상태/수량/창고/로케이션/시각 저장
3) 레저 투영: 동일 트랜잭션으로 `stock_ledgers`에 upsert(그레인: SKU×창고×로케×상태), 수량 증감과 음수 방지 체크
4) 조회: 원장(`stock_ledgers`) 또는 요약(`stock_summary`) 기반으로 컨트롤러에서 응답 구성
5) 역분개: `reverseEvent(eventId, reason)`로 반대 이벤트를 생성해 상쇄

### 주요 엔드포인트(InventoryController)

- GET `/wms/inventory/stocks`: 현재 원장 재고(필터: `skuId`, `warehouseId`, `locationId`, `stockType`, `asOfTimestamp`는 미지원)
- GET `/wms/inventory/stocks/summary`: 요약(이중 원장) 빠른 조회(옵션: `skuId`, `warehouseId`)
- GET `/wms/inventory/stocks/sku/:skuId/total`: SKU 전체 창고 합계
- GET `/wms/inventory/stocks/sku/:skuId/warehouse/:warehouseId`: 특정 창고 상세(요약+원장 디테일)
- POST `/wms/inventory/stocks/adjust`: 수동 조정(현재 `InventoryService.adjustStockManually`는 미지원 응답)
- GET `/wms/inventory/stocks/history`: 이벤트 이력 조회(기간/창고 필터)
- POST `/wms/inventory/stocks/summary/:skuId/:warehouseId/rebuild`: 요약 재구축(서비스는 추후 프로젝션 제공 예정)
- DELETE `/wms/inventory/stocks/events/:eventId/cancel`: 이벤트 취소(역분개)

- SKU 관리
  - POST `/wms/inventory/skus`: 생성(공급사/카테고리 링크 포함 트랜잭션 처리)
  - GET `/wms/inventory/skus`: 검색(코드/바코드/이름/공급사명 등 복합 조인 검색)
  - GET `/wms/inventory/skus/:id`: 상세 + 바코드/공급사/카테고리 로드
  - PUT `/wms/inventory/skus/:id`: 수정(연관 링크 재작성)
  - DELETE `/wms/inventory/skus/:id`: 삭제(원장 수량>0 또는 매칭 사용 중이면 409)
  - POST `/wms/inventory/skus/:id/barcodes`: 바코드 추가(중복 검사)
  - DELETE `/wms/inventory/skus/:id/barcodes/:barcodeId`: 바코드 제거(기본 바코드 보호)
  - GET `/wms/inventory/skus/:id/stock-summary`: SKU별 창고 요약 + 합계

- 창고 관리
  - POST `/wms/inventory/warehouses`: 생성(생성 직후 시스템 로케이션 보장)
  - GET `/wms/inventory/warehouses`: 목록
  - GET `/wms/inventory/warehouses/:id`: 조회
  - GET `/wms/inventory/warehouses/:id/summary`: 창고별 재고 요약
  - PATCH `/wms/inventory/warehouses/:id`: 수정
  - DELETE `/wms/inventory/warehouses/:id`: 삭제(기본/사용 중인 창고 보호)

### 로케이션 관리(LocationController)

- 시스템 로케이션: `LocationService.ensureSystemLocations(warehouseId)`로 `inbound_default` 등 보장
- 열/랙/빈/구역 관리와 페이징/검색 제공
- 주요 엔드포인트
  - POST `/wms/locations/warehouses/:warehouseId/columns` | GET 동일 경로(목록) | PUT `/columns/:columnId`
  - POST `/wms/locations/warehouses/:warehouseId/racks` | GET 동일 경로(목록) | PUT `/racks/:rackId`
  - POST `/wms/locations/warehouses/:warehouseId/zones`
  - GET `/wms/locations/warehouses/:warehouseId` (페이징/검색) | GET `/:locationId` | PUT `/:locationId`
  - POST `/wms/locations/warehouses/:warehouseId/racks/custom-bins`

### 상품 매칭(ProductMatching)

- 전략: `void`, `variant`, `option`
- 자동/수동 매칭 시 SKU 0수량 생성과 링크 작업을 진행(필요 시 `StockEventService.createStockEntry`로 0입고 이벤트)
- 주요 엔드포인트(`ProductMatchingController`)
  - GET `/wms/matchings` (status 필터)
  - PATCH `/:id/resolve` | `/:id/resolve-options` | `/:id/priority` | `/:id/strategy`
  - PATCH `/:id/stock-policy` | GET `/variants/:variantId/stock-policy`
  - POST `/variants/:variantId/sku-lookup`

## 입고 도메인(Inbound)

### 입고(Individual/Simple/Fullscan)

- POST `/wms/inbound/individual`
  - 입력: `{ warehouseId, skuId, quantity, locationId?, memo? }`
  - 설명: 단일 SKU를 지정 로케이션(없으면 기본입고존)으로 즉시 입고, 회차(method='individual')와 라인 메모 저장

- POST `/wms/inbound/simple`
  - 입력: `{ warehouseId, items[{ skuId, quantity, memo? }] }`
  - 설명: 여러 SKU를 기본입고존으로 일괄 입고, 회차(method='simple'), 라인 메모 저장

- POST `/wms/inbound/simple-fullscan`
  - 입력: `{ warehouseId, items[{ skuId, quantity, memo? }] }`
  - 설명: 전수조사 간편입고(서버 처리 동일), 회차(method='simple_fullscan')로 구분 기록

### 입고 예정/실적/검수

- GET `/wms/inbound/pending`
  - `purchase_orders.status='confirmed'` 대상 조회
  - 해외/국내 타입에 따라 기본 창고 기준으로 필터 가능
  - 응답: 발주/공급사/라인 묶음 + 총수량/총금액 집계

- GET `/wms/inbound/history` (옵션: `skuId`, `warehouseId`, `days`)
  - `StockEventStore.getEventHistory(...)`에서 기간 내 `transitionType='RECEIVE'`만 집계
  - 일자별 수량/건수 요약 + 최근 이벤트 일부 포함

### 적치/회송/입고취소/메모

- POST `/wms/inbound/putaway`
  - 입력: `{ lineId, toLocationId, quantity }`
  - 설명: 즉시 적치(예약→커밋 원자 처리). 원위치 잔량/실원장 수량 검증 후 진행

- POST `/wms/inbound/return`
  - 입력: `{ lineId, quantity }`
  - 설명: 회송. 제약: 원위치 실수량이 충분해야 함. 적치했다면 원위치로 이동 후 처리

- POST `/wms/inbound/cancel`
  - 입력: `{ lineId, quantity }`
  - 설명: 입고취소(정정). 제약: (1) 원위치 실수량 충분 (2) 당일(Asia/Seoul)만 허용

- POST `/wms/inbound/lines/:lineId/memo`
  - 입력: `{ memo }` (≤255자)
  - 설명: 입고 라인 메모 수정

### 조회(현황/타임라인/내역)

- GET `/wms/inbound/receipts`
  - 라인 단위 입고내역(메모 포함 가능) 조회

- GET `/wms/inbound/work-logs`
  - INBOUND/PUTAWAY/RETURN/CANCEL 타임라인 조회

- GET `/wms/inbound/status`
  - 입고현황(라인 기준) 조회. `confirmedQty = quantity - returnedQty`(취소분 제외)

## 데이터 모델(요약)

- 이벤트: `stock_events`(전이, 멱등, 상태/방향/사유/시각), `stock_ledgers`(그레인별 누계, 음수 방지), `stock_summary`(프로젝션)
- 마스터: `skus`(기본 바코드, 타입), `sku_barcodes`(여러 바코드), `warehouses`, `locations`(+ 시스템 역할)
- 매칭: `product_matchings`(+ 정책), `product_variant_sku_links`, `product_option_matchings`
- 발주: `purchase_orders`(type/status/supplier), `purchase_order_lines`(sku/수량/단가)
- 입고: `inbound_receipts`(method, warehouse/location, occurredAt, totalQuantity, journalId),
        `inbound_receipt_lines`(receiptId, skuId, quantity, originLocationId, eventId, memo, returnedQty, canceledQty, putawayFromOriginQty),
        `inbound_plans`/`inbound_plan_items`

## 현재 상태와 제한사항

- 수동 조정 API는 엔드포인트만 있고 서비스에서 미지원 처리(`BadRequestException`)
- 재고 요약 재구축(프로젝션)은 추후 별도 서비스에서 제공 예정
- 출고/예약/이동 등의 전이 명령은 `InventoryCommandService`에 구현되어 있으나, 컨트롤러 노출은 미비
- `PurchaseOrderController`/`PurchaseOrderService`는 스텁 상태(발주 생성/관리 미구현)
- 입고취소는 당일(Asia/Seoul)만 허용(설정화 가능), 회송/취소는 원위치 실수량 부족 시 400
- `StockEventService`는 입고(초기/0수량 포함)만 구현, 출고/예약/반품/손상 등은 TODO

## 참고

- 컨트롤러: `apps/wms/src/inventory/controllers/*.ts`, `apps/wms/src/inbound/controllers/*.ts`
- 서비스: `apps/wms/src/inventory/services/*.ts`, `apps/wms/src/inbound/services/*.ts`
- 레포지토리/프로젝션: `apps/wms/src/inventory/repositories/stock-event.store.ts`
- 스키마: `apps/wms/database/schemas/wms-schema.ts`



