# 합배송·송장분할·백오더·피킹 V2 기술 설계

- 날짜: 2026-07-14
- 상태: **Accepted — 구현 계획 작성 기준선**
- 코드 감사 기준: `de7c443a3bf3`
- 제품 결정 SoT: [`outbound-consolidation-split-backorder-decision-record.md`](../../outbound-consolidation-split-backorder-decision-record.md)
- 기존 원장 결정: [`adr/0027-outbound-shipment-consumes-stock-ledger.md`](../../adr/0027-outbound-shipment-consumes-stock-ledger.md)
- 목적: 제품·도메인 결정을 현재 Core 코드와 스키마에 투영하고, 구현 전에 고정해야 할 기술 구조·호환 전략·단계 경계를 정한다.

## 1. 결론: 구현 계획보다 이 기술 스펙이 먼저다

제품 결정 자체는 충분히 구체적이다. 그러나 현재 코드는 다음 의미를 외부 계약과 조회 로직에 이미 노출한다.

- FO가 batch와 피킹의 작업 단위이다.
- invoice가 FO에 선발급되고 shipment는 스캔할 때 생긴다.
- 한 shipment가 한 FO 전체 예약을 소진하고 FO를 `shipped`로 만든다.
- FO `completed`를 배송완료로 해석한다.
- `FulfillmentShipped` 하나가 외부 판매채널의 주문 전체 발송 명령이 된다.

따라서 테이블 추가 순서만 나열한 구현 계획으로 착수하면, 중간 배포 상태에서 같은 enum과 이벤트가 서로 다른 뜻을 갖게 된다. 다음 기술 결정을 이 문서의 구현 기준선으로 확정했다.

1. 목표 스키마와 상태축
2. 기존 fulfillment 트랜잭션 데이터를 폐기하는 hard cutover 단위
3. 이벤트 버전과 외부 consumer 전환 순서
4. 기존 FO/shipment/invoice/reservation의 명시적 정리 정책
5. Shipping Profile의 기존 테이블 재사용 방식

기존 시스템은 FO를 자동 생성했지만 실제 출고 기능을 운영한 적이 없으므로 기존 fulfillment 트랜잭션 데이터는 이관하거나 drain하지 않는다. 유지해야 할 SKU, SO와 재고원장 데이터는 정리 대상에서 제외한다. 세부 구현 계획은 이 기준선을 작업별 파일, 테스트, migration, deploy gate까지 분해한다.

## 2. 코드 감사 결과

### 2.1 이미 사용할 수 있는 기반

| 기반 | 현재 상태 | 재사용 판단 |
|---|---|---|
| SO↔FO 0..1:0..1 | `fulfillment_orders.sales_order_id` 부분 unique 존재 | 유지. ORM relation의 `many` 선언만 정렬 필요 |
| FO↔shipment M:N 데이터 표현 | `shipment_lines(fulfillmentOrderItemId, shipmentId, qty)` 존재 | 유지·확장. 서비스의 1:1 전제를 제거 |
| shipment 단위 원장 journal | `ship:{shipmentId}` 멱등키와 `sourceType='SHIPMENT'` 존재 | dispatch attempt 단위로 확장 |
| 원장 역분개 | `StockEventStore.reverseEvent()`와 reversal link 존재 | recall 전용 목적지 override가 필요 |
| 활성 invoice 1개 | shipment별 partial unique index 존재 | 유지. 발급 기준을 FO→shipment로 전환 |
| 시스템 로케이션 | `isSystem`, `systemRole`, 창고별 role unique 존재 | `outbound_rework` 추가와 비활성화 보호 강화 |
| 트랜잭션 경계 | fulfillment와 inventory가 같은 `wmsSchema`, `DbTx` 사용 | dispatch 원자성에 적합 |
| 감사 저장소 | 공용 `audit_logs`가 before/after, operator, correlation을 지원 | 위험 명령에 연결 가능 |

### 2.2 목표와 충돌하는 현재 구현

| 영역 | 코드의 실제 동작 | 목표와의 충돌 |
|---|---|---|
| FO 생성 | FOI 생성 직후 FOI 전량 예약을 시도하며 shipment는 만들지 않음 | 최초 Draft shipment 선생성 및 shipment-line 부분예약 부재 |
| 부분예약 | FOI 단위 요청 수량 전체가 성공하거나 실패. 서로 다른 FOI 사이에는 일부 성공 가능 | 같은 FOI 10개 중 6개 예약을 자동 표현하지 못함 |
| 예약 대상 | `targetType='FULFILLMENT_ORDER'`, `targetId=foId`, 선택적 `fulfillmentOrderItemId` | shipment line 수준 소진·이전 불가 |
| shipment 생성 | `openBoxByScan()`이 FO 미출고 잔량 전체를 복제해 lazy 생성 | Draft 계획, split, merge, backorder를 만들 시점이 없음 |
| shipment 소유 정보 | warehouse와 `openedForFulfillmentOrderId` 중심. 수취인·주소·profile·manifest version 없음 | 실제 배송 진실과 invoice 잠금을 shipment가 소유할 수 없음 |
| invoice | FO의 `picked/inspected` 상태를 검사하고 FO 전체 상품으로 발급 | 여러 FO shipment, 부분 라인, shipment address를 라벨에 반영 불가 |
| invoice void | shipment를 `canceled`, FO를 `picked`로 되돌림 | Draft 재계획, supersede, recovery 상태와 맞지 않음 |
| 출고 소진 | `openedForFulfillmentOrderId` 필수, FIFO로 현재 위치 조회, FO 예약 전체 해제, FO `shipped` 처리 | M:N, 부분예약, 실제 source bucket, 부분 FO 진행을 모두 위반 |
| batch | FO의 `batchId`를 직접 갱신하고 batch 합계도 FO 기준 | shipment work item, 독립 제외·완료·숏피킹 불가 |
| picking | FOI의 단일 `pickedQty` counter를 갱신 | shipment 귀속, worker/tote/cart/source bucket, 인계 이력 없음 |
| picking strategy | enum은 `individual/total_picking`이나 total은 명시적으로 미지원 | 세 전략 provider와 공통 orchestrator 부재 |
| 작업 중 재고 | Batch Inventory Session 없음 | 작업 통제권, crash 복구, 중복 정산 방지 불가 |
| 합배송 | 후보 주소·무게·고객을 난수로 만드는 stub, 실행도 가짜 ID 반환 | 운영에 사용할 수 없으며 제거 또는 전면 교체 필요 |
| FO 완료 | `markDelivered()`가 FO를 `completed`로 변경 | 결정문의 `completed = shippedQty + canceledQty 정산 완료`와 정반대 |
| 고객 tracking | shipment를 `openedForFulfillmentOrderId`, invoice를 FO로 묶어 조립 | 합배송 shipment 하나를 여러 주문에 투영하지 못함 |
| 반품 자격 | FO `completed`를 delivered 증거로 사용 | completed 의미 변경 시 미배송 주문도 반품 가능해지는 사고 가능 |
| 외부 이벤트 | shipment 출고마다 기존 `FulfillmentShipped` 발행, consumer는 주문 전체 `dispatch.ship` 실행 | 부분출고를 전체출고로 오인하고 채널 상태를 조기 전환 |
| 채널 주문상품 식별 | `OrderCreated.items[].orderItemId/channelProductId`가 `createFromEvent()` 변환에서 버려지고 `sales_order_lines`에 컬럼도 없음. legacy publisher는 `externalProductOrderId` 하나를 두 필드에 같이 넣기도 함 | shipment line 수량을 네이버 productOrderId·쿠팡 orderItemId로 변환할 신뢰 가능한 근거가 없음 |
| recall | 일반 역분개는 원래 source location으로 되돌림 | `OUTBOUND_REWORK` 목적지 복귀와 attempt 단위 멱등 부재 |
| 권한·감사 | shipment/invoice/batch controller에 위험 명령별 권한 정책 없음 | 합배송·주소 override·강제출고·recall 통제 불가 |
| cutover 경계 | 자동 생성된 FO와 예약이 있으나 실제 출고 운영 이력은 없음 | 기존 fulfillment 트랜잭션을 명시적으로 정리하고 V2만 재개해야 함 |
| 반품 연결 | 고객 반품은 `return_request_items`가 SO line만, 창고 반품은 별도 `return_items`가 SKU만 참조 | split/merge/recall 뒤 어느 shipment line과 dispatch attempt의 반품인지 식별 불가 |
| 관리자 권한 | Core의 `ALL_SCOPES`가 비어 있고 fulfillment controller는 `ScopeGuard`/`RolesGuard`를 사용하지 않음 | 인증 사용자라면 강제출고·송장 void·가짜 합배송 실행 endpoint까지 호출 가능 |
| Admin UI | batch 상세와 DTO가 FO 중심이고 `total_picking`을 선택할 수 있으나 backend는 즉시 거부 | 화면이 지원하지 않는 전략을 노출하고 shipment work item/claim/tote를 표현하지 못함 |

