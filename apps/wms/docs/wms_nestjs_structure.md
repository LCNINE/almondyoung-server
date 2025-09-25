# WMS 모듈 및 서비스 책임

## InventoryModule
재고 상태 관리, SKU 매칭 및 로케이션 운영

### Controllers
- **InventoryController**: 재고 조회, 재고 조정 API
- **ProductMatchingController**: PIM 판매상품-SKU 매칭 API
- **LocationController**: 로케이션 CRUD/조회 API
- **MastersController**: SKU/마스터 데이터 관리 API

### Services
- **InventoryService**: 재고 도메인 오케스트레이션, 가용재고 계산 및 검증
- **InventoryCommandService**: 재고 증감/조정 커맨드 처리
- **InventoryQueryService**: 재고 조회 및 요약/통계 질의
- **InventoryCorrectionService**: 재고 정정 및 조정 처리
- **ProductMatchingService**: PIM 판매상품과 WMS SKU 매칭, 매칭 상태 관리
- **StockEventService**: 재고 이벤트 생성, 이벤트 기반 재계산
- **LocationService**: 최적 로케이션 찾기, FIFO 순위 관리, 로케이션 용량 관리
- **MasterService**: SKU/마스터 등록/수정, 바코드 관리

### Repositories
- **StockEventStore**: 재고 이벤트 소싱 저장소

## OrderModule ⭐ 완전 구현됨
출고주문, 판매주문 및 주문처리 전반 관리

### SalesOrdersModule
- **SalesOrdersController**: 판매주문 관리 API
- **SalesOrdersService**: 판매주문 생성, 조회, 상태 관리

### FulfillmentsModule
#### Controllers
- **FulfillmentsController**: 출고주문 관리 API
- **FulfillmentOrderController**: 출고주문 상세 관리
- **OutboundBatchController**: 출고회차 관리 API
- **PickingController**: 피킹 작업 API
- **InspectionController**: 검수 작업 API
- **ConsolidationController**: 합배송 관리 API
- **DirectShipController**: 직배 관리 API
- **InvoiceController**: 송장 관리 API
- **LocationOptimizationController**: 로케이션 최적화 API

#### Services
- **FulfillmentsService**: 출고주문 처리 및 상태 관리

### MatchingsModule
- **MatchingsController**: 상품매칭 관리 API
- **MatchingsService**: 상품매칭 로직 처리

### SharedModule (Order 전용)
#### Services
- **AvailabilityService**: 가용재고 확인 서비스
- **ConsolidationService**: 합배송 처리 로직
- **DirectShipService**: 직배 처리 로직
- **FulfillmentOrderTransactionService**: FO 트랜잭션 관리
- **InspectionService**: 검수 로직 처리
- **InvoiceService**: 송장 발급/관리 서비스
- **OutboundBatchService**: 출고회차 관리
- **OutboxService**: 이벤트 발행 처리
- **OutboxDispatcherService**: 이벤트 디스패처
- **PickingProcessService**: 피킹 프로세스 관리
- **PoliciesService**: 주문정책 관리
- **ProductSkuMappingService**: 상품-SKU 매핑 관리
- **ReservationLifecycleService**: 예약 생명주기 관리

#### Providers
- **GoodsflowDeliveryProvider**: 굿스플로 택배 연동
- **DeliveryProviderInterface**: 택배사 연동 인터페이스

## MovementModule
창고 내 재고 이동 작업

- **MovementController**: 이동 작업 생성, 이동 진행 상황 API
- **MovementService**: 이동 작업 생성/시작/완료, 이동 진행 상황 추적

## InboundModule
입고 및 발주 관리

### Controllers
- **InboundControllers**: 입고 처리, 입고 리스트 API
- **PurchaseOrderController**: 발주 생성, 발주 관리 API

### Services
- **InboundService**: 입고 처리, 입고 리스트 생성, 입고 바코드 스캔
- **PurchaseOrderService**: 발주 생성, 입고 예정일 관리, 재주문 제안

## SharedModule
공통 유틸리티 및 서비스

### Controllers
- **HealthController**: 헬스체크 API
- **MetricsController**: 메트릭 조회 API

### Services
- **AuditService**: 변경사항 로깅, 감사 추적
- **BarcodeService**: 바코드 생성, 바코드 검증, 라벨 출력
- **FifoService**: FIFO 재고 할당 로직
- **MetricsService**: 성능 메트릭 수집
- **TimeUtil**: 표준 시간대 처리 유틸리티
- **TransactionService**: 데이터베이스 트랜잭션 관리
- **WeightCalculatorService**: 상품 무게 계산, 박스 크기 추천