# WMS 출고 시스템 구현 계획서

## 1. 개요

### 1.1 목적
AlmondYoung WMS의 마지막 핵심 모듈인 출고 시스템을 구현하여 완전한 창고 관리 솔루션을 완성한다.

### 1.2 범위
- 판매주문(SO)에서 출고주문(FO)으로의 변환 및 관리
- 개별출고 및 토탈피킹 작업 프로세스
- 송장 발급 및 택배사 연동 (굿스플로 API)
- 합배송 및 송장분리 처리
- 직배(Drop-ship) 및 3PL 출고 지원

### 1.3 현재 상황
- 기존 구현: 재고관리, 입고, 이동, 주문(SO/FO) 기본 구조
- 미구현: 출고 작업 프로세스, 송장 관리, 피킹/검수 워크플로우

## 2. 비즈니스 요구사항

### 2.1 주문 도메인 구조

#### 2.1.1 SO (Sales Order) - 판매주문
- **SoT (Source of Truth)**: 각 판매채널 (메두사, 쿠팡, 네이버 등)
- **특징**:
  - PIM의 판매상품(Variant) 기준으로 구성
  - 채널별 주문 하나에 대응
  - 물리적 통합 금지 (SoT 원칙)

#### 2.1.2 FO (Fulfillment Order) - 출고주문
- **SoT**: WMS
- **특징**:
  - WMS의 재고상품(SKU) 기준으로 구성
  - 송장/택배상자 하나에 대응
  - SO와 다양한 관계 (1:1, 1:N, N:1) 지원

#### 2.1.3 SO-FO 관계 패턴
```
일반 출고     : SO(1) → FO(1)  - 가장 일반적
송장 분리     : SO(1) → FO(N)  - 부피 큰 상품, 배송방식 다른 경우
합배송        : SO(N) → FO(1)  - 여러 SO를 하나의 FO로 통합 (SO 원본은 유지)
```

**중요**: SO 자체를 물리적으로 병합하지 않음. SoT 원칙에 따라 각 판매채널의 SO는 독립성을 유지하고,
WMS 내부에서만 FO 레벨의 합배송을 지원.

### 2.2 상태 관리

#### 2.2.1 FO 상태 흐름
```
출고요청(재고부족) → 출고요청(출고가능) → 출고지시 → 출고작업중 → 출고완료
                                              ↓
                                          출고취소 (모든 단계에서 가능)
```

- **출고요청(재고부족)**: 재고 예약이 완전하지 않은 상태
- **출고요청(출고가능)**: 재고 예약 완료, 출고 작업 대기
- **출고지시**: 출고회차에 할당, 예약된 재고 고정
- **출고작업중**: 송장번호 발급 완료, 피킹/검수 진행
- **출고완료**: 포장 완료, 재고 차감
- **출고취소**: 예약 해제, 재고 복원

#### 2.2.2 SO 상태 결정 로직
- **매칭누락**: 판매상품-재고상품 매칭 미완료
- **기타**: 연관된 FO들 중 가장 이전 단계의 상태를 따름

### 2.3 배송 방식별 분류

#### 2.3.1 소유자(Holder) 기준
- **자사 상품**: `holderId = 자사` - 미용재료 등 주력 상품, 일반택배로 출고
- **3PL 상품**: `holderId = 타사` - 허브 등 타업종 상품, 자사 상품과 별도 판매채널
- **직배 상품**: 특정 브랜드의 미용재료, 브랜드사 창고에서 직접 배송

**현실적 패턴**:
- 3PL 상품은 판매채널 자체가 다르므로 자사 상품과 함께 주문되지 않음
- 직배 상품은 자사 상품과 동일 카테고리로 함께 주문 가능

#### 2.3.2 배송 방식
- **일반택배**: 굿스플로 API 연동, 택배사 송장 발급
- **자체배송**: 자체 송장번호, 직원이 트럭으로 배송
- **직배**: 타사 창고에서 직접 배송, 별도 워크플로우

#### 2.3.3 직배 전용 워크플로우
직배 FO는 일반 출고회차와 분리하여 관리:
- **출고회차 제외**: 직배 FO는 피킹/검수 배치에 포함되지 않음
- **별도 조회**: 직배 전용 관리 페이지에서 회사별 분류 조회
- **파일 내보내기**: 회사별로 주문 리스트를 엑셀 등 형식으로 내보내기
- **수동 완료**: 관리자가 "해당 회사에 전달 완료" 체크 시 출고완료 처리