### 2.3 파급 범위

직접 수정 대상은 `apps/core/src/modules/fulfillment`만이 아니다.

- `apps/core/src/modules/inventory`: reservation target, source allocation, session overlay, movement guard, recall reversal
- `apps/core/src/modules/sales-order`: 고객 주문 진행 상태, tracking, 취소 가능 수량, 반품·교환 배송완료 판정
- `packages/event-contracts`: shipment/부분 FO/recall 이벤트
- `apps/channel-adapter`: 주문 전체 출고로 오인하는 consumer와 Medusa projection
- `apps/admin-web`: batch·피킹·invoice·shipment 상세와 split/consolidation UI
- migration/seed/runbook: system location과 fulfillment hard cutover

### 2.4 즉시 차단할 현재 운영 위험

다음은 V2 구현을 기다리지 않고 Phase 0에서 먼저 막아야 한다.

- `ConsolidationService`는 후보의 고객·주소·배송서비스·무게를 난수로 만들고 `autoConsolidate()`도 가짜 ID만 반환한다. 현재 mutation endpoint는 운영 기능으로 노출하지 않는다.
- `FulfillmentEventsConsumer.syncShipmentToChannels()`는 주문의 실제 채널을 판별하지 않고 네이버와 쿠팡 adapter 양쪽에 `dispatch.ship`을 호출하며, payload에 `channelOrderId`가 있어도 내부 SO UUID인 `orderId`를 전달한다. V2 이벤트 전환 전에 기존 consumer부터 채널 단일 라우팅과 올바른 외부 ID, inbox 멱등성을 갖춰야 한다.
- Admin UI는 `total_picking` batch 생성을 허용하지만 `PickingProcessService`는 이를 `BadRequestException`으로 거부한다. V2 전략이 준비될 때까지 선택지를 숨기거나 생성 API에서 명시적으로 비활성 capability를 반환한다.
- `POST /shipments/:id/force`, invoice void와 consolidation mutation에는 인증 외 권한 guard가 없다. 최소 임시 `RolesGuard('master', 'admin')`를 적용하고, 아래 scope 모델이 배포되면 scope guard로 교체한다.

## 3. 목표 아키텍처

### 3.1 세 가지 진실과 write owner

| 진실 | write owner | 파생/조회 |
|---|---|---|
| 원래 주문·SKU 수요 | SO, FO, FOI | FO 진행률, 취소 가능 수량 |
| 실제 박스·수취 정보 | Shipment, Shipment Line, Invoice, Dispatch Attempt | 주문별 tracking view |
| 약속·작업 중·반출 재고 | Reservation, Picking Source Allocation, Batch Inventory Session, Stock Ledger | available/movable/batch-controlled 수량 |

FOI의 원래 수량은 의미상 `originalQty`다. 기존 fulfillment row는 hard cutover에서 정리되므로 물리 컬럼을 `qty`로 유지할지 `original_qty`로 바꿀지는 contract migration의 명명 선택이며 데이터 호환 제약은 없다.

### 3.2 서비스 경계

```text
ShipmentPlanningService
  ├─ createInitialDraft
  ├─ split
  ├─ consolidate
  ├─ reviseRecipient
  └─ cancelOutstanding

ShipmentReservationService
  ├─ reservePartial
  ├─ releasePartial
  ├─ transfer
  └─ recomputeReadModels

InvoiceOrchestrator
  ├─ issueForShipment
  ├─ void
  └─ recoverExternalMismatch

OutboundBatchOrchestrator
  ├─ add/remove shipment work item
  ├─ start/finish session
  ├─ claim/handoff
  └─ short-pick recovery

PickingStrategyRegistry
  ├─ DiscretePickingStrategy
  ├─ AggregateThenSortStrategy
  └─ PickToToteStrategy

ShipmentDispatchService
  ├─ validateInspection
  ├─ settleSessionBuckets
  ├─ consumeReservations
  ├─ appendLedger
  ├─ recomputeFoProgress
  └─ enqueueOutbox

ShipmentRecallService
  ├─ voidInvoice
  ├─ reverseDispatchToRework
  ├─ restoreReservation
  └─ reopenFo
```

전략 provider는 plan과 스캔 의미만 소유한다. reservation, ledger, invoice, FO progress는 위 공통 서비스 밖으로 복제하지 않는다.

### 3.3 권장 command API

경로명은 구현 계획에서 조정할 수 있지만 resource owner와 명령 의미는 다음처럼 고정한다. 모든 mutation은 `Idempotency-Key`를 받고 결과 resource와 적용된 operation/attempt ID를 반환한다.

| 명령 | 권장 경로 | 핵심 입력 | 성공 결과 |
|---|---|---|---|
| Draft 분할 | `POST /shipments/:id/splits` | line별 이동 qty, 예약 이동 여부, reason | source/target manifest와 operation ID |
| 전체 합배송 | `POST /shipments/consolidations` | source shipment IDs, recipient 선택/override, reason, csCaseId | 새 Draft shipment와 operation ID |
| 수취 정보 변경 | `PATCH /shipments/:id/recipient` | recipient snapshot, reason | 증가한 manifestVersion |
| Planned 확정 | `POST /shipments/:id/plan` | shippingProfileId | 완전예약 검증을 통과한 Planned shipment |
| 미출고 수량 취소 | `POST /shipments/:id/cancellations` | line별 qty, reason | line/예약/FO progress 결과 |
| 예약 이전 | `POST /shipment-reservations/transfers` | source/target shipmentLineId, qty, reason | 양쪽 reservation summary |
| invoice 발급/void | `POST /shipments/:id/invoices`, `POST /invoices/:id/void` | provider 정보 또는 void reason | durable invoice operation ID |
| batch 편입/제외 | `POST/DELETE /outbound-batches/:id/shipments/:shipmentId` | 제외 시 reason | work item 상태 |
| claim/인계 | `POST /batch-work-items/:id/{picker-claims,packer-claims,handoffs}` | worker, scan/idempotency 정보 | claim 또는 handoff 상태 |
| 검수/강제출고 | `POST /shipments/:id/inspection-scans`, `POST /shipments/:id/force-dispatch` | barcode/qty 또는 reason | line progress 또는 dispatch attempt |
| recall | `POST /shipments/:id/recalls` | attemptId, physicalRecoveryConfirmed, reason, csCaseId, note | recall operation과 reversal journal |

