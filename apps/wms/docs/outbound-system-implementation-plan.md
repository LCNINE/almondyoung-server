# WMS 출고 시스템 구현 계획서 (FOI 기반 설계)

## 1. 개요

### 1.1 목적
AlmondYoung WMS의 마지막 핵심 모듈인 출고 시스템을 **FulfillmentOrderItem(FOI) 기반 설계**로 구현하여 완전한 창고 관리 솔루션을 완성한다.

### 1.2 설계 원칙
- **SoT 원칙 준수**: SO는 판매채널이 SoT, FO는 WMS가 SoT
- **스냅샷 기반 매핑**: 주문시점 판매상품→재고상품 매핑 고정
- **원자적 트랜잭션**: 복잡한 DB 연산을 서비스 계층에서 원자적으로 처리
- **완전한 추적성**: SO → FO → FOI 경로로 모든 출고 이력 추적 가능

### 1.3 범위
- 판매상품→재고상품 매핑 스냅샷 시스템
- FO/FOI 기반 합배송 및 송장분리 처리
- 개별출고 및 토탈피킹 작업 프로세스
- 송장 발급 및 택배사 연동 (굿스플로 API)
- 직배(Drop-ship) 전용 워크플로우

## 2. 비즈니스 요구사항

### 2.1 주문 도메인 구조

#### 2.1.1 SO (Sales Order) - 판매주문
- **SoT**: 각 판매채널 (메두사, 쿠팡, 네이버 등)
- **특징**: PIM의 판매상품(Product) 기준으로 구성
- **불변성**: SO 자체는 WMS에서 변경하지 않음

#### 2.1.2 FO (Fulfillment Order) - 출고주문
- **SoT**: WMS
- **특징**: WMS의 재고상품(SKU) 기준으로 구성 (FOI를 통해)
- **송장 대응**: 송장/택배상자 하나에 대응

#### 2.1.3 FOI (Fulfillment Order Item) - 출고주문 아이템
- **핵심 개념**: SO의 판매상품을 SKU로 변환하여 저장
- **추적 정보**: 원본 SO/SOL 정보 보존
- **매핑 스냅샷**: 주문시점 매핑 버전 고정

### 2.2 SO-FO 관계 패턴

```
일반 출고     : SO(1) → FO(1)  - 가장 일반적
송장 분리     : SO(1) → FO(N)  - 부피 큰 상품, 배송방식 다른 경우
합배송        : SO(N) → FO(1)  - 여러 SO를 하나의 FO로 통합
복합 처리     : SO(N) → FO(M)  - 합배송 후 송장분리 등
```

**구현**: FOI의 `salesOrderId`, `fulfillmentOrderId` 필드로 모든 관계 표현

### 2.3 상태 관리

#### 2.3.1 FO 상태 흐름
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

#### 2.3.2 SO 상태 결정 로직
- **매칭누락**: 판매상품-재고상품 매핑 미완료
- **기타**: 연관된 FO들 중 가장 이전 단계의 상태를 따름

### 2.4 배송 방식별 분류

#### 2.4.1 소유자(Holder) 기준
- **자사 상품**: 미용재료 등 주력 상품, 일반택배로 출고
- **3PL 상품**: 허브 등 타업종 상품, 자사 상품과 별도 판매채널
- **직배 상품**: 특정 브랜드의 미용재료, 브랜드사 창고에서 직접 배송

#### 2.4.2 직배 전용 워크플로우
직배 FO는 일반 출고회차와 분리하여 관리:
- **출고회차 제외**: 직배 FO는 피킹/검수 배치에 포함되지 않음
- **별도 조회**: 직배 전용 관리 페이지에서 회사별 분류 조회
- **파일 내보내기**: 회사별로 주문 리스트를 엑셀 등 형식으로 내보내기
- **수동 완료**: 관리자가 "해당 회사에 전달 완료" 체크 시 출고완료 처리

## 3. 기술 요구사항

### 3.1 데이터 모델

