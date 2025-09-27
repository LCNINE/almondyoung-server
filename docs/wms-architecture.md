# WMS 마이크로서비스 구조 및 구현 현황

본 문서는 `apps/wms` 마이크로서비스의 전체 구조, 데이터 모델, 주요 API, 구현 범위와 리스크, 개선 로드맵을 정리합니다. 운영/개발자가 빠르게 전반을 파악하고, 후속 확장 작업의 기준으로 삼는 것을 목표로 합니다.

## 개요
- 런타임: NestJS + postgres.js + drizzle-orm
- 목적: 재고 이벤트 소싱 기반의 창고관리(입고/출고/이동/예약/반품/배송) 도메인 제공
- 설계 핵심: 이벤트 원장(`stock_events`)과 현재 상태 프로젝션(`stock_summary`)의 이중 원장 구조

## 부트스트랩/엔트리포인트
- 앱 엔트리: `apps/wms/src/main.ts`
  - `WmsModule` 부트스트랩, 환경 변수 포트로 리스닝(현재 코드상 `process.env.port` 사용)
- 루트 모듈: `apps/wms/src/wms.module.ts`
  - `DbModule.forRoot({ connectionString: process.env.DATABASE_URL, schema: wmsTables })`
  - 도메인 모듈: `InventoryModule`, `InboundModule`, `OutboundModule`, `MovementModule`, `ReservationModule`, `ShipmentModule`, `ReturnModule`, `SharedModule`

## 데이터베이스/ORM/DI
- ORM/클라이언트: postgres.js + drizzle-orm
- DB 모듈: `libs/db`
  - `DbModule.forRoot`로 커넥션 설정 주입, `DbService<TSchema>`에서 drizzle 인스턴스 관리
  - 주입 데코레이터: `@InjectTypedDb<typeof wmsTables>()`
- 스키마 파일: `apps/wms/database/schemas/wms-schema.ts`
  - 주요 테이블/개념
    - 재고 원장: `stock_events` (IN/OUT/MOVE/RESERVE/CONFIRM/RELEASE/CANCEL 등 상세 enum 확장)
    - 현재 상태: `stock_summary` (낙관적 락 `version` 포함)
    - 로케이션 모델: `warehouses`, `location_columns`, `location_racks`, `locations`
    - 주문/출고 작업: `orders`, `order_items`, `outbound_tasks`, `outbound_task_orders`, `outbound_task_items`, `outbound_task_lines`
    - 매칭: `product_matchings`, `product_variant_sku_links`, `product_option_matchings`
    - 반품/배송: `returns`, `shipments`, `shipment_tracking`
    - 기타 마스터: `skus`, `sku_barcodes`, `suppliers`, `categories`, `settings`, `holidays` 등

## 이벤트 소싱 설계
- 모든 재고 변동은 `stock_events`에 기록됩니다.
- 조회 최적화를 위해 `stock_summary`가 별도로 유지됩니다.
- 프로젝션/룰: `StockSummaryRepository`가 이벤트 타입별 룰(`apps/wms/src/inventory/rules/*`)에 따라 합산 및 상태 업데이트.
- 동시성: `stock_summary.version`으로 낙관적 락, 충돌 시 재시도 필요(현재 예외 발생 처리).

## 모듈 구조 및 책임
- InventoryModule (`apps/wms/src/inventory`)
  - 컨트롤러: `InventoryController`, `ProductMatchingController`, `LocationController`
  - 서비스: `InventoryService`, `ProductMatchingService`, `StockEventService`, `LocationService`
  - 전략: `variant`, `option`, `void` 매칭 전략 구현
- InboundModule (`apps/wms/src/inbound`)
  - 컨트롤러: `InboundController` (입고/입고묶음/예정/이력/바코드 검수)
  - 서비스: `InboundService` (입고 처리)
  - 발주: `PurchaseOrderController/Service`는 스켈레톤
- OutboundModule (`apps/wms/src/outbound`)
  - 컨트롤러: `OutboundController`, `PickingController`
  - 서비스: `OutboundService` (출고/작업 생성/피킹리스트/상태전이/통계)
  - `PickingService`, `PackingService`는 스켈레톤
- MovementModule (`apps/wms/src/movement`)
  - 컨트롤러/서비스: 창고간/내 이동, 위치 재고, 활용도, 이동 이력 구현 완료
- ReservationModule (`apps/wms/src/reservation`)
  - 대부분 스켈레톤(`ReservationController/Service`, `BasketService` 등)
- ShipmentModule (`apps/wms/src/shipment`)
  - 컨트롤러/서비스/캐리어: 스켈레톤
- ReturnModule (`apps/wms/src/return`)
  - 컨트롤러/서비스: 스켈레톤