읽기 API는 FO 중심 단건 응답에 shipment 하나를 끼워 넣지 않는다. `GET /fulfillment-orders/:id`는 progress summary와 shipment 목록을, `GET /shipments/:id`는 line별 FO/SO 출처·예약·invoice history·work item·dispatch attempts를 제공한다. 기존 FO 중심 DTO를 새 의미와 섞지 않고 V2 DTO로 교체한다.

외부 provider 호출이 포함된 invoice/recall 명령은 최초 응답이 `202 Accepted`일 수 있다. 이 경우 operation 조회 API에서 `pending | succeeded | recovery_required`를 관찰하며 같은 idempotency key의 재요청은 같은 operation을 반환한다.

### 3.4 권한과 감사 계약

role의 정의와 사용자에 대한 role 부여는 user-service가 SoT다. Core는 JWT에 담긴 role을 자신의 fulfillment scope로 매핑하고, `ALL_SCOPES`에 다음 scope를 등록해 위험 endpoint에 `ScopeGuard`와 `@RequireScopes`를 붙인다. Core가 별도의 role assignment를 소유하거나 user-service의 role을 복제하지 않는다. 알 수 없는 role과 scope 누락은 기본 거부한다.

| scope | 허용 작업 |
|---|---|
| `fulfillment.warehouse.operate` | 일반 split 계획, pick, pack, inspect |
| `fulfillment.shipment.consolidate` | 서로 다른 주문의 합배송 |
| `fulfillment.shipment.override_recipient` | 주문 원본과 다른 수취 정보 확정 |
| `fulfillment.reservation.transfer` | 예약 이전·우선순위 override |
| `fulfillment.dispatch.force` | 강제출고 |
| `fulfillment.dispatch.recall` | 출고 attempt recall |
| `fulfillment.shipment.reopen` | 잠긴 shipment 재개방과 invoice void 연계 |

초기 role→scope 매핑은 다음으로 고정한다. `logistics_manager`는 `logistics_worker`의 권한을 포함한다.

| user-service role | Core fulfillment scope |
|---|---|
| `logistics_worker` | `fulfillment.warehouse.operate` |
| `logistics_manager` | `fulfillment.warehouse.operate`, `fulfillment.shipment.consolidate`, `fulfillment.shipment.override_recipient`, `fulfillment.reservation.transfer`, `fulfillment.dispatch.force`, `fulfillment.dispatch.recall`, `fulfillment.shipment.reopen` |

위험 명령 DTO는 `operatorId`를 body에서 신뢰하지 않고 JWT `@User()`에서 얻는다. `reason`은 필수, `csCaseId`와 `note`는 선택이며, operation lineage와 공용 `audit_logs`를 같은 DB transaction에 기록한다. `audit_event_type` enum을 명령마다 늘리는 대신 `USER_ACTION`과 구체적인 `action` 값을 사용하고 before/after manifest, source/target, 영향을 받은 FO를 metadata로 보존한다.

## 4. 데이터 모델

상태축과 FK 방향은 이 구조로 고정한다. 정확한 물리 enum 문자열과 table/column 이름은 의미를 바꾸지 않는 범위에서 implementation plan과 migration 작성 시 조정할 수 있다.

### 4.1 기존 테이블 변경

#### `fulfillment_orders`

- 자사 물리 FO는 `warehouseId` 필수
- drop-ship은 이번 V2 router에 넣지 않고 `fulfillmentMode='drop_ship'`인 기존 direct-ship 경로로 명시적으로 분기
- SO relation은 DB의 부분 unique와 맞게 Drizzle `salesOrdersRelations.fulfillmentOrder`도 `one`으로 정렬

#### `sales_order_lines`

- `channelOrderItemId`: `OrderCreated.items[].orderItemId` 보존, legacy/manual SO는 nullable
- `channelProductId`: 원 이벤트의 판매채널 상품 식별자 보존
- `(salesOrderId, channelOrderItemId)` partial unique와 조회 index
- `SalesOrdersService.convertOrderItems()`와 생성 DTO가 두 값을 버리지 않도록 확장

수집 provider 계약에서 두 의미를 분리한다. `channelOrderItemId`는 채널에서 **주문의 특정 수량 라인**을 지칭하는 ID(예: 네이버 productOrderId, 쿠팡 orderItemId)이고, `channelProductId`는 listing/상품·옵션 매핑용 ID다. 기존처럼 한 source 값을 두 필드에 복제한 row는 신뢰 가능한 값으로 간주하지 않는다. cutover 이전 주문은 V2 FO를 자동 재생성하지 않으며, 이후 주문은 원 이벤트에서 두 값을 보존한다.

V2 channel dispatch는 내부 `salesOrderLineId`를 외부 ID로 추측하지 않는다. 채널 주문에서 신뢰 가능한 `channelOrderItemId`가 없는 line은 Planned 또는 channel dispatch를 차단하고 복구 가능한 데이터 오류로 노출한다.

#### `fulfillment_order_items`

- `qty`: 원래 수량. 직접 수정 금지
- `shippedQty`: 유지
- `canceledQty`: 신규, default 0
- `reservedQty`: contract migration에서 제거하거나 reservation 합계의 read-only summary로만 유지
- `pickedQty`: V2 write를 허용하지 않고 contract migration에서 제거
- `status`: 수량과 active shipment에서 계산한 projection으로만 갱신

행 간 보존식은 DB `CHECK` 하나로 강제할 수 없으므로 command transaction과 reconciliation query가 함께 검증한다.

```text
qty = shippedQty + canceledQty + active shipment line outstanding qty
```

#### `shipments`

추가/변경 필드:

- `status`: `draft | planned | shipped | in_transit | delivered | canceled | superseded | recovery_required`
- `warehouseId`: 유지, Draft부터 필수
- `shippingProfileId`: nullable Draft, Planned부터 필수
- `recipientSnapshot`: 실제 수취인·연락처·주소 JSONB
- `manifestVersion`: 구성 또는 수취 정보 변경마다 증가
- `plannedAt`, `shippedAt`, `deliveredAt`
- `supersededAt`, `recoveryCode`
- 기존 `openedForFulfillmentOrderId`, `openedBy`, `openedAt`는 contract migration에서 제거

invoice 발급 여부와 batch 작업 상태는 shipment status에 섞지 않는다. invoice는 별도 테이블, batch 작업은 work item 상태로 관리한다.

#### `shipment_tracking`

- `dispatchAttemptId` FK 추가, V2 tracking event에는 필수
- provider event ID 또는 `(dispatchAttemptId, status, occurredAt)` 기반 멱등키 추가
- shipment의 현재 배송 상태는 최신 non-recalled attempt에 속한 tracking만으로 계산

attempt 연결이 없으면 recall 전 운송장의 늦은 delivered webhook이 재출고한 동일 shipment를 잘못 완료시킬 수 있다. 기존 tracking row는 hard cutover에서 정리하므로 신규 row에는 attempt 연결을 강제한다.

#### `shipment_lines`

유지/추가 필드:

- 기존 `shipmentId`, `fulfillmentOrderItemId`, `skuId`, `qty`
- `reservedQty`: 선택적 summary. source of truth는 reservation row
- `inspectedQty`: 유지
- `lineVersion`: 스캔·분할 lost update 방지
- `createdFromLineId`: split 계보의 편의 참조, nullable