## 3. 기술 요구사항

### 3.1 데이터 모델 확장

#### 3.1.1 판매상품→재고상품 매핑 및 수요 관리
```typescript
// 판매상품→재고상품 매핑 규칙 (WMS가 SoT)
interface ProductSkuMap {
  id: string;
  productId: string;        // PIM의 판매상품 ID
  version: number;          // 매핑 버전
  effectiveFrom: Date;      // 적용 시작일
  shipTogether: boolean;    // 세트 상품 여부
  warehouseId: string;
}

interface ProductSkuMapItem {
  id: string;
  mapId: string;
  skuId: string;           // WMS의 재고상품 ID
  qtyPerProduct: number;   // 판매상품 1개당 필요한 SKU 수량
}

// SKU 수요 (SO 라인을 SKU로 "폭발"한 결과, 주문시점 스냅샷)
interface SkuDemand {
  id: string;
  soId: string;            // 원본 SO
  solId: string;           // 원본 SO 라인
  skuId: string;           // 실제 재고상품
  qty: number;             // 필요 수량
  kitGroup?: string;       // 세트/키트 묶음 식별자 (UUID)
  mappingVersion: number;  // 사용된 매핑 버전 (스냅샷)
  state: 'pending' | 'allocated' | 'fulfilled' | 'cancelled';
  createdAt: Date;
}

// FO-수요 할당 (FO가 어떤 수요를 몇 개 집행하는지)
interface FoAllocation {
  foId: string;
  skuDemandId: string;
  qty: number;             // 할당된 수량
  allocatedAt: Date;
}

// 기존 FO 테이블 (salesOrderId 제거)
interface FulfillmentOrder {
  id: string;
  warehouseId: string;
  ownerId?: string;
  status: FOStatus;
  shippingAddress: any;
  carrierService?: string;
  latestShipBy?: Date;
  lockedAt?: Date;         // 구조 변경 금지 시점
  labelNo?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### 3.1.2 출고회차 관리
```typescript
// 출고회차 (Outbound Batch)
interface OutboundBatch {
  id: string;
  batchNumber: string; // OB-20250118-001
  warehouseId: string;
  status: 'created' | 'picking' | 'completed';
  pickingMethod: 'individual' | 'total_picking';
  cartCapacity?: number; // 토탈피킹 시 바구니 수
  assignedTo?: string; // 작업자 ID
  createdAt: Date;
  completedAt?: Date;
}

// FO-Batch 연결 (출고지시 시 배치 할당)
interface FulfillmentOrderBatch {
  fulfillmentOrderId: string;
  batchId: string;
  assignedAt: Date;
  removedAt?: Date; // 배치에서 제외된 시점
  removeReason?: string; // 재고부족, 오류 등
}
```

#### 3.1.2.1 상태 관리 개선방안
**문제**: FO 상태와 배치 상태의 이원화로 인한 복잡성
**해결방안**:
- **FO 상태 우선**: 개별 FO 상태가 실제 비즈니스 로직을 담당
- **배치 상태 단순화**: 전체적인 진행도만 표시 (진행률 기반)
- **동적 배치 관리**: 문제 발생한 FO는 배치에서 제외하고 개별 처리
- **상태 동기화**: FO 상태 변경 시 배치 상태 자동 업데이트

#### 3.1.3 송장 관리
```typescript
interface Invoice {
  id: string;
  fulfillmentOrderId: string;
  invoiceNumber: string; // 송장번호
  carrierCode?: string; // 택배사 코드 (CJ, LOTTE 등)
  issueMethod: 'goodsflow' | 'direct' | 'self'; // 발급 방식
  goodsflowServiceId?: string; // 굿스플로 서비스 ID
  status: 'issued' | 'printed' | 'shipped';
  issuedAt?: Date;
  printedAt?: Date;
}
```

#### 3.1.4 재고 예약 시스템 개선
```typescript
// 재고 예약 (sku_demands가 소유자)
interface StockReservation {
  id: string;
  skuDemandId: string;     // 예약 소유자 (기존 solId 대신)
  skuId: string;
  warehouseId: string;
  locationId?: string;
  foId?: string;           // hard allocate 시 귀속 FO
  qty: number;
  state: 'soft' | 'hard' | 'picked' | 'consumed' | 'released' | 'expired';
  expiresAt?: Date;        // soft 예약 만료시간
  createdAt: Date;
}

