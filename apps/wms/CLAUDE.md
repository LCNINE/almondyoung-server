# WMS (Warehouse Management System) — App-Level CLAUDE.md

> 프로젝트 공통 규칙(레이어 아키텍처, 트랜잭션 전파, 코드 스타일 등)은 루트 `CLAUDE.md`를 따른다.
> 이 문서는 **WMS 앱에만 해당하는** 맥락을 다룬다.

## 1. 앱의 역할과 경계

### 책임지는 것
- **재고 관리**: SKU 수명주기(생성·수정·삭제), 재고 수량 추적, 가용재고 계산
- **입고(Inbound)**: 발주(PO) → 입고계획 → 입고검수 → 재고 반영
- **출고(Outbound)**: 판매주문(SO) 수신 → 출고지시(FO) 생성 → 피킹·검품·송장 발행 → 출고
- **이동(Movement)**: 창고 내/창고 간 재고 이동
- **재고실사(Stocktaking)**: 실물 재고 카운트 및 조정
- **예약(Reservation)**: 출고지시·이동작업에 대한 재고 예약/해제
- **상품-SKU 매칭**: PIM 상품 ↔ WMS SKU 매핑 관리
- **거래처(Supplier)**: 거래처 마스터 데이터 관리

### 책임지지 않는 것
- 상품 카탈로그(PIM 담당) — WMS는 `products.events.v1` 스트림으로 상품 변경을 수신만 함
- 주문 생성/결제(Medusa 담당) — WMS는 `orders.events.v1` 스트림으로 주문을 수신만 함
- 사용자 인증/인가(user-service 담당) — JWT 토큰 검증만 수행
- 배송 추적(외부 TMS 담당) — 송장 발행 시 Goodsflow API 호출 후 넘김

## 2. Source of Truth (SoT)

| 데이터 | SoT 테이블 | 비고 |
|--------|-----------|------|
| 재고 수량 | `stock_events` (이벤트 로그) | `stock_ledgers`는 프로젝션(캐시), `stock_summary`는 뷰 |
| SKU 마스터 | `skus` | 바코드·무게·부피·재고유형 등 |
| 창고·로케이션 | `warehouses`, `locations` | 계층구조: Column → Rack → Bin / Zone |
| 재고 예약 | `stock_reservations` | 출고지시(FO)·이동작업 공통 테이블 |
| 발주(PO) | `purchase_orders`, `purchase_order_lines` | 감사(audit) 워크플로 포함 |
| 입고 계획·실적 | `inbound_plans`, `inbound_receipts` | 이중 계획(source/destination) |
| 판매주문(SO) | `sales_orders`, `sales_order_lines` | 외부 주문 수신 후 WMS 내부 사본 |
| 출고지시(FO) | `fulfillment_orders`, `fulfillment_order_items` | 매핑 스냅샷 포함 |
| 상품-SKU 매핑 | `product_sku_mappings` | 스냅샷: `product_sku_mapping_snapshots` |
| 감사 로그 | `audit_logs` | 22개 이벤트 타입 |

## 3. 핵심 설계 패턴

### 3.1 이벤트 소싱 (재고)

재고 수량의 진짜 원본은 `stock_events` 테이블이다.

```
stock_events (불변 이벤트 로그)
  ↓ applyProjection()
stock_ledgers (PK: skuId + warehouseId + locationId + stockState → qty)
  ↓ PostgreSQL VIEW
stock_summary (skuId + warehouseId 기준 가용재고·예약·입고예정 집계)
```

- **Transition types**: `RECEIVE`, `SHIP`, `MOVE`, `MARK_DEFECT`, `REWORK_GOOD`, `SCRAP`, `ADJUST_UP`, `ADJUST_DOWN`
- **Event status**: `PENDING` → `POSTED` / `VOIDED` (역분개 시 `voidedByEventId`로 추적)
- **멱등성**: `idempotencyKey` unique 제약으로 중복 이벤트 방지
- **비음수 제약**: `stock_ledgers.qty >= 0` — 음수 재고 불가

### 3.2 Transactional Outbox

도메인 변경과 이벤트 발행을 같은 DB 트랜잭션으로 보장한다.

```
도메인 로직 + OutboxService.enqueue() → 같은 TX
     ↓
OutboxDispatcherService (@Cron 10초)
  SELECT ... FOR UPDATE SKIP LOCKED (동시성 안전)
     ↓
Kafka: FULFILLMENT_STREAM, INVENTORY_STREAM
```

- 재시도 최대 5회, `next_attempt_at` 기반 백오프
- 상태: `pending` → `published` / `failed`

### 3.3 통합 예약 모델

`stock_reservations` 하나로 출고지시와 이동작업 예약을 모두 처리한다.

- `targetType`: `FULFILLMENT_ORDER` | `MOVEMENT_TASK`
- `status`: `confirmed` (활성) → `released` (해제)
- 출고 시 FIFO 기반 부분 해제 지원 (`ReservationLifecycleService`)

### 3.4 매핑 스냅샷

FO 생성 시점에 상품-SKU 매핑을 `product_sku_mapping_snapshots`에 동결한다.
이후 매핑이 바뀌어도 이미 생성된 FO에는 영향 없음.

### 3.5 로케이션 계층

| 유형 | 구조 | 용도 |
|------|------|------|
| Standard | Column → Rack → Bin | 정위치 보관, FIFO 랭킹, 유효기한 분리 |
| Zone | 평면 네임드 영역 | 반품함, 입고 스테이징 등 |