`unique(shipmentId, fulfillmentOrderItemId)`는 같은 FOI가 한 박스에 여러 행으로 중복되는 것을 막는 현재 의미를 유지한다. 동일 FOI가 여러 shipment로 나뉘는 것은 허용된다.

#### `stock_reservations`

- `shipmentLineId` 필수 FK 추가
- `requestedAt` 추가. split/merge에도 원래 우선순위를 보존
- `stateReason`, `invalidatedAt` 등 부족·복구 사유 보강

source of truth:

```text
shipmentLineId + warehouseId + skuId + quantity + status + requestedAt
```

hard cutover에서 기존 FO target reservation을 정리하고 `targetType/targetId/fulfillmentOrderItemId` dual-read를 만들지 않는다. reservation row는 location을 소유하지 않는다.

V2의 `fully reserved`는 판매 가능 정책이 아니라 물리 출고 가능성의 조건이다. 자사 물리 shipment line은 outstanding 전량의 confirmed reservation이 있어야 Planned가 된다. `alwaysSellableZeroStock`은 주문 접수/backorder를 허용할 뿐 이 gate를 우회하지 않는다. `drop_shipped` SKU 또는 `drop_ship` FO는 V2 batch에 넣지 않는다.

#### `invoices`

- `shipmentId`: 발급 전부터 필수이며 물리 NOT NULL 적용
- `issuedForFulfillmentOrderId`: contract migration에서 제거
- `manifestVersion`: 발급 시 shipment version 스냅샷
- `recipientHash`: 발급 시 수취 정보 스냅샷 검증
- 상태에 외부 saga 복구를 표현: 최소 `issuing/issued/voiding/voided/recovery_required`
- `voided` 이외 상태를 active로 보고 shipment당 최대 하나라는 partial unique 유지

현재처럼 외부 발급 후 DB insert가 실패하면 orphan invoice가 생길 수 있으므로, idempotency key와 provider request/response를 저장하는 durable operation row를 둔다.

#### `outbound_batches`

- `totalItems`, `totalQty`는 work item/line에서 파생하는 summary
- 기존 `assignedTo`는 사용하지 않음. picker/packer claim은 work item claim이 소유
- 기존 `fulfillment_orders.batchId`, `fulfillment_order_batches`는 contract migration에서 제거

#### `return_request_items`, legacy `returns/return_items`

고객 반품의 활성 모델인 `return_request_items`에 nullable `shipmentLineId`, `dispatchAttemptId`를 additive하게 추가한다. 신규 배송분 반품은 두 값이 필수이며 해당 attempt가 recall되지 않았고 그 attempt의 shipment tracking이 delivered이며 line이 요청 SO line에 속하고 누적 반품 수량을 넘지 않는지 검증한다. 기존 SO line-only 반품 row는 역사 데이터로 읽을 수 있지만 신규 요청에는 적용하지 않는다.

창고 재고 반품용 legacy `returns/return_items`는 별도 모델로 남아 있으므로 이번 범위에서 통합하지 않는다. 다만 고객 반품을 창고 receipt로 전환할 때 위 두 식별자를 metadata 또는 후속 nullable FK로 전달하고, `returns.shipmentId` header만으로 V2 반품 자격을 판단하지 않는다.

### 4.2 신규 테이블

#### `shipment_operations`, `shipment_operation_members`

split/consolidation/revision의 계보와 감사를 한 구조로 보존한다.

- operation: `type`, `operatorId`, `reason`, `csCaseId`, `note`, `createdAt`
- member: `operationId`, `shipmentId`, `role(source|target)`
- before/after manifest snapshot 또는 version link

단일 `supersededByShipmentId`는 한 source→여러 target split을 표현하지 못하므로 계보 테이블을 사용한다.

#### `invoice_operations`

- `invoiceId` nullable, `shipmentId`, `operation(issue|void)`
- `idempotencyKey`, `status`, provider request/response
- `attempts`, `lastError`, `nextRetryAt`

외부 API와 DB를 하나의 ACID transaction으로 묶을 수 없으므로 이 테이블을 saga 복구의 source로 사용한다.

#### `outbound_batch_work_items`

- `batchId`, `shipmentId`
- `status`: `queued | picking | ready_to_pack | packing | completed | short_pick_recovery | excluded`
- 한 shipment의 active work item partial unique
- picker/packer claim은 별도 claim row 또는 명확히 분리된 컬럼으로 관리
- claim/hand-off timestamps, lease version, exclusion reason

`fulfillment_orders.batchId`와 `fulfillment_order_batches`를 대체한다.

#### `picking_plans`, `picking_source_allocations`

- plan: batch, strategy, shipment manifest/reservation snapshot version, status
- allocation: plan, shipmentLine, sourceLocation, qty
- manifest/reservation/source stock version이 바뀌면 plan invalidation

`reservation snapshot version`은 암묵적인 timestamp 비교가 아니다. shipment별 reservation set을 변경하는 모든 명령이 증가시키는 `reservationVersion`을 shipment에 두거나, 동일한 역할의 별도 version row를 둔다. picking plan은 각 member shipment의 `(manifestVersion, reservationVersion)`을 member snapshot으로 저장한다.

출고 시 FIFO 재조회가 아니라 allocation의 source bucket을 사용한다.

#### `batch_inventory_sessions`

- batch당 session header, status, version, started/completed timestamps
- 인계 총량과 정산 총량

#### `batch_inventory_session_balances`

grain 권장안:

```text
sessionId + skuId + sourceLocationId + custodyType + custodyRef + shipmentLineId(nullable)
```

- custodyType: `AT_SOURCE | WORKER | BULK_CART | TOTE | SORTING | PACKING | PACKED | RETURN_PENDING | SETTLED`
- mutable balance로 빠른 작업 조회 지원
- 모든 mutation은 version CAS 또는 row lock 사용
- `custodyRef`와 `shipmentLineId`가 nullable이므로 단순 unique만 사용하지 않는다. `NULLS NOT DISTINCT` 또는 `COALESCE` expression index와 custody별 CHECK로 같은 bucket의 중복 balance를 막는다.

#### `batch_inventory_session_events`

세션 balance 변경의 멱등키와 복구 이력을 append한다. 메인 stock ledger는 아니지만 crash 후 balance 재구성과 명령 재시도 판정에 사용한다.

#### `totes`, `shipment_tote_assignments`

- barcode가 있는 tote만 엔티티화
- 한 shipment에 여러 tote 허용
- discrete의 개인 바구니는 tote를 만들지 않고 worker custody로 표현

#### `dispatch_attempts`, `dispatch_attempt_sources`

- attempt number, shipment, status, dispatched/recalled timestamps, 선택적 carrierAcceptedAt
- invoice, stock journal, reversal journal link
- source row는 shipment line별 source location과 qty, stock event ID를 연결
- `(shipmentId, attemptNo)` unique와 command idempotency key
- 출고 journal은 `sourceType='SHIPMENT_DISPATCH_ATTEMPT'`, `sourceId=attemptId`; recall reversal은 별도 journal로 만들고 attempt가 원본/reversal journal을 모두 참조

recall과 재출고의 반복 이력을 shipment header에 덮어쓰지 않는다.

### 4.3 Shipping Profile

감사 결과 현재 `delivery_profiles`는 `name`, `sourceType`, `avgDeliveryDays`뿐이고 SKU에서만 참조한다. 결정문이 요구하는 sender, origin/return address, carrier account, fulfillment mode, handling 조건을 담지 못한다. 실제 서비스 의존이 거의 없으므로 별도 중복 엔티티를 만들지 않고 **기존 테이블을 확장**한다.

