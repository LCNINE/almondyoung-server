# WMS 모듈 및 서비스 책임

## InventoryModule
재고 상태 관리, SKU 매칭 및 로케이션 운영

- **InventoryController**: 재고 조회, 재고 조정 API
- **ProductMatchingController**: PIM 판매상품-SKU 매칭 API
- **InventoryService**: 가용재고 계산, 재고 증감 처리, 재고 검증
- **ProductMatchingService**: PIM 판매상품과 WMS SKU 매칭, 매칭 상태 관리
- **StockEventService**: 재고 이벤트 생성, 이벤트 기반 재고 재계산
- **LocationService**: 최적 로케이션 찾기, FIFO 순위 관리, 로케이션 용량 관리

## ReservationModule  
주문 수집, 상품 매칭, 재고 할당 및 바구니 관리

- **OrderCollectController**: 주문 수집, 상품 매칭 API
- **ReservationController**: 재고 예약, 예약 확정/취소 API
- **OrderCollectService**: 주문 수집, 주문 상태 관리
- **ReservationService**: 재고 할당, 예약 생성/확정/해제
- **BasketService**: 바구니 생성/병합/분할, 바구니 무게 계산

## OutboundModule
출고 작업 프로세스 관리

- **OutboundController**: 출고리스트, 출고 작업 상태 관리 API
- **PickingController**: 피킹리스트, 피킹 진행 상황 API
- **OutboundService**: 출고리스트 생성, 피킹리스트 생성, 출고 작업 생명주기 관리
- **PickingService**: 바코드 스캔 처리, 피킹 진행률 업데이트
- **PackingService**: 포장 처리, 박스 크기 계산, 송장 요청

## MovementModule
창고 내 재고 이동 작업

- **MovementController**: 이동 작업 생성, 이동 진행 상황 API
- **MovementService**: 이동 작업 생성/시작/완료, 이동 진행 상황 추적

## ShipmentModule
배송 라벨 및 배송 추적

- **ShipmentController**: 배송 라벨, 배송 상태 추적 API
- **ShipmentService**: 배송 라벨 생성, 배송 상태 업데이트, ETA 계산
- **CarrierService**: 택배사 API 연동, 추적 정보 파싱

## InboundModule
입고 및 발주 관리

- **InboundController**: 입고 처리, 입고 리스트 API
- **PurchaseOrderController**: 발주 생성, 발주 관리 API
- **InboundService**: 입고 처리, 입고 리스트 생성, 입고 바코드 스캔
- **PurchaseOrderService**: 발주 생성, 입고 예정일 관리, 재주문 제안

## ReturnModule
반품 접수 및 처리

- **ReturnController**: 반품 등록, 반품 품질검수 API
- **ReturnService**: 반품 요청 처리, 반품 입고, 품질검수, 재고 복원

## SharedModule
공통 유틸리티 및 서비스

- **BarcodeService**: 바코드 생성, 바코드 검증, 라벨 출력
- **WeightCalculatorService**: 상품 무게 계산, 박스 크기 추천
- **FifoService**: FIFO 재고 할당 로직
- **TransactionService**: 데이터베이스 트랜잭션 관리
- **AuditService**: 변경사항 로깅, 감사 추적