#### 3.1.1 판매상품→재고상품 매핑 시스템
```typescript
// 현재 매핑 규칙 (계속 변경됨)
interface ProductSkuMapping {
  id: string;
  productId: string;           // PIM의 판매상품 ID
  version: number;             // 1, 2, 3, ... 증가
  effectiveFrom: Date;         // 언제부터 적용
  isActive: boolean;           // 현재 활성 버전인지
  warehouseId: string;
  createdAt: Date;
}

interface ProductSkuMappingItem {
  id: string;
  mappingId: string;
  skuId: string;               // WMS의 재고상품 ID
  qtyPerProduct: number;       // 판매상품 1개당 필요한 SKU 수량
}

// 주문시점에 생성되는 고정 스냅샷
interface ProductSkuMappingSnapshot {
  id: string;                  // snapshot-uuid
  productId: string;
  sourceVersion: number;       // 어떤 버전에서 스냅샷했는지
  createdAt: Date;            // 주문 시점
  items: Array<{
    skuId: string;
    qtyPerProduct: number;
  }>;
}
```

#### 3.1.2 FO 및 FOI 구조
```typescript
// FO는 기존과 유사하되 salesOrderId 제거
interface FulfillmentOrder {
  id: string;
  warehouseId: string;
  ownerId?: string;            // 직배 구분용
  status: FOStatus;
  shippingAddress: any;
  carrierService?: string;
  latestShipBy?: Date;
  lockedAt?: Date;             // 구조 변경 금지 시점
  labelNo?: string;
  createdAt: Date;
  updatedAt: Date;
}

// FOI - 핵심 엔티티
interface FulfillmentOrderItem {
  id: string;
  fulfillmentOrderId: string;

  // 추적 정보
  salesOrderId: string;        // 어떤 SO에서 왔는지
  salesOrderLineId: string;    // 어떤 SOL에서 왔는지
  mappingSnapshotId: string;   // 어떤 매핑을 사용했는지

  // 실제 출고 정보
  skuId: string;               // 실제 출고할 SKU
  qty: number;                 // 출고할 수량

  createdAt: Date;
}
```

#### 3.1.3 재고 예약 시스템
```typescript
// 재고 예약 (FOI가 소유자)
interface StockReservation {
  id: string;
  fulfillmentOrderItemId: string;  // FOI가 소유
  skuId: string;
  warehouseId: string;
  locationId?: string;
  qty: number;
  state: 'soft' | 'hard' | 'picked' | 'consumed' | 'released' | 'expired';
  expiresAt?: Date;            // soft 예약 만료시간
  createdAt: Date;
}
```

#### 3.1.4 출고회차 관리
```typescript
interface OutboundBatch {
  id: string;
  batchNumber: string;         // OB-20250118-001
  warehouseId: string;
  status: 'created' | 'picking' | 'completed';
  pickingMethod: 'individual' | 'total_picking';
  cartCapacity?: number;       // 토탈피킹 시 바구니 수
  assignedTo?: string;         // 작업자 ID
  createdAt: Date;
  completedAt?: Date;
}

interface FulfillmentOrderBatch {
  fulfillmentOrderId: string;
  batchId: string;
  assignedAt: Date;
  removedAt?: Date;            // 배치에서 제외된 시점
  removeReason?: string;       // 재고부족, 오류 등
}
```

#### 3.1.5 송장 관리
```typescript
interface Invoice {
  id: string;
  fulfillmentOrderId: string;
  invoiceNumber: string;       // 송장번호
  carrierCode?: string;        // 택배사 코드
  issueMethod: 'goodsflow' | 'direct' | 'self';
  goodsflowServiceId?: string; // 굿스플로 서비스 ID
  status: 'issued' | 'printed' | 'shipped';
  issuedAt?: Date;
  printedAt?: Date;
}
```

### 3.2 원자적 트랜잭션 서비스 계층

#### 3.2.1 핵심 트랜잭션 서비스
```typescript
@Injectable()
export class FulfillmentOrderTransactionService {
  // SO 수신 → 매핑 스냅샷 → FO+FOI 생성 → 재고 예약
  async createFulfillmentOrderFromSalesOrder(
    salesOrderId: string,
    salesOrderLineId: string,
    shippingAddress: any,
    options?: {
      targetFulfillmentOrderId?: string; // 합배송용
    }
  ): Promise<FulfillmentOrder>;

  // 송장분리: FO에서 일부 FOI를 새 FO로 이동
  async splitFulfillmentOrder(
    sourceFoId: string,
    itemsToMove: Array<{
      foiId: string;
      qty?: number; // 부분 분리용
    }>
  ): Promise<FulfillmentOrder>;

  // FO 취소 및 예약 해제
  async cancelFulfillmentOrder(foId: string): Promise<void>;
}

@Injectable()
export class ProductSkuMappingService {
  // 매핑 스냅샷 생성
  async createMappingSnapshot(
    productId: string,
    warehouseId: string
  ): Promise<ProductSkuMappingSnapshot>;

  // 세트 상품 가용성 체크
  async checkProductAvailability(
    productId: string,
    requestedQty: number,
    warehouseId: string
  ): Promise<{
    availableQty: number;
    constrainingSkuId?: string; // 병목 SKU
  }>;

  // 미출고 주문에 새 매핑 적용
  async applyNewMappingToUnshippedOrders(
    productId: string,
    warehouseId: string
  ): Promise<number>; // 영향받은 FO 개수
}
```