- `delivery_profiles`를 shipping execution profile로 확장
- sender/origin/return address와 carrier account reference 추가
- supported fulfillment modes와 handling flags 추가
- shipment에 확정 profile FK 저장
- Draft shipment의 모든 line profile이 같으면 자동 확정
- 서로 다르면 Draft는 유지하되 Planned 전에 profile별 shipment로 split하도록 강제
- profile이 없는 SKU도 Draft 생성은 허용하되 Planned는 차단하고 설정 누락을 blocked reason으로 노출
- consolidation은 양쪽 shipment의 확정 profile이 같아야 허용
- 재고 owner/holder가 다르다는 사실만으로 차단하지 않으며, 각 line의 재고가 자사 통제이고 profile의 실제 발송 주체가 동일한지를 검증

관리자라도 mixed-profile shipment에 profile 하나를 수동 override할 수 없다. profile 변경이 필요하면 SKU/profile 설정을 먼저 수정한 뒤 다시 계산하거나 shipment를 split한다. 이 방식은 “FO 전체를 담은 최초 Draft”와 “한 shipment는 하나의 실행 profile”을 동시에 만족한다.

## 5. 상태와 불변식

### 5.1 FO progress

FO status는 shipment나 배송 상태를 직접 복제하지 않는다.

projection:

```text
created
partially_reserved
ready
processing
partially_shipped
completed
canceled
recovery_required
```

- `completed`: 모든 FOI에서 `qty = shippedQty + canceledQty`
- `canceled`: 전량 canceled인 completed의 특수 표현
- `partially_shipped`: shippedQty > 0이고 outstanding > 0
- delivered는 FO status에 없음
- recall 후 outstanding이 생기면 completed에서 다시 열린 상태로 전이 가능

기존 `picked/invoiced/shipped` enum 값은 hard cutover 이후 write를 금지하고 contract migration에서 제거한다.

### 5.2 shipment lifecycle

```text
Draft → Planned → Shipped → In transit → Delivered
  │         │
  ├─ Canceled
  ├─ Superseded
  └─ Recovery required

Shipped -- recall 보상 완료 --> Draft
```

batch의 picking/packing 상태는 work item에 둔다. invoice의 issue/void 상태도 invoice 축에 둔다.

FOI outstanding 합계에서 말하는 active shipment line은 아직 수요를 정산하지 않은 Draft/Planned/pre-dispatch work item의 line이다. shipped/canceled/superseded shipment line을 중복 포함하지 않는다.

### 5.3 수량 보존

각 command transaction은 다음을 잠금 후 검증한다.

```text
FOI.qty
= FOI.shippedQty
 + FOI.canceledQty
 + SUM(active shipment_lines.qty)

shipment_line.qty >= inspectedQty >= 0
shipment_line outstanding >= confirmed reservation qty >= 0

physical Planned shipment line outstanding = confirmed reservation qty
invoice.manifestVersion = shipment.manifestVersion when invoice is active

session handed-in
= session remaining
 + dispatch settled
 + returned
 + approved shortage/defect
```

동일 식을 주기적으로 검사하는 reconciliation query와 metric을 둔다. row 간 식은 application validation만으로 끝내지 않는다.

추가로 다음 상태 implication을 command guard와 DB index/check가 나누어 보장한다.

- active invoice는 shipment당 최대 하나이며 active invoice가 있으면 manifest와 recipient를 직접 변경할 수 없다.
- shipment는 한 번에 active work item 하나만 가지고, work item의 batch와 shipment는 같은 warehouse여야 한다.
- 같은 `(warehouse, SKU)`의 confirmed reservation 총합은 reservable on-hand를 넘지 않는다.
- batch-controlled source bucket은 일반 MOVE/transfer와 다른 batch allocation에서 제외한다.
- dispatch attempt 하나의 source 합은 shipment line별 qty와 같고 stock event는 source row마다 최대 하나다.
- 정상 dispatch는 `on_hand`와 `reserved`를 동량 감소시키며 recall은 `OUTBOUND_REWORK`에서 동량 복원한다.

## 6. 핵심 명령의 트랜잭션 설계

### 6.1 FO 생성

한 transaction에서:

1. SO/FO 1:1 잠금과 FOI 생성
2. FO 주소를 recipient snapshot으로 복사한 Draft shipment 생성
3. FOI 전체를 shipment line으로 생성하고 profile 호환성 계산
4. 가능한 수량만 shipment line에 부분예약
5. FO와 shipment progress 계산

부분예약은 `min(outstanding, currently reservable)`을 예약한다. “가용량 부족이면 FOI 예약 0”인 현재 동작을 바꾼다.

자사 물리 FO인데 warehouse가 없으면 transaction을 시작하기 전에 400으로 거부한다. 디지털-only SO는 기존 ADR대로 FO를 만들지 않고, drop-ship은 이번 router 밖의 direct-ship 경로로 유지한다. 보상출고처럼 SO 없는 자사 물리 FO도 warehouse를 명시해야 한다.

### 6.2 split

잠금 순서:

```text
FOI(id) → shipment(id) → shipment_line(id) → reservation(createdAt,id) → work item/session
```

- Draft만 직접 수정
- 미예약 수량 우선 이동
- 예약 이동을 명시하면 같은 transaction에서 reservation row 분할
- picked/session custody 수량이 있으면 먼저 unpick 요구
- 수량 보존과 manifestVersion 증가
- operation/audit 기록

### 6.3 consolidation

- source 전체 shipment만 허용
- source를 잠그고 warehouse/profile/drop-ship 조건 검증
- source가 Planned 또는 pre-dispatch batch 상태면 batch 제외·unpick·invoice void를 먼저 완료해 Draft로 되돌린 뒤 실행
- shipped/in-transit/delivered source는 합배송 명령에서 거부하고 recall/return 명령을 사용
- 활성 invoice가 있으면 saga void 완료 전 target 생성 확정 금지
- 새 recipient snapshot과 새 Draft target 생성
- source는 superseded, line/reservation은 target으로 이동
- operation member로 N source→1 target 계보 보존

외부 void 실패 시 source는 `recovery_required`로 남고 정상 Draft target을 활성화하지 않는다.

### 6.4 batch 시작

1. Planned·완전예약 shipment, 확정 profile/recipient와 active invoice 검증
2. picking plan과 source allocation 생성
3. source location별 수량 잠금/재검증
4. Batch Inventory Session으로 수량 인계
5. work item queued 생성

일반 재고 이동은 source location에서 session-controlled 수량을 제외해야 한다. 현재 warehouse 단위 reservation invariant만으로는 같은 창고 내 location 이동을 막지 못하므로 movement/transfer 공통 guard에 `batchControlledQty` 검사를 추가한다.

### 6.5 마지막 검수와 dispatch

shipment 및 work item lock 후 한 DB transaction에서:

1. 전 line `inspectedQty == qty`
2. active invoice의 manifestVersion/recipientHash 일치
3. session source bucket별 귀속 수량 확인
4. dispatch attempt와 source rows 생성
5. 각 source bucket에 SHIP event append
6. shipment-line reservation만 consume
7. session balance를 SETTLED
8. FOI shippedQty와 FO progress 재계산
9. shipment/work item 상태 갱신
10. outbox 기록

멱등키는 shipment가 아니라 attempt를 포함한다.

```text
dispatch:{shipmentId}:{attemptNo}
dispatch:{attemptId}:{shipmentLineId}:{sourceLocationId}
```

### 6.6 short pick

- affected shipment work item만 recovery로 이동
- batch/session에서 해당 shipment 귀속분 제외
- invoice void saga 완료
- 실제 존재한 정상 수량은 reservation 유지
- 부족 bucket만 reservation invalid/retry 상태
- 물리 반환 balance가 맞으면 Draft 복귀, 아니면 recovery_required

