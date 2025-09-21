# 재고 상태 아키텍처 설계

## 설계 원칙

### 도메인별 단일 진실의 원천 (SoT) 분리
각 도메인이 자신의 책임 영역에서만 데이터를 관리하고, 상위 집계 레이어에서 이를 수합하는 구조

### 모듈화된 예약 시스템
재고 예약을 독립적인 서비스 계층으로 분리하여 다양한 도메인(출고, 이동작업 등)에서 공통으로 사용

## 재고 상태별 SoT 매핑

### 1. 물리적 재고 상태 (stockLedgers 테이블)

#### **ON_HAND** - 출고가능 재고
- **의미**: 창고에 물리적으로 존재하며 즉시 사용 가능한 재고
- **SoT**: `stockLedgers` (stockState = 'ON_HAND')
- **관리 주체**: Inventory Domain
- **변경 시점**: 입고, 출고, 재고조정, 품질변경 시

#### **DEFECTIVE** - 불량 재고
- **의미**: 물리적으로 존재하지만 품질 문제로 사용 불가능한 재고
- **SoT**: `stockLedgers` (stockState = 'DEFECTIVE')
- **관리 주체**: Inventory Domain
- **변경 시점**: 품질검사 결과, 불량 처리, 재작업 시

#### **IN_TRANSFER** - 창고간 이동중 재고
- **의미**: 창고간 이동 중이어서 일시적으로 접근 불가능한 재고
- **SoT**: `stockLedgers` (stockState = 'IN_TRANSFER')
- **관리 주체**: Transfer Domain
- **변경 시점**: 창고간 이동 시작/완료 시

### 2. 예약 상태 (stockReservations 테이블)

#### **예약된 재고** - 특정 작업에 할당된 재고
- **의미**: ON_HAND 재고 중 특정 작업(출고, 이동)에 예약되어 다른 용도로 사용 불가능한 재고
- **SoT**: `stockReservations` 테이블
- **관리 주체**: Reservation Service
- **예약 타입**:
  - **Fulfillment Order 예약**: 출고 주문에 할당된 재고
  - **Movement 예약**: 창고내/창고간 이동작업에 할당된 재고

#### stockReservations 테이블 구조
```sql
stockReservations:
  reservationId       -- 예약 고유 ID
  targetType          -- 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK'
  targetId             -- FO ID 또는 Movement Task ID
  skuId                -- 예약된 SKU
  warehouseId          -- 예약된 창고
  quantity             -- 예약 수량
  status               -- 'PENDING' | 'CONFIRMED' | 'RELEASED'
  timeoutAt            -- 예약 만료 시간
  createdAt, updatedAt
```

### 3. 예정/계획 상태 (각 도메인별 테이블)

#### **입고 예정 재고**
- **의미**: 발주/이동으로 인해 앞으로 입고될 예정인 재고
- **SoT**: `inboundPlans` 테이블
- **관리 주체**: Inbound Domain

#### **발주중 재고** (미래 구현)
- **의미**: 공급업체에 발주했지만 아직 입고되지 않은 재고
- **SoT**: `purchaseOrders` 테이블
- **관리 주체**: Purchase Domain

#### **창고간 이동 예정 재고** (미래 구현)
- **의미**: 창고간 이동이 계획되었지만 아직 시작되지 않은 재고
- **SoT**: `transferOrders` 테이블
- **관리 주체**: Transfer Domain

## 예약 서비스 (Reservation Service) 설계

### 핵심 책임
1. **예약 생성/해제**: 다양한 도메인의 예약 요청 처리
2. **예약 상태 관리**: 예약의 생명주기 관리 (PENDING → CONFIRMED → RELEASED)
3. **예약 가시성**: 예약 현황 조회 및 분석

### 주요 메서드

#### 예약 관리
```typescript
// 재고 예약
reserveStock(dto: {
  targetType: 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK';
  targetId: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
  timeoutAt?: Date;
}): Promise<Reservation>

// 예약 해제
releaseReservation(reservationId: string): Promise<void>

// 예약 이전 (FO간, Task간)
transferReservation(fromReservationId: string, toTargetId: string): Promise<void>
```

#### 조회 메서드
```typescript
// 특정 FO/이동작업의 예약 현황
getReservationsByTarget(targetType: string, targetId: string): Promise<Reservation[]>

// 특정 SKU의 예약 현황 (어떤 FO/Task에 묶여있는지)
getReservationsBySku(skuId: string, warehouseId?: string): Promise<Reservation[]>

// SKU별 총 예약 수량
getTotalReservedQuantity(skuId: string, warehouseId: string): Promise<number>

// 창고별 예약 통계
getReservationSummary(warehouseId: string): Promise<ReservationSummary[]>
```