// SO-FO 관계 뷰 (직접 매핑 테이블 대신 파생)
// create view so_fo_links as
// select distinct sd.so_id, fa.fo_id
// from fo_allocations fa
// join sku_demands sd on sd.id = fa.sku_demand_id;
```

#### 3.1.5 피킹/검수 작업 관리
```typescript
interface PickingTask {
  id: string;
  batchId: string;
  fulfillmentOrderId: string;
  skuId: string;
  requiredQty: number;
  pickedQty: number;
  verifiedQty: number; // 검수 완료 수량
  status: 'pending' | 'picking' | 'picked' | 'verified';
  basketNumber?: number; // 토탈피킹 시 바구니 번호
  pickedAt?: Date;
  verifiedAt?: Date;
}

// FO별 SKU 집계 (fo_allocations 기반 materialized view 또는 캐시 테이블)
interface FulfillmentOrderSku {
  foId: string;
  skuId: string;
  totalQty: number;        // fo_allocations 합계
  updatedAt: Date;
}
```

### 3.2 API 설계

#### 3.2.1 SKU 수요 및 FO 할당 API
```typescript
// SKU 수요 생성 (SO 수신 시 자동 호출)
POST /api/outbound/sku-demands/explode
{
  "salesOrderId": "so-1",
  "salesOrderLineId": "sol-1",
  "productId": "prod-1",
  "qty": 2
}

// FO 생성 및 수요 할당
POST /api/outbound/fulfillment-orders
{
  "skuDemandAllocations": [
    {
      "skuDemandId": "demand-1",
      "qty": 2
    },
    {
      "skuDemandId": "demand-2",
      "qty": 1
    }
  ],
  "shippingAddress": {...},
  "carrierService": "CJ"
}

// FO 합배송 (여러 수요를 기존 FO에 할당)
POST /api/outbound/fulfillment-orders/{foId}/allocate
{
  "skuDemandAllocations": [
    {
      "skuDemandId": "demand-3",
      "qty": 1
    }
  ]
}

// FO 분할 (일부 할당을 새 FO로 이동)
POST /api/outbound/fulfillment-orders/{foId}/split
{
  "newFoAllocations": [
    {
      "skuDemandId": "demand-1",
      "qty": 1  // 기존 2개 중 1개만 이동
    }
  ]
}
```

#### 3.2.2 출고회차 관리 API
```typescript
// 출고지시 생성
POST /api/outbound/batches
{
  "fulfillmentOrderIds": ["fo-1", "fo-2"],
  "pickingMethod": "individual" | "total_picking",
  "cartCapacity": 20,
  "warehouseId": "wh-1"
}

// 출고회차 조회
GET /api/outbound/batches?status=created&warehouseId=wh-1

// 출고회차 상세
GET /api/outbound/batches/{batchId}
```

#### 3.2.3 개별출고 API
```typescript
// 개별출고 시작 (송장번호 또는 FO ID로)
POST /api/outbound/individual/start
{
  "fulfillmentOrderId": "fo-1",
  "invoiceNumber": "1234567890" // 선택적
}

// 바코드 스캔
POST /api/outbound/individual/scan
{
  "taskId": "task-1",
  "barcode": "8801234567890"
}

// 검수 초기화
POST /api/outbound/individual/reset
{
  "fulfillmentOrderId": "fo-1"
}

// 강제 출고
POST /api/outbound/individual/force-ship
{
  "fulfillmentOrderId": "fo-1"
}

// FO 분할
POST /api/outbound/individual/split
{
  "fulfillmentOrderId": "fo-1",
  "splitItems": [
    { "skuId": "sku-1", "quantity": 5 }
  ]
}
```

#### 3.2.4 토탈피킹 API
```typescript
// 토탈피킹 시작
POST /api/outbound/total-picking/start
{
  "batchId": "batch-1"
}

// 다음 피킹 아이템 조회
GET /api/outbound/total-picking/next/{batchId}