### 6.7 recall

기존 `reverseEvent()`는 SHIP을 원래 source location으로 되돌리므로 그대로 쓰면 결정문을 위반한다. inventory에 다음 전용 primitive가 필요하다.

```text
reverseShipmentDispatchEvent(originalShipEventId, toLocationId=OUTBOUND_REWORK)
```

이 primitive는 원 이벤트와 reversal link를 유지하면서 `null → OUTBOUND_REWORK/ON_HAND` 증가 이벤트를 만든다. recall transaction은 다음을 함께 처리한다.

- attempt와 shipment lock, recall 가능 상태 검증
- invoice void 완료 여부 확인
- source event별 rework 목적지 역분개
- 같은 shipment line reservation 복원
- line inspectedQty를 0으로 초기화하고 manifestVersion을 증가시킨 뒤 shipment를 Draft로 전환
- FOI shippedQty 감소와 FO reopen
- attempt recalled 및 outbox/audit 기록

외부 invoice void가 DB transaction 밖에서 실패할 수 있으므로 recall도 준비→외부 void→내부 보상 확정의 saga로 수행한다.

recall 준비 단계에서는 in-transit/delivered shipment, carrier acceptance가 확인된 attempt, 이미 recalled된 attempt를 거부하고 `physicalRecoveryConfirmed=true`를 요구한다. provider void가 성공했으나 내부 보상이 실패하면 shipment/attempt를 `recovery_required`로 유지하고 동일 operation 재시도로만 수렴시킨다.

## 7. 이벤트와 consumer 호환 전략

### 7.1 신규 이벤트

기존 `FulfillmentShipped`의 의미를 부분출고로 바꾸지 않는다.

- 신규 `shipments.events.v1` stream:
  - `ShipmentShipped`: dispatch attempt마다 1회
  - `ShipmentDelivered`: 특정 dispatch attempt의 shipment tracking delivered
  - `ShipmentDispatchRecalled`: attempt 보상 완료
- 신규 `fulfillments.events.v2` stream:
  - `FulfillmentProgressed`: 영향을 받은 FO의 shipped/canceled/outstanding summary
  - `FulfillmentReopened`: recall로 종결됐던 FO에 outstanding이 다시 생김
- 기존 `fulfillments.events.v1` 호환 이벤트:
  - `FulfillmentShipped`: FO가 **전량 출고**로 충족된 경우에만 발행
  - `FulfillmentDelivered`: 그 FO의 non-recalled 출고분이 모두 delivered된 경우에만 발행

channel-adapter를 producer보다 먼저 전환하고, hard cutover 시 미발행 상태인 기존 fulfillment outbox event를 명시적으로 격리하거나 정리한다. cutover 이후 기존 `FulfillmentShipped`는 full-completion projection 용도로만 사용하며 외부 발송 명령을 실행하지 않는다. 실제 채널 발송은 `ShipmentShipped`만 소유한다.

`ShipmentShipped` payload의 최소 계약은 다음과 같다.

```text
shipmentId, dispatchAttemptId, attemptNo, warehouseId, dispatchedAt
invoice { invoiceId, carrier, trackingNo }
orders[] {
  salesOrderId, fulfillmentOrderId, salesChannel, channelOrderId,
  lines[] { shipmentLineId, fulfillmentOrderItemId, salesOrderLineId, channelOrderItemId, skuId, qty }
}
```

합배송 shipment는 `orders[]`에 여러 주문이 들어간다. 수취인 주소 같은 PII는 channel dispatch에 필요하지 않으므로 이벤트에 싣지 않는다. shipment 이벤트 partition key는 `shipmentId`, FO progress 이벤트는 `fulfillmentOrderId`를 사용하고 consumer 멱등키는 `dispatchAttemptId` 또는 recall operation ID다.

스키마는 additive하게 먼저 배포하고 consumer가 신규 이벤트를 수용한 뒤 producer를 켠다.

### 7.2 channel-adapter

현재 consumer는 `FulfillmentShipped`를 받자마자 네이버/쿠팡 양쪽에 주문 전체 `dispatch.ship`을 호출하고 Medusa projection을 `shipped`로 만든다. 다음 전환이 선행되어야 한다.

1. `ShipmentShipped` inbox와 unique 멱등키를 dispatch attempt 기준으로 지원
2. `orders[]`의 `salesChannel`별로 해당 adapter 하나만 호출하고 `channelOrderId/channelOrderItemId`를 사용
3. 판매채널별 다중 tracking/부분출고 capability를 명시적으로 정의
4. 지원하지 않는 취소·recall은 `manual_adjustment_required` 상태로 기록
5. Medusa projection에 shipment/attempt 배열과 partial progress 저장
6. 기존 `FulfillmentShipped` handler에서 외부 dispatch를 제거하고 full-completion projection만 유지해 양 채널 broadcast와 중복 dispatch 제거

### 7.3 Core 주문 조회와 반품

- 고객 tracking은 FO header 연결이 아니라 `SO → FOI → shipment_line → shipment → invoice/tracking`으로 조립
- 합배송 shipment는 관련 SO 각각의 tracking view에 같은 shipment를 투영하되 해당 주문 line만 표시
- 배송 상태는 shipment events에서 계산
- 반품·교환 자격은 FO `completed`가 아니라 대상 `shipmentLineId/dispatchAttemptId`의 delivered 증거를 사용
- 신규 `return_request_items`는 위 두 ID를 보존하고 동일 attempt/line의 누적 요청 수량을 제한
- `shippedAt`이 있는 FO를 주문 전체 출고로 보는 취소 guard도 line outstanding 기반으로 교체

이 전환이 완료되기 전에는 FO `completed` 의미를 바꾸면 안 된다.

## 8. Hard cutover와 migration

### 8.1 cutover 원칙

기존 시스템은 FO를 자동 생성했지만 실제 출고 기능을 운영한 적이 없다. 기존 FO, shipment와 관련 작업 데이터는 업무 이력으로 보존하거나 V2로 변환하지 않고 maintenance window에서 정리한다.

- V1/V2 row-level `workflowVersion`, warehouse별 drain과 conversion command를 만들지 않는다.
- cutover 이전 SO에 V2 FO를 자동 backfill하거나 주문 이벤트를 replay하지 않는다.
- cutover 이후 새로 유입된 자사 물리 주문만 V2 FO와 최초 Draft shipment를 생성한다.
- drop-ship은 `fulfillmentMode='drop_ship'`으로 구분해 이번 V2 router 밖의 direct-ship 경로를 유지한다.
- V2 producer를 켜기 전에 channel-adapter와 신규 event consumer를 먼저 배포한다.

### 8.2 정리 전 감사와 보호 경계

정리 script는 먼저 read-only audit을 실행하고 다음 조건을 확인한다.

1. 기존 shipment와 연결된 SHIP stock journal/event가 0건
2. issued/used invoice, open shipment, active batch/picking이 운영 이력이 아닌 폐기 대상임을 확인
3. FO target의 pending/confirmed reservation 수량과 영향받는 `(warehouse, SKU)` 목록
4. `fulfillment_order_creation_backlogs`와 미발행 fulfillment outbox event가 cutover 후 과거 FO를 재생성하거나 발송하지 않도록 정리 가능한지 확인
5. fulfillment row를 참조하는 return/inspection/audit row와 실제 FK closure

SHIP 원장 이력이 한 건이라도 발견되면 원장을 truncate하거나 삭제하지 않고 cutover를 중단해 별도 보상·감사를 수행한다.