## stockSummary 집계 View 설계

### 계산 로직
각 도메인의 SoT로부터 실시간으로 집계하여 통합된 재고 현황 제공

```sql
CREATE VIEW stock_summary_view AS
SELECT
    s.id as sku_id,
    w.id as warehouse_id,
    s.name as sku_name,
    w.name as warehouse_name,

    -- 물리적 재고 (stockLedgers 기반)
    COALESCE(on_hand.qty, 0) as on_hand_qty,
    COALESCE(defective.qty, 0) as defective_qty,
    COALESCE(in_transfer.qty, 0) as in_transfer_qty,

    -- 예약 상태 (stockReservations 기반)
    COALESCE(reserved.qty, 0) as reserved_qty,
    COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) as available_qty,

    -- 예정 상태 (각 도메인 테이블 기반)
    COALESCE(inbound_pending.qty, 0) as inbound_pending_qty,
    COALESCE(on_order.qty, 0) as on_order_qty,           -- 미래: purchaseOrders
    COALESCE(transfer_pending.qty, 0) as transfer_pending_qty, -- 미래: transferOrders

    -- 계산된 전망
    COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0)
    + COALESCE(inbound_pending.qty, 0) + COALESCE(on_order.qty, 0)
    + COALESCE(transfer_pending.qty, 0) as projected_available_qty,

    NOW() as last_calculated_at

FROM skus s
CROSS JOIN warehouses w
LEFT JOIN (
    SELECT sku_id, warehouse_id, SUM(qty) as qty
    FROM stock_ledgers
    WHERE stock_state = 'ON_HAND'
    GROUP BY sku_id, warehouse_id
) on_hand ON s.id = on_hand.sku_id AND w.id = on_hand.warehouse_id

LEFT JOIN (
    SELECT sku_id, warehouse_id, SUM(qty) as qty
    FROM stock_ledgers
    WHERE stock_state = 'DEFECTIVE'
    GROUP BY sku_id, warehouse_id
) defective ON s.id = defective.sku_id AND w.id = defective.warehouse_id

LEFT JOIN (
    SELECT sku_id, warehouse_id, SUM(quantity) as qty
    FROM stock_reservations
    WHERE status = 'CONFIRMED'
    GROUP BY sku_id, warehouse_id
) reserved ON s.id = reserved.sku_id AND w.id = reserved.warehouse_id

LEFT JOIN (
    SELECT sku_id, warehouse_id, SUM(quantity) as qty
    FROM inbound_plans
    WHERE status = 'PENDING'
    GROUP BY sku_id, warehouse_id
) inbound_pending ON s.id = inbound_pending.sku_id AND w.id = inbound_pending.warehouse_id

-- 기타 조인들...
```

## 변경 사항 요약

### 제거할 요소
1. **stockLedgers의 RESERVED_* 상태**
   - `RESERVED_SALES` 상태 제거
   - `RESERVED_MOVE` 상태 제거

2. **inventory-command.service.ts의 예약 메서드**
   - `reserveSales()` 메서드 제거
   - `unreserveSales()` 메서드 제거
   - `moveReserve()` 메서드 제거
   - `unreserveMove()` 메서드 제거

3. **stockSummary 테이블**
   - 물리적 테이블을 view로 전환
   - reservations.service.ts의 직접 업데이트 로직 제거

### 강화할 요소
1. **stockReservations 테이블**
   - 모든 예약의 단일 SoT로 강화
   - FO 예약과 Movement 예약 통합 관리

2. **Reservation Service**
   - 통합된 예약 관리 로직
   - 다양한 조회 메서드 제공
   - 예약 생명주기 관리

3. **도메인별 SoT 순수성**
   - 각 도메인이 자신의 책임 영역만 관리
   - 교차 도메인 의존성 최소화

## 기대 효과

### 단기 효과
- **데이터 일관성**: 예약 데이터의 단일 SoT 확보
- **코드 간소화**: 중복된 예약 로직 제거
- **모듈성 향상**: 예약 서비스의 독립성 확보

### 장기 효과
- **확장성**: 새로운 예약 타입 추가 용이
- **유지보수성**: 명확한 책임 분리로 버그 감소
- **성능**: 불필요한 중복 연산 제거
- **감사성**: 예약 이력 추적 및 분석 강화