- SharedModule (`apps/wms/src/shared`)
  - 공통: `TransactionService` 유의미, `Barcode/Fifo/Audit/WeightCalculator`는 스켈레톤

## 주요 API 라우팅(요약)
- `GET /` 루트 핑
- `wms/inventory`
  - `GET /stocks`, `GET /stocks/summary`, `GET /stocks/history`, `POST /stocks/adjust`
  - `POST/GET/PUT/DELETE /skus`, 바코드 추가/삭제, `GET /skus/:id/stock-summary`
  - `POST/GET/PATCH/DELETE /warehouses` 및 `GET /warehouses/:id/summary`
- `wms/locations`
  - 열/랙/로케이션 생성·조회·수정, 커스텀 빈 추가, 페이징 조회
- `wms/matchings`
  - 매칭 대기 조회/해소, 전략 변경/우선순위, 옵션별 매핑, variant SKU lookup
- `wms/inbound`
  - 입고 처리, 재고 묶음 생성, 입고 예정/이력, 바코드 검수
- `wms/outbound`
  - 출고 처리, 주문→작업 생성, 피킹리스트, 작업 상태, 출고 통계
- `wms/movement`
  - 창고간/내 이동, 위치 재고, 창고 활용도, 이동 이력
- 예약/반품/배송: 컨트롤러/핸들러 미구현(실제 라우트 미노출)

## 구현 현황 요약
- 구현 완료(실사용 가능)
  - 재고(조회/요약/이력/조정), 입고, 출고, 창고간/내 이동, 로케이션 관리, 매칭 전략
- 부분 구현
  - 출고 작업/피킹: 작업/피킹리스트는 구현, 피킹/포장 처리 로직은 미구현
  - 발주: 컨트롤러/서비스 스켈레톤
- 미구현
  - 예약/할당, 반품 처리, 배송(라벨/추적), 바코드/감사/무게계산 등 공통 유틸 대부분

## 크로스컷팅 이슈/리스크
- 컨트롤러 데코레이터 누락: `Return/Shipment/Reservation` 컨트롤러들이 `@Controller` 미부여(라우트 미등록)
- API 문서/검증 부재: Swagger 부트스트랩 미구현, 전역 `ValidationPipe` 없음
- 설정 중복 및 포트 변수: 각 모듈에서 `ConfigModule.forRoot` 반복, `process.env.port` 사용(일반적으로 `PORT`)
- DB 연결 중복 가능성: 각 모듈이 `DbModule.forRoot` 호출(커넥션 재생성 주의)
- 인증/인가 없음: 가드/권한 미적용
- 동시성 재시도 전략 부재: `stock_summary` 버전 충돌 시 재시도 로직 필요

## 개선 제안/로드맵
1) 플랫폼/부트스트랩
- `main.ts`: Swagger 세팅, `ValidationPipe({ whitelist:true, transform:true })`, CORS/보안 헤더
- 환경변수 스키마 검증(`@nestjs/config` + Zod/Joi), `PORT` 표준화
2) 모듈 구성
- `ConfigModule.forRoot({ isGlobal:true })` 도입
- DB 연결 풀 공유: `DbModule` 전역화 또는 커넥션 팩토리 단일화
3) 보안/운영성
- 인증(JWT/키 기반) 가드 도입, RBAC 설계(도메인 리소스별 권한)
- 요청 멱등성(특히 입고/출고/이동), 감사 로깅 구현(`AuditService`)
4) 도메인 완성도
- 발주 CRUD/조회/상태, 예약/할당(타임아웃/확정/해제), 반품 처리, 배송/캐리어 연동, 피킹/포장 처리
- 이벤트 재처리/리플레이 및 `stock_summary` 재구축 정합성 테스트
5) 테스트/품질
- e2e 테스트(핵심 플로우: 입고→예약→피킹→출고, 이동, 반품)
- 동시성 시나리오, 멱등성, 롤백/에러 경계 테스트

## 참고 파일 경로
- 루트 모듈: `apps/wms/src/wms.module.ts`
- 엔트리: `apps/wms/src/main.ts`
- 스키마: `apps/wms/database/schemas/wms-schema.ts`
- DB 모듈/서비스/데코레이터: `libs/db/src/*`
- 인벤토리 도메인: `apps/wms/src/inventory/*`
- 입고/출고/이동: `apps/wms/src/inbound/*`, `apps/wms/src/outbound/*`, `apps/wms/src/movement/*`
- 기타 도메인(스켈레톤): `apps/wms/src/reservation/*`, `apps/wms/src/return/*`, `apps/wms/src/shipment/*`, `apps/wms/src/shared/*`
- 추가 문서: `apps/wms/docs/wms_nestjs_structure.md`, `apps/wms/docs/wms_nestjs_structure_eng.md`