정리 대상은 schema와 실제 FK를 기준으로 명시적 allowlist를 만든다. 현재 코드 기준 후보에는 다음이 포함된다.

- `fulfillment_order_creation_backlogs`
- FO target인 `stock_reservations`
- `shipment_tracking`, `shipment_lines`, `shipments`
- `inspection_issues`, `invoices`
- `fulfillment_order_batches`, `outbound_batches`
- `fulfillment_order_items`, `fulfillment_orders`
- 미발행 상태인 기존 fulfillment 관련 `outbox_events`

`stock_reservations`에 FO 이외 target이 존재하면 테이블 전체를 truncate하지 않고 FO 대상 row만 삭제한다. 공용 `outbox_events`도 event/aggregate type으로 한정한다. `TRUNCATE ... CASCADE`를 검토 없이 사용하지 않으며 FK closure를 명시적으로 포함하거나 안전한 순서의 `DELETE`를 사용한다.

다음 데이터는 정리하지 않는다.

- `sales_orders`, `sales_order_lines`
- `skus`, SKU mapping/profile과 warehouse/location master
- `stock_journals`, `stock_events`, `stock_ledgers`
- fulfillment와 무관한 공용 outbox/audit 데이터

정리 후 confirmed reservation이 0이고 영향받은 `(warehouse, SKU)`의 reservation/ledger reconciliation이 green인지 검증한다.

### 8.3 배포 순서

destructive contract 변경은 별도 deploy로 분리한다.

1. 신규 event contract와 channel-adapter consumer를 additive하게 배포하고 기존 `FulfillmentShipped` 외부 dispatch를 제거
2. 신규 table/index와 호환 가능한 column을 expand migration으로 추가
3. maintenance window 시작: FO 생성 consumer, reservation retry, fulfillment mutation과 관련 worker 중지
4. DB snapshot과 read-only audit 결과 보존
5. 명시적 allowlist cleanup 실행, reservation/outbox 재생 방지와 reconciliation 확인
6. V2 Core producer와 API 배포 후 신규 자사 물리 주문부터 처리 재개
7. 관찰 기간 뒤 old FK/column과 V1 code path를 별도 contract migration/deploy로 제거

V2 데이터가 생성되기 전 rollback은 snapshot과 이전 release로 복귀할 수 있다. V2 주문 처리가 시작된 뒤에는 V1 code로 되돌리지 않고 신규 유입을 중지한 상태에서 V2 code로 이미 생성된 작업을 복구한다.

## 9. 구현 워크스트림과 권장 순서

아래는 상세 implementation plan을 만들 때의 phase 경계다. 각 phase는 독립적인 migration/deploy gate와 통합 테스트를 가져야 한다.

### Phase 0 — 특성화와 안전장치

- 제거할 기존 출고 경로, 부분 이벤트 consumer, FO completed/return 의미를 특성화 테스트로 고정
- hard cutover read-only audit, explicit cleanup과 reconciliation script
- 구현 기간 중 불필요한 기존 FO가 누적되지 않도록 FO 자동 생성/worker 중지 방안
- 기존 consolidation stub을 운영 API에서 명확히 차단
- channel-adapter의 네이버·쿠팡 동시 broadcast 제거와 channel 단일 라우팅
- 신규 `ShipmentShipped`가 `channelOrderId/channelOrderItemId`를 보존하는 contract와 기존 `FulfillmentShipped` 외부 dispatch 제거
- force/void/consolidation mutation에 임시 admin guard, Admin UI의 미지원 total-picking 선택 차단

### Phase 1 — additive domain foundation

- sales_order_lines channelOrderItemId/channelProductId 보존과 신규 주문 event ingestion 수정
- FOI canceledQty, shipment address/profile/manifest·reservation version, reservation shipmentLine FK, tracking dispatchAttempt FK
- shipment operation, invoice operation, dispatch attempt 기본 테이블
- `OUTBOUND_REWORK` role과 seed/protection
- `return_request_items`의 shipmentLine/dispatchAttempt 연결과 fulfillment scope 등록
- FO/shipment progress calculator와 invariant checker
- 최초 Draft shipment 생성

### Phase 2 — shipment 계획과 부분예약

- reservation partial allocate/release/transfer
- reservation retry worker를 shipment-line 부분예약과 backorder 재시도 기준으로 전환
- Draft split, recipient revision, cancellation
- conservative consolidation candidate query
- explicit consolidation command와 lineage/audit
- Planned gate와 full-reservation 검증

### Phase 3 — invoice ownership 전환

- shipment manifest 기반 label item/recipient 생성
- issue/void durable saga와 recovery queue
- manifest lock/version validation
- invoice controller/admin API를 shipment 기준으로 전환

### Phase 4 — batch work item과 공통 picking foundation

- FO batch link를 shipment work item으로 대체
- claim/handoff/short-pick 상태 머신
- picking plan/source allocation
- Batch Inventory Session balance/event와 movement guard
- crash recovery/reconciliation

### Phase 5 — 세 picking strategy

- discrete
- aggregate then sort
- pick to tote
- 공통 inspection/packing으로 수렴
- 전략 계약 테스트로 동일 불변식 검증

세 전략은 같은 abstraction 위에서 구현하되 warehouse별 운영 선택은 명시 설정으로 한다. 코드의 숨은 default는 두지 않는다.

### Phase 6 — dispatch와 이벤트 전환

- session source bucket 기반 attempt 정산
- shipment-line reservation consume
- FO progress, `shipments.events.v1`/`fulfillments.events.v2`와 full-completion 호환 event
- channel-adapter/Medusa/store tracking 전환
- 기존 `FulfillmentShipped/Delivered` full-completion 호환

### Phase 7 — short pick, recall, 재출고

- short-pick isolation과 정상 예약 유지
- rework 목적지 역분개 primitive
- recall saga, FO reopen, 새 attempt 재출고
- 외부 채널 manual-adjustment 상태

### Phase 8 — UI와 contract cleanup

- admin shipment planner, split/consolidation, address override, recovery 화면
- batch strategy별 작업 UI와 tote/claim/handoff
- 고객 tracking/return line selection
- hard cutover와 관찰 기간 뒤 FO batch fields, FO invoice FK, openedForFO, FIFO dispatch path 제거

## 10. 테스트 전략과 release gate

### 10.1 필수 테스트 층

- command unit: 상태 전이, 수량식, 권한, audit payload
- DB integration: row lock, partial unique, 멱등, 실제 ledger/reservation 수치
- concurrency: 동시 split/reserve/claim/inspect/dispatch/recall
- strategy contract: 세 provider가 동일 session/dispatch 불변식을 통과
- migration rehearsal: 기존 fulfillment fixture→audit/cleanup→expand→V2 producer enable→contract
- cutover contract: SKU/SO/stock ledger는 보존되고 fulfillment row와 FO reservation만 제거되며 과거 주문이 replay되지 않음
- consumer contract: 부분출고가 주문 전체 출고로 해석되지 않고 실제 salesChannel adapter 하나만 호출
- authorization contract: 일반 작업자와 고권한 scope의 허용/거부 및 JWT operator 감사
- return contract: split/merge/recall 이후 delivered attempt의 line 수량만 반품 가능
- crash recovery: 외부 invoice 발급/void와 session/dispatch 각 단계 중단 후 재시도

### 10.2 숫자 불변식

기존 물류 통합 테스트의 원장 불변식에 다음을 추가한다.