### 3.3 API 설계

#### 3.3.1 FO 관리 API
```typescript
// FO 생성 (SO에서)
POST /api/outbound/fulfillment-orders
{
  "salesOrderId": "SO-001",
  "salesOrderLineId": "SOL-001",
  "shippingAddress": {...},
  "carrierService": "CJ"
}

// 합배송 (기존 FO에 SO 추가)
POST /api/outbound/fulfillment-orders/{foId}/merge
{
  "salesOrderId": "SO-002",
  "salesOrderLineId": "SOL-002"
}

// 송장분리
POST /api/outbound/fulfillment-orders/{foId}/split
{
  "itemsToMove": [
    {
      "foiId": "FOI-001",
      "qty": 2
    }
  ]
}

// FO 조회 (FOI 포함)
GET /api/outbound/fulfillment-orders/{foId}
// 응답에 FOI 목록과 각 FOI의 원본 SO 정보 포함

// SO-FO 관계 조회
GET /api/outbound/sales-orders/{soId}/fulfillment-orders
```

#### 3.3.2 직배 관리 API
```typescript
// 직배 대기 FO 목록 조회
GET /api/outbound/drop-ship/pending?ownerId=company-1

// 회사별 직배 FO 엑셀 내보내기
POST /api/outbound/drop-ship/export
{
  "ownerId": "company-1",
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
```

#### 3.3.3 출고회차 관리 API
```typescript
// 출고지시 생성
POST /api/outbound/batches
{
  "fulfillmentOrderIds": ["fo-1", "fo-2"],
  "pickingMethod": "individual" | "total_picking",
  "cartCapacity": 20,
  "warehouseId": "wh-1"
}

// 배치에서 FO 제외
DELETE /api/outbound/batches/{batchId}/fulfillment-orders/{foId}
{
  "reason": "재고부족"
}
```

### 3.4 외부 연동

#### 3.4.1 굿스플로 API 연동
```typescript
interface GoodsflowService {
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

  generatePrintUri(serviceIds: string[]): Promise<{
    printUri: string;
  }>;

  trackDelivery(serviceId: string): Promise<{
    status: string;
    location: string;
    timestamp: string;
  }>;

  cancelInvoice(serviceId: string): Promise<void>;
}
```

## 4. 구현 계획

### 4.1 Phase 1: 매핑 시스템 및 FOI 기반 구조 (35%)

#### 4.1.1 데이터 모델 구현
- [ ] `product_sku_mappings` 테이블 추가
- [ ] `product_sku_mapping_items` 테이블 추가
- [ ] `product_sku_mapping_snapshots` 테이블 추가
- [ ] `fulfillment_order_items` 테이블 추가
- [ ] `fulfillmentOrders.salesOrderId` 필드 제거
- [ ] `stock_reservations.fulfillmentOrderItemId` 필드 추가

#### 4.1.2 핵심 서비스 구현
- [ ] `ProductSkuMappingService` 클래스 생성
- [ ] `FulfillmentOrderTransactionService` 클래스 생성
- [ ] 매핑 스냅샷 생성 로직
- [ ] 세트 상품 가용성 체크 로직

#### 4.1.3 기본 API 구현
- [ ] FO 생성 API (`POST /api/outbound/fulfillment-orders`)
- [ ] 합배송 API (`POST /api/outbound/fulfillment-orders/{foId}/merge`)
- [ ] 송장분리 API (`POST /api/outbound/fulfillment-orders/{foId}/split`)
- [ ] SO-FO 관계 조회 API

#### 4.1.4 기존 서비스 연동
- [ ] `ReservationsService`를 FOI 기반으로 수정
- [ ] `FulfillmentsService`에서 `salesOrderId` 의존성 제거
- [ ] `AvailabilityService`와 매핑 기반 가용성 체크 연동

### 4.2 Phase 2: 출고회차 및 송장 발급 (25%)