// 상품 스캔 (바구니별 수량 표시)
POST /api/outbound/total-picking/scan
{
  "batchId": "batch-1",
  "barcode": "8801234567890"
}

// 피킹 완료, 검수 단계 전환
POST /api/outbound/total-picking/complete-picking/{batchId}

// 개별 검수 진행 (개별출고와 동일한 API 사용)
```

#### 3.2.5 송장 관리 API
```typescript
// 송장 발급
POST /api/outbound/invoices/issue
{
  "fulfillmentOrderId": "fo-1",
  "carrierCode": "CJ"
}

// 송장 출력 URI 생성
GET /api/outbound/invoices/{invoiceId}/print-uri

// 송장 일괄 출력
POST /api/outbound/invoices/batch-print
{
  "batchId": "batch-1"
}
```

#### 3.2.6 직배 관리 API
```typescript
// 직배 대기 FO 목록 조회
GET /api/outbound/drop-ship/pending?holderId=company-1

// 회사별 직배 FO 엑셀 내보내기
POST /api/outbound/drop-ship/export
{
  "holderId": "company-1",
  "fulfillmentOrderIds": ["fo-1", "fo-2"],
  "format": "excel" | "csv"
}

// 직배 완료 처리 (수동)
POST /api/outbound/drop-ship/complete
{
  "fulfillmentOrderIds": ["fo-1", "fo-2"],
  "completedBy": "admin-1",
  "memo": "2025-01-18 회사 A에 이메일로 전달 완료"
}

// 직배 현황 조회
GET /api/outbound/drop-ship/status?from=2025-01-01&to=2025-01-31
```

### 3.3 외부 연동

#### 3.3.1 굿스플로 API 연동
```typescript
interface GoodsflowService {
  // 송장 발급
  issueInvoice(request: {
    centerCode: string;
    recipientName: string;
    recipientAddress: string;
    recipientPhone: string;
    items: Array<{
      productName: string;
      quantity: number;
      price: number;
    }>;
    carrierCode: string;
  }): Promise<{
    serviceId: string;
    invoiceNumber: string;
  }>;

  // 송장 출력 URI 생성
  generatePrintUri(serviceIds: string[]): Promise<{
    printUri: string;
  }>;

  // 배송 추적
  trackDelivery(serviceId: string): Promise<{
    status: string;
    location: string;
    timestamp: string;
  }>;

  // 송장 취소
  cancelInvoice(serviceId: string): Promise<void>;
}
```

#### 3.3.2 배송 프로바이더 추상화
```typescript
interface DeliveryProvider {
  issueInvoice(fo: FulfillmentOrder): Promise<string>;
  printInvoice(invoiceNumber: string): Promise<Buffer>;
  trackShipment(invoiceNumber: string): Promise<ShipmentStatus>;
  cancelInvoice(invoiceNumber: string): Promise<void>;
}