- FOI original/shipped/canceled/outstanding 보존
- shipment split/merge 전후 line 합과 reservation 합 보존
- session 인계/잔여/정산/반환/조정 보존
- shipment dispatch마다 onHand와 reserved 동량 감소, available 불변
- recall마다 onHand와 reserved 동량 증가, available 불변
- batch 종료가 이미 settled 수량을 다시 차감하지 않음

### 10.3 배포 gate

V2 producer를 활성화하기 전:

1. V2 17개 대표 시나리오 통합 테스트 green
2. FO 생성 consumer, reservation retry, fulfillment mutation과 관련 worker 중지 확인
3. DB snapshot과 read-only audit 보존, 기존 SHIP stock journal/event 0건 확인
4. explicit cleanup 후 FO target confirmed reservation 0건과 reservation/ledger reconciliation 0 drift
5. 기존 미발행 fulfillment outbox event 정리와 과거 주문 replay 방지 확인
6. channel-adapter 신규 consumer와 단일 채널 라우팅 배포 확인
7. 신규 주문의 channelOrderId/channelOrderItemId 보존 contract 확인
8. invoice provider issue/void sandbox 복구 훈련 완료
9. user-service의 `logistics_worker`/`logistics_manager` role 발급, Core scope 매핑과 위험 endpoint deny 테스트 확인
10. V2 데이터 생성 전 snapshot rollback과 생성 후 신규 유입 중지/runbook 확인

## 11. 확정된 기술 결정

다음 항목을 승인했으며 파일별 implementation plan은 이를 변경하지 않는다.

1. 기존 `delivery_profiles`를 확장하고 mixed-profile Draft는 Planned 전에 반드시 split한다. 관리자 수동 profile override는 허용하지 않는다.
2. FO/shipment/invoice/work-item의 상태 의미와 상태축을 본 문서대로 고정한다. 정확한 enum 문자열은 구현 세부로 위임한다.
3. 기존 fulfillment 트랜잭션은 명시적 allowlist로 정리하고 V1 drain, conversion과 row-level workflowVersion 없이 hard cutover한다. SKU/SO/stock ledger는 보존한다.
4. 신규 `shipments.events.v1`/`fulfillments.events.v2` 계약과 기존 full-completion 이벤트 유지
5. recall 역분개를 `OUTBOUND_REWORK` 목적지로 직접 만드는 inventory primitive
6. `return_request_items`의 shipmentLine/dispatchAttempt 연결을 additive하게 도입하는 방식
7. role 정의·부여의 SoT는 user-service에 두고, Core는 `logistics_worker`/`logistics_manager`를 `ALL_SCOPES`/`ScopeGuard` 기반 fulfillment scope로 매핑한다.

그 외 table/column 이름은 구현 계획에서 조정할 수 있지만 다음은 변경하지 않는다.

- shipment line이 FO와 shipment의 M:N 및 예약 target이다.
- batch와 dispatch의 작업/정산 단위는 shipment이다.
- 작업 중 이동은 session, 경제적 반출/복귀는 stock ledger다.
- shipment dispatch는 batch 종료를 기다리지 않는다.
- FO completed와 delivered는 분리한다.
- 외부 이벤트 consumer 전환이 FO 상태 의미 변경보다 먼저다.

## 12. 코드 감사 근거 인덱스

상세 implementation plan 작성 시 아래 파일을 출발점으로 삼는다.

| 근거 | 확인한 현재 동작 |
|---|---|
| [`inventory.schema.ts`](../../../apps/core/src/modules/inventory/schema/inventory.schema.ts) | FO/FOI/reservation/shipment/invoice/batch가 한 평면 schema에 있고, shipment line M:N 표현은 있으나 상태·recipient/session/attempt가 없음 |
| [`fulfillments.service.ts`](../../../apps/core/src/modules/fulfillment/services/fulfillments.service.ts) | FOI insert 후 각 FOI 전량 예약을 시도하고 shipment는 생성하지 않으며 `markDelivered()`가 FO를 completed로 바꿈 |
| [`fulfillment-order-transaction.service.ts`](../../../apps/core/src/modules/fulfillment/services/fulfillment-order-transaction.service.ts) | FO를 직접 batch에 할당하고 batch 합계를 FO 수량으로 증가시킴 |
| [`fulfillment-reservations.facade.ts`](../../../apps/core/src/modules/fulfillment/services/fulfillment-reservations.facade.ts) | reservation target과 transfer가 FO/FOI 기준이고 summary counter를 함께 갱신 |
| [`shipment.service.ts`](../../../apps/core/src/modules/fulfillment/services/shipment.service.ts) | invoice scan 시 FO 잔량 전체를 미러해 shipment를 lazy 생성하고 마지막 검수에서 자동 출고 |
| [`invoice.service.ts`](../../../apps/core/src/modules/fulfillment/services/invoice.service.ts) | FO 상태/전체 FOI를 기준으로 외부 invoice를 먼저 발급하고 DB 실패 시 best-effort void |
| [`outbound-consumption.service.ts`](../../../apps/core/src/modules/fulfillment/services/outbound-consumption.service.ts) | `openedForFulfillmentOrderId`를 요구하고 출고 시 FIFO location 재조회, FO 예약 전체 소진, 기존 FulfillmentShipped 발행 |
| [`outbound-batch.service.ts`](../../../apps/core/src/modules/fulfillment/services/outbound-batch.service.ts), [`picking-process.service.ts`](../../../apps/core/src/modules/fulfillment/services/picking-process.service.ts) | FO/FOI counter 중심이며 `total_picking`은 enum/UI에 있지만 backend가 거부 |
| [`consolidation.service.ts`](../../../apps/core/src/modules/fulfillment/services/consolidation.service.ts) | 후보 데이터와 실행 결과가 난수/가짜 ID인 stub |
| [`stock-event.store.ts`](../../../apps/core/src/modules/inventory/core/repositories/stock-event.store.ts) | generic reversal이 원 이벤트의 from/to를 그대로 반전하므로 SHIP은 원 source location으로 복귀 |
| [`store-sales-orders.service.ts`](../../../apps/core/src/modules/sales-order/services/store-sales-orders.service.ts) | FO completed를 delivered로 보고 tracking을 `openedForFulfillmentOrderId`와 FO invoice로 조립 |
| [`sales-orders.service.ts`](../../../apps/core/src/modules/sales-order/services/sales-orders.service.ts), [`orders.stream.ts`](../../../packages/event-contracts/streams/orders.stream.ts) | OrderCreated에는 외부 orderItemId가 있지만 Core 생성 변환과 sales_order_lines가 이를 보존하지 않음 |
| [`fulfillments.stream.ts`](../../../packages/event-contracts/streams/fulfillments.stream.ts) | 기존 FulfillmentShipped는 단일 FO/order와 tracking을 전제로 하는 v1 계약 |
| [`fulfillment-events.consumer.ts`](../../../apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts) | FulfillmentShipped 하나를 네이버와 쿠팡 양쪽에 주문 전체 dispatch로 전파 |
| [`merged-scopes.ts`](../../../apps/core/src/platform/auth/merged-scopes.ts) | Core scope registry가 비어 있어 fulfillment 위험 명령의 세분 권한 기반이 없음 |
| [`outbound-batches` Admin UI](../../../apps/admin-web/src/features/order/outbound-batches) | batch detail/available 목록/DTO가 FO 중심이고 지원되지 않는 total picking을 선택 가능 |
| [`20260630225428_cluster-b-fo-identity.sql`](../../../apps/core/drizzle/20260630225428_cluster-b-fo-identity.sql) | 과거 FO당 active shipment unique를 제거해 스키마는 M:N 방향으로 열렸지만 서비스 전제는 남아 있음 |
