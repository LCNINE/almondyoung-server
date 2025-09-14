# WMS 주문 도메인 설계 (Sales Orders & Fulfillment Orders)

## 1. 목적 및 범위
- 본 문서는 WMS 내 "주문" 스코프(판매주문 SO, 출고주문 FO)의 도메인 구조, 상태모델, 정책, 트랜잭션, API 표면, 이벤트 연동을 정의한다.
- 대상: 인하우스 판매, 3PL, 드랍십 시나리오를 모두 포괄하되, 초기 구현은 인하우스/3PL 중심으로 진행한다.

## 2. 용어 정의
- Sales Order(SO): 판매채널에서 수집된 주문(판매상품 기준). 관리/편집/병합의 단위.
- Fulfillment Order(FO): 출고 실행 단위(송장/물류 상자 단위). 재고상품 기준, 예약/피킹/출고의 단위.
- Reservation: FO 라인 단위의 재고 선점(락). 할당/해제/이관(steal)을 지원.
- Matching: 판매상품(variant) ↔ 재고상품(SKU)의 연결 정보(상위 헤더 + 하위 링크).

## 3. 상위 구조 개요
- SO ↔ FO: 1:N로 시작하되, 합배송 승인은 "SO 병합"으로 처리하여 M:N 복잡도 회피
- 내부 모듈 간 호출은 동기/트랜잭션 전파, 외부 시스템 연계는 이벤트 발행으로 분리
- 재고는 이벤트소싱 기반(원장 `stock_events` + 프로젝션 `stock_summary`)

## 4. 상태 모델
### 4.1 판매주문(SO)
- 출고작업전(매칭완료) / 출고작업전(매칭미완료) / 출고작업전(재고부족)
- 출고작업중(FO 중 하나라도 진행 중이면 SO는 진행중으로 표시)
- 출고완료(모든 FO 완료시) / 출고취소(모든 FO 취소시) / 일부출고취소(혼재 시)

### 4.2 출고주문(FO)
- 출고작업전 → 출고작업중(예약 완료 및 작업 등록) → 송장등록완료 → 출고완료(차감 시점) → 출고취소(재작업 불가)

### 4.3 라인 상태
- 예약 완료와 출고 확정(실차감)을 분리. 부분 예약/해제/이관 가능.

## 5. 데이터 모델(요약)
- sales_orders(sales_order_lines)
- fulfillment_orders(fulfillment_order_lines)
- product_matchings(상위: variant 단위) + product_variant_sku_links(하위: 1:N 구성)
- stock_reservations: fulfillment_order_line_id 기준으로 예약 관리
- shipments: FO와 연결(송장등록/추적)

## 6. 매칭 모델
- 상위 헤더(`product_matchings`): 해당 판매상품 variant의 매칭 존재/유형(무형 포함)
- 하위 링크(`product_variant_sku_links`): 실제 연결된 SKU 목록과 구성 수량(세트)
- 매칭 누락 시 SO는 출고불가. 운영자가 매칭 생성 또는 주문 한정 매칭(오버라이드) 가능

## 7. 판매정책(Variant Scope)
- 별도 정책 테이블: sales_variant_policies(variant_id unique)
  - inventory_management (boolean)
  - pre_stock_sellable (boolean)
  - always_sellable_zero_stock (boolean)
  - [선택] fulfillment_mode (in_house | third_party_3pl | drop_ship)
  - [선택] effective_from/effective_to (UTC 저장, 판단은 Asia/Seoul)
- 판정 규칙(요약)
  - acceptance(접수): inventory_management=false OR pre_stock_sellable OR always_sellable_zero_stock OR (ON_HAND≥요청)
  - fulfillability(출고가능): inventory_management=false OR (ON_HAND≥요청)
  - pre_stock_sellable은 접수에만 관여, 출고가능성에는 관여하지 않음

## 8. 합배송 정책
- 자동 합포장 판단 없음. "동일 주문자+동일 주소" 후보 조회 제공
- 관리자가 승인하면 SO 병합: 원본 SO 취소 → 새 SO 1건 생성(헤더/라인 집계) → FO/예약 재구성

## 9. 3가지 물류 유형
- In-house: 표준 FO 생성→예약→피킹→출고. owner=우리 회사
- 3PL: 동일 플로우, 단 SKU.holder와 FO.owner 일치 검증. 운임/계약 파라미터화
- Drop-ship: 로컬 예약/차감 없음. 외부 발주/지시 엔터티로 대체, 상태만 동기화

## 10. 트랜잭션 규칙
- 퍼블릭 서비스: 마지막 인자 `tx?: DbTx` 유지, 내부 헬퍼는 `tx: DbTx`
- 상위에서 받은 tx는 `this.inTx(exec, tx)`로 전파
- 예약/이관/차감/해제는 반드시 단일 트랜잭션에서 처리하고 감사 로그 기록

## 11. API 표면(초안)
- Sales Orders
  - POST /sales-orders, PATCH /sales-orders/:id, GET(list/detail)
  - POST /sales-orders/:id/confirm, POST /sales-orders/:id/cancel
  - POST /sales-orders/merge (관리자 승인 기반 SO 병합)
- Fulfillment Orders
  - POST /fulfillments (SO→FO 생성), POST /fulfillments/:id/split, POST /fulfillments/:id/cancel
  - POST /fulfillments/:id/assign-shipment, POST /fulfillments/:id/ship
- Availability & Reservation
  - POST /fulfillments/:id/check-availability
  - POST /fulfillments/:id/reserve, POST /fulfillments/:id/unreserve
  - POST /fulfillments/:id/transfer-reservation (steal)