class GoodsflowProvider implements DeliveryProvider { ... }
class DirectShippingProvider implements DeliveryProvider { ... }
class SelfDeliveryProvider implements DeliveryProvider { ... }
```

## 4. 구현 계획

### 4.0 Phase 0: 기존 코드 리팩토링 (20%)

#### 4.0.1 FO 상태 관리 개선
- [ ] 기존 `fulfillmentStatusEnum` 확장 (`created`, `reserving`, `ready`, `labeled`, `shipped`, `canceled` → 요구사항의 6단계)
- [ ] `FulfillmentsService`의 상태 전이 로직 개선
- [ ] SO 상태가 FO 상태에 따라 자동 업데이트되도록 로직 수정

#### 4.0.2 SKU 수요 폭발(Explosion) 로직 구현
- [ ] SO 수신 시 판매상품→SKU 매핑을 통한 수요 생성
- [ ] 세트 상품의 `kitGroup` 관리 로직
- [ ] 매핑 스냅샷 버전 관리 시스템

#### 4.0.3 새로운 SKU 수요 기반 데이터 모델 구현
- [ ] **`product_sku_maps` 테이블 추가**: 판매상품→재고상품 매핑 규칙
- [ ] **`product_sku_map_items` 테이블 추가**: 매핑 상세 (수량 포함)
- [ ] **`sku_demands` 테이블 추가**: SKU 수요 관리 (SO 라인의 SKU 폭발 결과)
- [ ] **`fo_allocations` 테이블 추가**: FO-수요 할당 관리
- [ ] **`fulfillment_order_skus` 뷰/테이블 추가**: FO별 SKU 집계 (성능용)
- [ ] `stock_reservations` 테이블 수정: `skuDemandId` 기반으로 변경
- [ ] `fulfillmentOrders.salesOrderId` 필드 제거
- [ ] 기존 SO 병합 관련 필드 제거 (`isMerged`, `mergeGroupId` 등)
- [ ] 직배 FO 필터링 로직 추가 (출고회차에서 제외)

#### 4.0.4 이벤트 시스템 정리
- [ ] 출고 관련 이벤트 정의 재정리 (`ORDER_EVENTS`, `FULFILLMENT_EVENTS`)
- [ ] 출고 상태 변경 시 적절한 이벤트 발행 확인
- [ ] 감사 로그 출고 관련 이벤트 추가

### 4.1 Phase 1: SKU 수요 기반 시스템 구현 (30%)

#### 4.1.1 핵심 서비스 구현
- [ ] `SkuDemandService` 클래스 생성 (수요 폭발/관리)
- [ ] `ProductSkuMappingService` 클래스 생성 (매핑 관리)
- [ ] `FoAllocationService` 클래스 생성 (FO-수요 할당)
- [ ] `OutboundService` 클래스 생성 (합배송/분할 로직)

#### 4.1.2 기본 API 구현
- [ ] SKU 수요 폭발 API (`POST /api/outbound/sku-demands/explode`)
- [ ] FO 생성 및 할당 API (`POST /api/outbound/fulfillment-orders`)
- [ ] FO 합배송/분할 API
- [ ] SO-FO 관계 조회 뷰 구현

#### 4.1.3 기존 서비스 연동
- [ ] `ReservationsService`를 `sku_demands` 기반으로 수정
- [ ] `FulfillmentsService`에서 `salesOrderId` 의존성 제거
- [ ] `AvailabilityService`와 수요 기반 가용성 체크 연동

### 4.2 Phase 2: 출고회차 및 개별출고 구현 (25%)

#### 4.2.1 출고회차 시스템
- [ ] `outbound_batches` 테이블 추가
- [ ] `fulfillment_order_batches` 연결 테이블 추가
- [ ] `picking_tasks` 테이블 추가
- [ ] 출고회차 생성/조회/관리 API
- [ ] 배치에서 FO 제외 기능 (동적 배치 관리)

#### 4.2.2 송장 발급 시스템
- [ ] 굿스플로 API 클라이언트 구현
- [ ] DeliveryProvider 추상화 계층
- [ ] 송장 발급/출력/추적 API
- [ ] 기존 `FulfillmentsService.assignShipment()` 메서드와 연동

#### 4.2.3 피킹/검수 워크플로우
- [ ] 개별출고 시작 API
- [ ] 바코드 스캔 처리 로직 (기존 `BarcodeService` 활용)
- [ ] 검수 수량 관리 시스템
- [ ] 강제출고 및 검수 초기화

#### 4.2.4 FO 분할 기능 (수요 기반)
- [ ] `fo_allocations` 기반 FO 분할 로직
- [ ] 출고 중 수요 재할당 기능
- [ ] 분할된 FO의 송장 처리
- [ ] 세트 상품(`kitGroup`) 분할 정책 적용
- [ ] 분할 이력 관리 (감사 로그 활용)

### 4.3 Phase 3: 토탈피킹 구현 (15%)

#### 4.3.1 토탈피킹 워크플로우
- [ ] 카트/바구니 기반 피킹 로직
- [ ] FIFO 기반 로케이션 순서 최적화 (기존 `FifoService` 활용)
- [ ] 바구니별 수량 분배 알고리즘

#### 4.3.2 토탈피킹 API
- [ ] 피킹 단계 관리 API
- [ ] 다음 피킹 아이템 조회
- [ ] 검수 단계 전환 로직

### 4.4 Phase 4: 고급 기능 및 최적화 (10%)

#### 4.4.1 고급 합배송/분할 로직
- [ ] 자동 합배송 후보 그룹핑 (주소/배송서비스/SLA 기준)
- [ ] 자동 송장 분리 (부피/무게 기준, 기존 `WeightCalculatorService` 활용)
- [ ] 세트 상품 보존 정책 (`ship_together` 처리)
- [ ] 합배송 홀드 윈도우 구현 (2-4시간 대기)

#### 4.4.2 직배 워크플로우 구현
- [ ] 직배 FO 별도 관리 시스템
- [ ] 회사별 주문 리스트 내보내기 (엑셀/CSV)
- [ ] 수동 완료 처리 및 이력 관리
- [ ] 직배 현황 대시보드

#### 4.4.3 3PL 지원
- [ ] 3PL 별도 처리 로직 (`holders` 테이블 기반)
- [ ] Holder 기반 출고 분리

#### 4.4.4 모니터링 및 대시보드
- [ ] 출고 성과 메트릭 수집 (기존 `MetricsService` 확장)
- [ ] 실시간 작업 현황 대시보드
- [ ] 출고 지연 알림 시스템

## 5. 테스트 계획

### 5.1 단위 테스트
- [ ] OutboundService 핵심 로직
- [ ] InvoiceService 송장 발급/취소
- [ ] PickingService 바코드 스캔/검수
- [ ] DeliveryProvider 구현체들

### 5.2 통합 테스트
- [ ] SO → FO → 출고완료 전체 플로우
- [ ] 굿스플로 API 연동 테스트
- [ ] 합배송 시나리오 테스트
- [ ] 송장 분리 자동화 테스트

### 5.3 성능 테스트
- [ ] 대량 FO 출고지시 성능
- [ ] 토탈피킹 최적화 효과 측정
- [ ] 동시 작업자 바코드 스캔 테스트

## 6. 운영 고려사항

### 6.1 에러 처리
- [ ] 굿스플로 API 장애 시 재시도 로직
- [ ] 송장 발급 실패 시 롤백 처리
- [ ] 네트워크 오류 시 작업 상태 복구

### 6.2 모니터링
- [ ] 출고 작업 메트릭 수집
- [ ] 송장 발급 성공률 모니터링
- [ ] 작업 시간 분석 대시보드

### 6.3 확장성
- [ ] 새로운 택배사 추가 용이성
- [ ] 피킹 방식 확장 가능성
- [ ] 다중 창고 지원 고려

## 7. 마일스톤

| Phase | 완료 기준 | 검증 방법 |
|-------|-----------|----------|
| Phase 0 | 기존 코드 리팩토링 완료 | 기존 테스트 통과 + 새로운 상태 관리 검증 |
| Phase 1 | 기본 API 동작 | Postman 테스트 통과 |
| Phase 2 | 개별출고 완전 동작 | 굿스플로 송장 발급 성공 |
| Phase 3 | 토탈피킹 시나리오 완료 | 20개 FO 토탈피킹 테스트 |
| Phase 4 | 전체 시나리오 검증 | 실제 주문 데이터로 E2E 테스트 |

## 8. 기존 코드와의 호환성

### 8.1 보존할 기존 기능
- [ ] 현재 동작하는 SO/FO 생성 및 조회 API
- [ ] 재고 예약 시스템 (`ReservationsService`)
- [ ] 가용성 체크 (`AvailabilityService`)
- [ ] 감사 로그 및 메트릭 수집

### 8.2 점진적 마이그레이션 전략
- [ ] 기존 API는 deprecated 표시하되 동작 유지
- [ ] 새로운 출고 API와 병행 운영
- [ ] 충분한 테스트 후 기존 API 제거

### 8.3 데이터 마이그레이션
- [ ] 기존 FO 데이터의 새로운 상태 체계로 변환
- [ ] 기존 SO-FO 관계를 `sku_demands` + `fo_allocations` 구조로 변환
- [ ] 기존 `stock_reservations`의 `skuDemandId` 기반 재구성
- [ ] 판매상품→재고상품 매핑 데이터 백필
- [ ] 기존 출고 이력 데이터 보존
- [ ] 직배 FO 식별 및 별도 관리 체계로 이관

이 계획서는 기존 요구사항 문서의 내용을 체계화하고, **현재 WMS 시스템의 기존 코드를 최대한 활용**하면서 필요한 리팩토링과 새로운 기능 구현을 단계별로 정리한 것입니다.