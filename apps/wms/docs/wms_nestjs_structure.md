# WMS 모듈 및 서비스 책임

## InventoryModule
재고 상태 관리, SKU 매칭 및 로케이션 운영

- **InventoryController**: 재고 조회, 재고 조정 API
- **ProductMatchingController**: PIM 판매상품-SKU 매칭 API
- **LocationController**: 로케이션 CRUD/조회 API
- **MastersController**: SKU/마스터 데이터 관리 API
- **InventoryService**: 재고 도메인 오케스트레이션, 가용재고 계산 및 검증
- **InventoryCommandService**: 재고 증감/조정 커맨드 처리
- **InventoryQueryService**: 재고 조회 및 요약/통계 질의
- **ProductMatchingService**: PIM 판매상품과 WMS SKU 매칭, 매칭 상태 관리
- **StockEventService**: 재고 이벤트 생성, 이벤트 기반 재계산
- **LocationService**: 최적 로케이션 찾기, FIFO 순위 관리, 로케이션 용량 관리
- **MasterService**: SKU/마스터 등록/수정, 바코드 관리

## MovementModule
창고 내 재고 이동 작업

- **MovementController**: 이동 작업 생성, 이동 진행 상황 API
- **MovementService**: 이동 작업 생성/시작/완료, 이동 진행 상황 추적

## InboundModule
입고 및 발주 관리

- **InboundController**: 입고 처리, 입고 리스트 API
- **PurchaseOrderController**: 발주 생성, 발주 관리 API
- **InboundService**: 입고 처리, 입고 리스트 생성, 입고 바코드 스캔
- **PurchaseOrderService**: 발주 생성, 입고 예정일 관리, 재주문 제안

## SharedModule
공통 유틸리티 및 서비스

- **BarcodeService**: 바코드 생성, 바코드 검증, 라벨 출력
- **WeightCalculatorService**: 상품 무게 계산, 박스 크기 추천
- **FifoService**: FIFO 재고 할당 로직
- **TransactionService**: 데이터베이스 트랜잭션 관리
- **AuditService**: 변경사항 로깅, 감사 추적
- **StockAvailabilityService**: 가용재고 산출 보조 로직
- **TimeUtil**: 표준 시간대 처리 유틸리티