#### 4.2.1 출고회차 시스템
- [ ] `outbound_batches` 테이블 추가
- [ ] `fulfillment_order_batches` 연결 테이블 추가
- [ ] 출고회차 생성/조회/관리 API
- [ ] 배치에서 FO 제외 기능 (동적 배치 관리)
- [ ] 직배 FO 자동 필터링 로직

#### 4.2.2 송장 발급 시스템
- [ ] `invoices` 테이블 추가
- [ ] 굿스플로 API 클라이언트 구현
- [ ] DeliveryProvider 추상화 계층
- [ ] 송장 발급/출력/추적 API
- [ ] 출고작업중 상태 진입 시 자동 송장 발급

#### 4.2.3 FOI 기반 피킹 리스트
- [ ] FOI를 SKU별로 집계한 피킹 리스트 생성
- [ ] 피킹 화면에서 원본 SO 정보 표시 (FOI 역추적)
- [ ] 바코드 스캔 시 FOI 단위 검수 처리

### 4.3 Phase 3: 개별출고 및 토탈피킹 (25%)

#### 4.3.1 개별출고 워크플로우
- [ ] 개별출고 시작 API
- [ ] 바코드 스캔 처리 로직 (기존 `BarcodeService` 활용)
- [ ] FOI 단위 검수 수량 관리
- [ ] 강제출고 및 검수 초기화
- [ ] 개별출고 중 FO 분할 기능

#### 4.3.2 토탈피킹 워크플로우
- [ ] 카트/바구니 기반 피킹 로직
- [ ] FIFO 기반 로케이션 순서 최적화
- [ ] 바구니별 수량 분배 알고리즘
- [ ] 토탈피킹 → 개별검수 전환

### 4.4 Phase 4: 직배 워크플로우 및 고급 기능 (15%)

#### 4.4.1 직배 전용 시스템
- [ ] 직배 FO 별도 관리 시스템
- [ ] 회사별 주문 리스트 내보내기 (엑셀/CSV)
- [ ] 수동 완료 처리 및 이력 관리
- [ ] 직배 현황 대시보드

#### 4.4.2 고급 기능
- [ ] 자동 합배송 후보 그룹핑 (주소/배송서비스/SLA 기준)
- [ ] 매핑 변경 시 "미출고 주문에 즉시 적용" 기능
- [ ] 출고 성과 메트릭 수집
- [ ] 실시간 작업 현황 대시보드

## 5. 테스트 계획

### 5.1 단위 테스트
- [ ] `ProductSkuMappingService` 매핑 로직
- [ ] `FulfillmentOrderTransactionService` 트랜잭션 무결성
- [ ] 세트 상품 가용성 체크 로직
- [ ] 합배송/송장분리 시나리오

### 5.2 통합 테스트
- [ ] SO → FO → FOI → 출고완료 전체 플로우
- [ ] 굿스플로 API 연동 테스트
- [ ] 매핑 스냅샷 무결성 테스트
- [ ] 복합 시나리오 테스트 (합배송 후 송장분리 등)

### 5.3 성능 테스트
- [ ] 대량 FOI 생성 성능
- [ ] SO-FO 관계 조회 성능
- [ ] 토탈피킹 최적화 효과 측정

## 6. 마일스톤

| Phase | 완료 기준 | 검증 방법 |
|-------|-----------|----------|
| Phase 1 | FOI 기반 FO 생성 및 관계 관리 | 합배송/송장분리 시나리오 테스트 |
| Phase 2 | 출고회차 및 송장 발급 완료 | 굿스플로 송장 발급 성공 |
| Phase 3 | 개별출고/토탈피킹 완전 동작 | 20개 FO 토탈피킹 테스트 |
| Phase 4 | 직배 워크플로우 완료 | 실제 직배 데이터로 E2E 테스트 |

## 7. 운영 고려사항

### 7.1 데이터 마이그레이션
- [ ] 기존 FO 데이터를 FOI 구조로 변환
- [ ] 판매상품→재고상품 매핑 데이터 백필
- [ ] 기존 `stock_reservations`의 FOI 기반 재구성
- [ ] 기존 출고 이력 데이터 보존

### 7.2 모니터링
- [ ] FOI 생성 및 매핑 스냅샷 메트릭
- [ ] 송장 발급 성공률 모니터링
- [ ] 트랜잭션 실패 알림 시스템

이 계획서는 FOI 기반 설계의 장점을 최대화하면서도 기존 WMS 시스템과의 호환성을 유지하는 실용적인 구현 방안을 제시합니다.