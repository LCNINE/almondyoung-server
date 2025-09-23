# WMS Order 모듈 아키텍처

## 개요

Order 모듈은 WMS의 핵심 출고 처리 시스템으로, 판매주문(SO)에서 출고주문(FO)으로의 변환부터 실제 물리적 출고까지의 전체 프로세스를 관리합니다.

## 모듈 구조

```
order/
├── sales-orders/           # 판매주문 관리
│   ├── controllers/
│   └── services/
├── fulfillments/          # 출고주문 및 출고 작업 관리
│   ├── controllers/       # 8개의 세분화된 컨트롤러
│   └── services/
├── matchings/             # 상품 매칭 관리
│   ├── controllers/
│   └── services/
└── shared/                # Order 모듈 전용 공유 서비스
    └── services/          # 15개의 핵심 서비스

```

## 주요 서브모듈

### 1. SalesOrdersModule
판매채널에서 들어오는 주문의 관리

#### 책임
- PIM 판매상품 기준 주문 수신 및 저장
- 판매주문 상태 관리 및 조회
- 채널별 주문 정책 적용

#### 주요 컴포넌트
- **SalesOrdersController**: 판매주문 CRUD API
- **SalesOrdersService**: 판매주문 비즈니스 로직

### 2. FulfillmentsModule
출고주문 생성부터 실제 출고까지의 전체 프로세스 관리

#### 세분화된 컨트롤러 구조
- **FulfillmentsController**: 기본 출고주문 관리
- **FulfillmentOrderController**: 출고주문 상세 관리 (CRUD, 상태변경)
- **OutboundBatchController**: 출고회차 생성 및 관리
- **PickingController**: 개별출고/토탈피킹 작업 처리
- **InspectionController**: 검수 작업 관리
- **ConsolidationController**: 합배송 처리
- **DirectShipController**: 직배 전용 워크플로우
- **InvoiceController**: 송장 발급 및 관리
- **LocationOptimizationController**: 피킹 효율성 최적화

#### 핵심 기능
1. **SO→FO 변환**: 판매상품을 재고상품으로 매핑하여 출고주문 생성
2. **재고 예약**: 출고 전 재고 선점 및 관리
3. **출고회차 관리**: 효율적인 배치 작업을 위한 그룹핑
4. **피킹 프로세스**: 개별출고와 토탈피킹 두 가지 방식 지원
5. **검수 시스템**: 바코드 기반 실시간 검수
6. **합배송**: 동일 고객 주문의 자동/수동 통합
7. **직배**: 외부 업체 창고 출고를 위한 별도 워크플로우
8. **송장 관리**: 굿스플로 API 연동 및 라벨 출력

### 3. MatchingsModule
PIM 판매상품과 WMS 재고상품 간의 매핑 관리

#### 책임
- 판매상품↔재고상품 매핑 규칙 정의
- 세트 상품 구성 관리
- 매핑 우선순위 및 전략 관리

#### 주요 컴포넌트
- **MatchingsController**: 매핑 관리 API
- **MatchingsService**: 매핑 로직 처리

### 4. SharedModule (Order 전용)
Order 모듈 내에서 공유되는 비즈니스 서비스들

#### 핵심 서비스 (15개)

##### 재고 및 가용성 관리
- **AvailabilityService**: 가용재고 확인 및 계산
- **ReservationsService**: 재고 예약 생성/해제/이관
- **ReservationLifecycleService**: 예약 생명주기 관리

##### 주문 처리
- **FulfillmentOrderTransactionService**: FO 관련 복합 트랜잭션 처리
- **ConsolidationService**: 합배송 로직 및 정책 적용
- **DirectShipService**: 직배 전용 처리 로직

##### 작업 프로세스
- **PickingProcessService**: 피킹 작업 상태 및 진행 관리
- **InspectionService**: 검수 로직 및 바코드 검증
- **OutboundBatchService**: 출고회차 생성/관리

##### 외부 연동
- **InvoiceService**: 송장 발급 및 관리
- **GoodsflowDeliveryProvider**: 굿스플로 택배사 API 연동
- **DeliveryProviderInterface**: 택배사 연동 추상화

##### 이벤트 및 정책
- **OutboxService**: 도메인 이벤트 발행 처리
- **OutboxDispatcherService**: 이벤트 비동기 디스패처
- **PoliciesService**: 주문/출고 정책 관리
- **ProductSkuMappingService**: 상품-SKU 매핑 스냅샷 관리

## 주요 워크플로우

### 1. 일반 출고 프로세스
```
SO 수신 → 매핑 확인 → FO 생성 → 재고 예약 → 출고회차 할당 → 피킹 → 검수 → 송장 발급 → 출고 완료
```

### 2. 합배송 프로세스
```
여러 SO → 통합 검증 → 단일 FO 생성 → 재고 예약 → 일반 출고 프로세스
```

### 3. 직배 프로세스
```
직배 SO → 직배 FO 생성 → 외부업체 리스트 생성 → 수동 전달 → 완료 처리
```

## 기술적 특징

### 1. 이벤트 기반 아키텍처
- Outbox 패턴을 통한 안전한 이벤트 발행
- 비동기 이벤트 처리로 모듈 간 결합도 최소화

### 2. 트랜잭션 안전성
- 복잡한 비즈니스 로직을 원자적 트랜잭션으로 처리
- FulfillmentOrderTransactionService를 통한 데이터 일관성 보장

### 3. 확장 가능한 설계
- Provider 패턴으로 택배사 연동 추상화
- 전략 패턴 기반 정책 관리

### 4. 실시간 처리
- 재고 예약의 실시간 업데이트
- 바코드 기반 즉시 검수 처리

## API 엔드포인트 예시

### Sales Orders
- `POST /wms/sales-orders` - 판매주문 생성
- `GET /wms/sales-orders/{id}` - 판매주문 조회
- `PATCH /wms/sales-orders/{id}` - 판매주문 수정

### Fulfillments
- `POST /wms/fulfillments` - 출고주문 생성
- `POST /wms/fulfillments/{id}/reserve` - 재고 예약
- `POST /wms/outbound-batches` - 출고회차 생성
- `POST /wms/picking/{batchId}/start` - 피킹 시작
- `POST /wms/inspection/{foId}/scan` - 바코드 검수
- `POST /wms/consolidation/merge` - 합배송 처리
- `POST /wms/invoices/{foId}/issue` - 송장 발급

### Direct Ship
- `GET /wms/direct-ship/pending` - 직배 대기 목록
- `POST /wms/direct-ship/export` - 외부업체 리스트 내보내기
- `POST /wms/direct-ship/complete` - 직배 완료 처리

### Matchings
- `GET /wms/matchings/{variantId}` - 상품 매칭 조회
- `PUT /wms/matchings/{variantId}` - 매핑 규칙 설정

## 데이터 흐름

1. **주문 수신**: PIM 판매상품 기준 SO 생성
2. **매핑 적용**: 판매상품→재고상품 변환 (스냅샷 방식)
3. **FO 생성**: 재고상품 기준 출고주문 생성
4. **재고 예약**: 출고 예정 재고 선점
5. **작업 할당**: 출고회차 배정 및 피킹 지시
6. **실제 작업**: 피킹→검수→포장 프로세스
7. **출고 완료**: 재고 차감 및 송장 처리

이 아키텍처는 복잡한 전자상거래 출고 요구사항을 체계적으로 처리하면서도 각 기능을 명확히 분리하여 유지보수성과 확장성을 확보했습니다.