- Matching & Policies
  - POST/PUT /matchings, GET /matchings/:variantId
  - PUT /policies/variants/:variantId

## 12. 이벤트 전략
- 내부 모듈 간: 직접 호출(동일 트랜잭션). 외부 시스템: Kafka 이벤트 발행
- 주요 이벤트(대외): ORDER_CREATED/CONFIRMED/MODIFIED/CANCELLED/MERGED, FULFILLMENT_CREATED/READY/LABELLED/SHIPPED/CANCELLED
- 발행 방식: Outbox 패턴 도입(`outbox_events`) → 트랜잭션 내 적재, 별도 디스패처에서 비동기 발행
- 페이로드 공통 필드: eventId, eventType, occurredAt(UTC), seoulTime(Asia/Seoul), aggregate{type,id}, context{mode,ownerId,warehouseId}

## 13. 시간/통화 정책
- 시간: 저장 UTC, 판단/표시는 Asia/Seoul
- 금액: 항상 정수(최소 통화단위), 통화코드 별도 보유(초기 KRW 고정)

## 16. 3PL / Drop-ship 구현 세부
- 모드 소스: `sales_variant_policies.fulfillment_mode` (in_house | third_party_3pl | drop_ship)
- FO 생성 시 모드 판정: SO 라인 기반. 혼재 시 `400 MIXED_FULFILLMENT_MODE_NOT_SUPPORTED`
- 3PL 규칙: FO.header.ownerId 필수, 모든 SKU.holderId == ownerId 불일치 시 `400 SKU_HOLDER_MISMATCH_FOR_3PL`
- Drop-ship 규칙: 로컬 예약/차감 금지(`ReservationsService`에서 차단), FO 가용성 판단 생략(READY 처리), 외부 출고 연계로 대체

## 17. 매칭 및 FO 자동 구성
- 매칭 API: `GET/PUT /wms/matchings/:variantId` (헤더+링크 관리)
- SO→FO 생성 시 매칭 링크로 SKU 라인 자동 구성(세트 수량 반영)

## 18. 트랜잭션 전파 규칙(요약)
- 퍼블릭 DB 메소드 마지막 인자 `tx?: DbTx`. 내부 헬퍼는 `tx: DbTx`
- `this.inTx(exec, tx)` 패턴 사용. 상위 tx 전파 보장

## 14. 품질/운영
- 전역 ValidationPipe, Swagger 문서화
- 멱등성: 초기 미도입(향후 Idempotency-Key 고려)
- 감사/로깅: 예약 이관·해제·차감, SO 병합 등 주요 액션 기록

## 15. 단계적 구현 계획(요약)
1) 스키마 정리: FO/라인 추가, stock_reservations FK 전환, sales_variant_policies 신설, isGift 제거
2) 모듈 스켈레톤: sales-orders, fulfillments, availability/reservations
3) 정책 적용: SO 접수/FO 생성/예약 판단 경로에 정책 적용
4) SO 병합 플로우 및 예약 재구성
5) 문서/Swagger, 운영 지표 및 감사 로그

> 부록: 상세 ERD/시퀀스 다이어그램은 후속 커밋에 추가

---

## A. ERD 요약(텍스트)
- sales_orders 1:N sales_order_lines
- sales_orders 1:N fulfillment_orders (초기), 합배송은 SO 병합으로 해결
- fulfillment_orders 1:N fulfillment_order_lines
- product_matchings(variant 헤더) 1:N product_variant_sku_links
- stock_reservations N:1 fulfillment_order_lines
- shipments N:1 fulfillment_orders

## B. 주요 시퀀스
1) 접수→FO 생성→예약
- SO 생성 → 정책 조회(variant) → (허용) FO 생성 → FOL 생성 → 재고 가용 조회 → 예약 성공 시 FO 진행, 실패 시 출고불가 표기
2) 재고 가용 증가 이벤트 시 재예약
- 입고/조정 등으로 ON_HAND 증가 → 대기 중 FOL에 대해 예약 재시도
3) SO 병합(합배송 승인)
- 후보 SO 조회 → 승인 → 단일 트랜잭션: 새 SO 생성, 원본 SO 취소, 기존 FO/예약 해제, 새 SO 기준 FO/예약 재구성
4) 예약 이관(steal)
- 단일 트랜잭션: FOL-A 예약 해제 → ON_HAND 복구 → FOL-B 예약 생성 → 감사 로그 기록

## C. 상태 전이 규칙(요약)
- FO: created → reserving → ready(picking) → labeled → shipped → canceled
- SO: derived(FO 집계) with precedence: 진행중 > 일부취소/일부완료 > 완료/취소

## D. DTO 스키마(요약)
- POST /sales-orders
  - channel, channel_order_id, customer, shipping_address, lines[variant_id, qty, price]
- POST /fulfillments (from SO)
  - sales_order_id, warehouse_id, split_rules(optional)
- POST /fulfillments/:id/reserve
  - lines[fol_id, qty]
- POST /sales-orders/merge
  - source_order_ids[], target_header_override(optional)

## E. 운영/감사
- 감사 로그: 예약 이관/해제/차감, SO 병합, FO 취소/출고 시점 기록
- 장애 복구: 예약-재고 정합성 재검증 배치(주기), 충돌 시 재시도 정책

## F. 오픈 이슈
- 정책 테이블의 유효기간 적용 범위(Asia/Seoul 기준 비교)와 캐시 전략
- Drop-ship 외부 지시 엔터티 스키마 구체화
- FO 분할/병합 UX 흐름(운영자 화면) 및 API 가이드