시스템 로케이션 역할(`system_location_role`): `inbound_default`, `return_default`

## 4. 외부 연동

### Kafka 수신 (Consumer)

| 스트림 | 이벤트 | 처리 |
|--------|--------|------|
| `products.events.v1` | ProductVariantCreated, ProductInventoryManagementChanged, ProductVariantDeleted | `ProductEventConsumer` → 상품-SKU 매칭 |
| `orders.events.v1` | OrderCreated, OrderConfirmed, OrderCancelled, OrderModified | `OrderEventsConsumer` → 판매주문 생성/갱신 |

- Consumer group: `wms-consumer`
- 멱등성: `orderEvents.eventId` unique 제약

### Kafka 발행 (Producer — Outbox 경유)

| 스트림 | 이벤트 |
|--------|--------|
| `fulfillments.events.v1` | FulfillmentCreated, Ready, Labeled, Shipped, Delivered, Cancelled, Returned |
| `inventory.events.v1` | 재고 변동 이벤트 |

### 외부 HTTP
- **Goodsflow**: 택배 송장 발행 (`GoodsflowDeliveryProvider`)

### 내부 라이브러리 의존
- `@app/db` — Drizzle ORM, `DbService`, `@InjectTypedDb`
- `@app/events` — Kafka consumer/producer, EventsModule
- `@app/authorization` — JwtAuthGuard, `@Public()`
- `@packages/event-contracts` — 스트림 정의, 페이로드 타입

## 5. 모듈 구조

```
src/
├── inventory/          # 재고·SKU·로케이션·예약·반품·이관
│   ├── controllers/    # 6개: inventory, sku, location, reservation, return, transfer, sku-group, holder, product-matching
│   ├── services/       # InventoryCommandService, InventoryQueryService, AllocationStrategyService,
│   │                   # StockEventService, SkuLocationMovementService, LocationService,
│   │                   # SafetyStockService, SkuGroupService, HolderService 등 15+
│   ├── repositories/   # StockEventStore (이벤트 저장 + 프로젝션)
│   ├── handlers/       # ProductEventConsumer (Kafka)
│   └── strategies/     # VariantMatchingStrategy, VoidMatchingStrategy
│
├── order/              # 주문 수신 → 출고지시 → 피킹·검품·송장·배치
│   ├── sales-orders/   # SalesOrdersService (Kafka 주문 수신)
│   ├── fulfillments/   # 9개 컨트롤러: FO, batch, picking, inspection, consolidation, invoice 등
│   ├── matchings/      # ProductSkuMappingService (매핑 + 스냅샷)
│   ├── shared/         # FulfillmentOrderTransactionService, OutboxService, OutboxDispatcherService
│   └── consumers/      # OrderEventsConsumer (Kafka)
│
├── inbound/            # 발주(PO) → 입고계획 → 입고검수
│   └── services/       # InboundService, PurchaseOrderService, PurchaseOrderCronService
│
├── movement/           # 창고 내/간 재고 이동
├── stocktaking/        # 재고실사
├── suppliers/          # 거래처 마스터
└── shared/             # 공통 서비스: Barcode, FIFO, Transaction, Audit, Metrics, Health,
                        # UnifiedReservationService, ReservationLifecycleService
```

## 6. 스키마 구조 요약

단일 파일 `database/schemas/wms-schema.ts` (~3000줄)에 모든 테이블이 정의되어 있다.

### 핵심 테이블 그룹

**재고 이벤트 소싱**
- `stock_events` — 불변 이벤트 로그 (transition_type, from/to state·warehouse·location, qty, idempotencyKey)
- `stock_ledgers` — 프로젝션 (PK: skuId+warehouseId+locationId+stockState → qty)
- `stock_journals` — 이벤트 논리 그룹핑
- `stock_summary` — PostgreSQL VIEW (가용·불량·이동중·예약·입고예정 집계)
- `stock_reservations` — 통합 예약 (targetType: FO | MOVEMENT_TASK)

**SKU·마스터**
- `skus` — SKU 마스터 (code unique, stockType, weight, volume)
- `sku_images`, `sku_suppliers`, `sku_categories` — M:N 관계
- `sku_groups`, `sku_group_items` — SKU 그룹핑
- `warehouses`, `locations` — 창고·로케이션 (standard/zone)
- `holders` — 보유자(법인) 엔티티

**입고**
- `purchase_orders` / `purchase_order_lines` — 발주 (audit 워크플로: draft→pending_audit→approved)
- `inbound_plans` / `inbound_plan_items` — 이중 계획 (source/destination)
- `inbound_receipts` / `inbound_receipt_lines` — 입고 실적 (posted/voided)

**주문·출고**
- `sales_orders` / `sales_order_lines` — 외부 주문 사본
- `order_events` — 수신 이벤트 멱등성 (eventId unique)
- `fulfillment_orders` / `fulfillment_order_items` — 출고지시
- `product_sku_mappings` / `product_sku_mapping_snapshots` — 상품↔SKU 매핑
- `outbound_batches` / `outbound_batch_items` — 출고 배치
- `outbox_events` — Transactional Outbox

**기타**
- `suppliers` / `supplier_categories` — 거래처
- `audit_logs` — 감사 로그
- `wms_settings` — 앱 설정 (use_sub_barcode, use_expiry_separation)
