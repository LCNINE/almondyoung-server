# 물류 백엔드 정상화 스프린트 현황판 (2026-07)

> 출처: 2026-07-08 물류 백엔드 전수 감사 (fulfillment · inventory core/원장/예약 · inbound/movement/stocktaking/warehouse · sales-order 4개 영역 병렬 감사 + 치명 등급 직접 재검증).
> 이 문서가 본 스프린트의 **상황판(허브)** 이다. 항목 착수/완료 시 상태 컬럼을 갱신한다.
>
> 표기: **✅검증** = 감사 후 코드를 직접 열어 재확인한 항목. 나머지는 감사 보고 기준(착수 시 현장 재확인).
> 상태: ⬜ 미착수 / 🟨 진행 / 🟩 완료 / ⏸ 보류(사유 명기)

## 스프린트 목표

감사에서 발견된 결함 전부의 해소. 대규모 재설계가 아니라 **"원장 쓰기 단일화 강제 + 레거시 경로 은퇴 + 예약 보강 + 컨슈머 실패 분류"** 4개 워크스트림(§5)으로 묶어 처리한다.

---

## 1. 보존할 강점 (회귀 가드 — 수정 작업이 이걸 깨면 안 됨)

| # | 강점 | 근거 위치 |
|---|---|---|
| G1 | 출고 메인 경로 완주 가능: 주문수집 → FO 생성(backlog) → 예약(재시도 워커) → 배치/피킹 → 송장발급 → 박스 open(스캔) → 검수 자동완료 → SHIP 소진 → 배송완료 | `order-events.consumer.ts:103` → `fulfillment-order-creation-backlog.worker.ts:31` → `fulfillments.service.ts:410` → `outbound-batch.service.ts` → `invoice.service.ts:214` → `shipment.service.ts:36,132` → `outbound-consumption.service.ts:50` → `fulfillments.service.ts:930` |
| G2 | 출고 소진 seam: SHIP 이벤트 append + on_hand 차감 + 예약 소진 + available 불변 (ADR-0027 Phase 0~2 구현·통합검증 완료) | `outbound-consumption.service.ts:98,136`, 통합 spec `outbound-consumption.integration.spec.ts` |
| G3 | 이벤트 append ↔ 원장 projection 동일 트랜잭션 + 조건부 UPDATE(`gte`) + `ck_ledgers_non_negative` fail-loud. `stock_summary`는 뷰라서 ledger 와 구조적 drift 없음 | `stock-event.store.ts:51-102,129-148`, `schema:842,849` |
| G4 | backlog 의 트랜잭션 보장(SO+backlog 동일 tx 커밋, ADR-0014 준수) + 멱등(onConflictDoNothing, FOR UPDATE SKIP LOCKED claim) + 매칭 등록 시 wake | `order-events.consumer.ts:77-106`, `backlog.service.ts:40,63,198` |
| G5 | outbox 디스패처: lease + SKIP LOCKED, attempts 단일 지점 증가, at-least-once | `outbox-dispatcher.service.ts:61-138,105,195` |
| G6 | `consumeShipment` 멱등: 박스 status early-return + SHIP idempotencyKey + journal 멱등 + 검수 tx 박스 FOR UPDATE | `outbound-consumption.service.ts:67,104,224`, `shipment.service.ts:219` |
| G7 | 주문 수집 멱등: `(salesChannel, channelOrderId)` unique, AUTHORIZED→CAPTURED 중복 SO 미생성, orderEvents.eventId unique | `inventory.schema.ts:1058,1104`, `sales-orders.service.ts:675` |
| G8 | 부분취소의 미출고(예약해제/FO조정) vs 출고(반품 경로) 분기 — ADR-0016 부합 | `sales-orders.service.ts:1285,1327-1340` |
| G9 | 판매가능수량 recalc 트리거 커버리지 양호(재고변동·예약·매칭·variant/version 변경 전부 호출) | `stock-event.store.ts:98`, `unified-reservation.service.ts:83,107,304`, catalog/matching 다수 |
| G10 | inventory ↔ fulfillment 순환 의존 없음. 소진 seam 을 fulfillment 에 둔 배치 의도 유지 | `outbound-consumption.service.ts:15-24` |
| G11 | 예약 facade 잠금 순서(FO→FOI) + over-reserve 불변식 | `fulfillment-reservations.facade.ts:60-90` |

---

## 2. 결함 현황

### P0 — 치명 (재고 무결성 직접 파괴 / 업무 불능)

| ID | 상태 | 위치 | 결함 | 실패 시나리오 |
|---|---|---|---|---|
| P0-1 ✅검증 | 🟩 | `movement/services/movement.service.ts:174-253(create), 259-305(complete)` | 창고간 이동이 `toState:null` MOVE 로 **출발지만 차감**(`:232`) — IN_TRANSFER 미기록, complete 는 입고예정 expectedDate 만 갱신 | PO 외 ad-hoc 이동 100개 → 출발 창고 -100, 어디에도 +100 없음 = 영구 소실. **(착수 재확인 2026-07-10)** 무손실 경로는 `StockEventService.transferBetweenWarehouses`(`stock-event.service.ts:142-196`, transferShip→transferReceive = ON_HAND→IN_TRANSFER→ON_HAND)이며 `TransferService.executeTransferJob` 경유로 `inventory/transfers` 컨트롤러에 **이미 배선됨** — 감사의 "미연결" 서술은 부정확. 실제 문제는 손실 경로 `POST /movement/inter-warehouse` 가 **병존 노출**(`movement.controller.ts:14`). 재배선 시 간극: DTO 에 `toLocationId` 부재(도착 로케이션 결정 규칙 필요), 작업3 멱등 래퍼(`withIdempotency`)와 transferShip/Receive 이벤트 키 상호작용 확인, `movementJobs.warehouseId` 의미 차이(손실=to, Transfer=from). complete 쪽은 멱등 래퍼도 없음 |
| P0-2 ✅검증 | 🟩 | `stocktaking/services/stocktaking.service.ts:361-374` | 실사 조정이 `tx.insert(stockEvents)` **직접 INSERT** — StockEventStore 우회 → 원장/판매가능수량/outbox 미반영 | 실사 확정해도 시스템 재고 불변. `stocktakingAdjustments.stockEventId` 는 원장 미반영 유령 이벤트를 참조 |
| P0-3 ✅검증 | 🟩 | `stocktaking.service.ts:329-396` | 실사 조정 멱등성/재실행 방지 부재 (세션 상태 미검사, 처리 플래그 없음) | `generate-adjustments` 2회 호출 → 조정 2배 생성 (P0-2 수정 즉시 실피해로 전환 — **P0-2 와 반드시 함께 수정**) |
| P0-4 ✅검증 | 🟩 | `core/services/inventory-correction.service.ts` (삭제됨) | `correctReceipt`/`reportTransportLoss`/`processDefectiveItems` 가 fromState/toState 미설정 → `ck_events_side_present`(`schema:812`) 위반 | 세 메서드 모두 **dead code**(모듈·컨트롤러 미등록, 호출처 0) — 배선하는 순간 즉시 500. **완료(작업4): 서비스 전량 삭제** — 어느 모듈에도 미등록(주입조차 불가)·컨트롤러/DTO 없음·미래 의도 표시 없음이라, 규칙에 맞게 고쳐 살려두기보다 제거. 재고정정/운송분실/불량처리 기능은 필요 시 규칙 준수(`InventoryCommandService` 경유)로 신규 작성 |
| P0-5 ✅검증 | 🟩 | `shared/services/reservation-lifecycle.service.ts:130-157` | `processExpiredReservations` 의 `timeoutAt < now()` 필터가 **주석 처리**(`:135`) — 호출 시 confirmed 예약 전체 해제. 현재 호출처 0건(dead 지뢰) | 누군가 크론/컨트롤러에 배선하는 순간 전 예약 해제 → 대량 초과판매. **제거가 답**. **(착수 재확인 2026-07-10)** 사실 유지 — 호출처 0(테스트 포함). 정상 만료 경로 `releaseExpiredReservations`(`unified-reservation.service.ts:283-310`, 올바른 timeoutAt 필터 `:296-297`) + 10분 크론(`reservation-cron.service.ts:17`)이 살아있어 순수한 깨진 중복. **메서드만 삭제** — 서비스는 활성 호출 4곳(`outbound-consumption:136`, `fulfillment-order-transaction:191`, `fulfillments:1027`, `sales-orders:481`)이라 존치, 모듈 배선 정리 불요 |

### P1 — 높음 (오동작이 곧 돈/재고로 이어지는 경로)

| ID | 상태 | 위치 | 결함 | 실패 시나리오 |
|---|---|---|---|---|
| P1-1 ✅검증 | ⬜ | `sales-order/consumers/order-events.consumer.ts:126, 212` | `OrderCancelled`/`OrderRefundCreated` 가 SO 미존재 시 throw → 재throw → 오프셋 미커밋 | out-of-order 전달(취소가 생성보다 먼저) 시 파티션이 포이즌 메시지로 정체. `OrderModified` 는 skip 처리(`:176`)와 불일치 |
| P1-2 ✅검증 | ⬜ | `order-events.consumer.ts:138-153` + `sales-orders.service.ts:454,470` | 출고완료 주문의 채널발 전체취소 → `cancel()` BadRequestException → 무한 재시도 | OUT_OF_STOCK/ADMIN 취소가 출고 후 도착하면 영구 소비 실패 |
| P1-3 ✅검증 | ⬜ | fulfillment 전역 (`fulfillments.service.ts:804`, `fulfillment-reservations.facade.ts:92`) | FO 예약 `timeoutAt=null` — 만료 크론(`unified-reservation.service.ts:296`) 대상에서 영구 제외 | ship/cancel 없이 방치된 FO 의 예약이 available 을 영구 잠금(과소판매). 타임아웃 정책 결정 + 잔존 예약 모니터링 필요 |
| P1-4 | ⬜ | `core/services/unified-reservation.service.ts:257-277, 56-79` | 가용 확인→예약 INSERT 사이 락 없음 (TOCTOU) | 동시 요청 둘 다 available=10 을 읽고 각각 10 예약 → `reserved(20) > on_hand(10)` = 초과판매. ADR-0011 의 "감수" 범위를 넘어 단일 창고 내에서도 발생 |
| P1-5 | ⬜ | `core/services/inventory-command.service.ts:366-428` | `adjustDown` 이 confirmed 예약을 무시하고 로케이션 ON_HAND 만 검증 | `on_hand=10, reserved=10` 에서 adjustDown 5 성공 → `on_hand < reserved` 모순 → 이후 FIFO 소진 throw 로 출고 실패 |
| P1-6 | 🟩 | `services/fulfillment-order-transaction.service.ts:344` | 예약을 dead 상태값 `status='active'` 로 조회 (실제 예약은 전부 `'confirmed'` 생성, `unified-reservation.service.ts:75`) | 이 경로 사용 시 예약 전량을 0 으로 보고 배치 가용 과다 계산 → 이미 묶인 재고를 할당 가능으로 오판. **(착수 재확인 2026-07-10)** 버그 코드 실재하나 유일 호출자 `createFulfillmentOrder`(`:51`)가 dead — 컨트롤러 `POST /fulfillment-orders` 는 GoneException(`fulfillment-order.controller.ts:19-21`), 그 외 호출처 0. 즉 P0-4/P2-2 와 같은 **잠복 지뢰**로 강등. 해소 = `createFulfillmentOrder` + private 헬퍼 3종(`checkStockAvailability` 포함) 삭제 — P3-5 코드 정리와 한 몸 |
| P1-7 ✅검증 | ⬜ | `sales_orders.status` 전이 3곳뿐 (`sales-orders.service.ts:357,418,555`) | `processing/shipped/delivered` 미전이 — ADR-0017 이 Core 소유로 명시한 상태들이 미구현 | `getStats()` 출고완료 통계 항상 0(`:831`), `cannotShip` 쿼리 confirmed 전제로 누락. **결정 필요**: FulfillmentShipped 소비로 전이 구현 vs 저장 상태 최소화 선언 + 통계 FO 기준 전환 |
| P1-8 | ⬜ | `store-return-exchange.service.ts:493-513, 748-756` | 반품 환불에서 `already_refunded` 를 완료로 매핑 안 함 (취소 경로 `store-sales-orders.service.ts:682-696` 는 매핑 — 불일치) | 환불은 성공했는데 반품이 `refund_pending` 고착, 재시도로 탈출 불가(수동 처리 필요) |
| P1-9 | ⬜ | `store-return-exchange.service.ts:448-513` | 반품 완료 2단계(환불 호출)가 tx 밖 — 환불 성공 후 크래시 시 상태 불일치 | 돈은 나갔는데 `refund_pending` 유지. P1-8 때문에 자동 복구도 안 됨 — 복구 가능한 상태기계로 |
| P1-10 | ⬜ | `store-return-exchange.service.ts:1308-1316` | 환불 비례식 분모는 `totalPrice ?? unitPrice*qty`, 분자는 `unitPrice*returnQty` — 기준 불일치 | 라인 할인으로 `totalPrice ≠ unitPrice*qty` 인 주문의 부분 반품 환불액 과대/과소 산정 |
| P1-11 | ⬜ | `services/shipment.service.ts:36-123` | `openBoxByScan` 이 invoice 만 FOR UPDATE — FO 미잠금, FO당 open 박스 1개 강제 없음 (`issuedForFulfillmentOrderId` DB 부분 unique 부재) | 한 FO 에 non-voided 송장 2개(취소→재발행 경합) → 각각 스캔 → 둘 다 동일 잔량 박스 open → 각자 검수완료 → **on_hand 이중 차감** |

### P2 — 중간 (정합성/견고성)

| ID | 상태 | 위치 | 결함 |
|---|---|---|---|
| P2-1 | ⬜ | `outbound-consumption.service.ts:70-73, 136` | `consumeShipment` 가 FO 1:1 가정 — `openedForFo=null` 이면 throw, 예약 소진이 박스 라인이 아닌 **FO 전량** 단위. 합배송/송장분할(M:N) 흐름을 열기 전에 라인 단위 소진으로 전환 필요 (스키마는 이미 M:N 개방) |
| P2-2 | 🟩 | `core/services/sku-location-movement.service.ts` (삭제됨) | `recordMovement` 가 원장을 건드리지 않는 "이동"을 completed 로 기록 → 로케이션 grain 원장과 물리 위치 불일치 → FIFO 소진이 틀린 로케이션 선택 가능. **단 컨트롤러 라우트 전부 주석처리 — 현재 호출 불가(잠복). 완료(작업4): 서비스·컨트롤러·DTO 삭제.** `sku_location_movements` **테이블은 존치**(향후 재고이동 기능 재도입 예정 — ADR-0005 destructive DROP 회피). 재도입 시 `moveInternal` 위임으로 원장 정합 확보 |
| P2-3 | ⬜ | `inbound/services/inbound.service.ts:782-787` | 초과 수령 무제한 허용 (expectedQty 상한/경고 없음) |
| P2-4 | 🟩 | `inbound.service.ts:107,191,270,760`, `movement.service.ts:92` | 입고/이동 경로 전부 `idempotencyKey` 미전달 — 재전송 시 중복 입고(재고 2배). `stock_events.idempotencyKey` 방어막 무력화. **(+`returnInbound:915`·`createInterWarehouseTransfer:220` 동일). 진짜 재-POST 방어엔 클라이언트 요청 키 필요 — inbound line id 는 이벤트 후 생성이라 못 씀** (착수 재확인 2026-07-08) **완료(작업3): 전용 idempotency 테이블+래퍼로 9개 경로 요청 멱등화, 이벤트 파생 키 병행, admin-web 키 수명주기 래퍼** |
| P2-5 | 🟩 | `stocktaking.service.ts:139-149`, `schema:1716` | 실사 라인 무조건 INSERT — (session×sku×location) unique 없음, 동시 세션 로케이션 배타 제어 없음 → 재스캔/동시 실사 시 이중 조정. **완료(작업1): `(session,sku,location)` unique(NULLS NOT DISTINCT) + `scanLocation` onConflictDoNothing** |
| P2-6 | 🟩 | `stocktaking` 전반 | 실사가 expected 를 스캔 시점 ON_HAND 스냅샷으로만 계산 — 카운팅 중 예약/이동 미고려 (variance-delta 방식의 이중 계산 위험). **완료(작업1): 완료 시 라이브 delta(counted−현재ON_HAND)로 이중계산 위험 해소; 카운팅 중 표시 expected 스냅샷은 조정 정확성에 무영향** |
| P2-7 | ⬜ | `core/services/location.service.ts:534-551` | 로케이션 삭제에 재고 가드 없음 → 도메인 에러 대신 FK 위반 500. qty=0 잔여 row 케이스도 정리 필요 |
| P2-8 | ⬜ | `warehouse/services/warehouse.manager.ts:70-78` | 창고 삭제 in-use 검사와 삭제가 다른 트랜잭션 (TOCTOU) — 최악 500 |
| P2-9 | ⬜ | `fifo-allocate.ts:27-34` vs `allocation-strategy.service.ts:337` | FIFO 이중 구현 정렬 기준 불일치 (fifoRank+updatedAt vs updatedAt만) — 계획 로케이션 ≠ 실소진 로케이션 |
| P2-10 | ⬜ | `outbound-consumption.service.ts:198` | active invoice 부재 시 `carrier:'CJ'` 하드코딩 + trackingNumber `''` 발행 — 불변식 위반을 잘못된 데이터로 다운스트림 전파 |
| P2-11 | 🟩 | `modules/fulfillment/services/fulfillments.service.ts:1075-1077` | `computeAdminAvailableActions` 가 은퇴한 `POST /fulfillments/:id/ship` 을 광고 → UI 렌더 시 404 (RFC Cluster A 후속 #1). **(착수 재확인 2026-07-10) 라이브 404 확정** — admin-web `shipment-tab.tsx:234` 가 버튼 실렌더, 클릭 시 부재 라우트 호출(`fulfillments.client.ts:86`). ship 외 광고 액션 8종 라우트는 전부 실존. 수정 시 **admin-web 동시 수정 필수**(canShip 블록·`useShipFulfillment`·client `ship()`). 부수 발견: 서버가 광고하지 않는 `assignShipment`(`shipment-tab.tsx:48`)/`split`(`split-tab.tsx:62`) 데드 버튼 2건 — 반대 방향 계약 불일치(404 아닌 영구 비활성), 같은 PR 에서 처리 검토. **✅ 작업 7 완료(2026-07-10)**: 서버 광고 블록 삭제 + admin-web ship(헤더+탭)·assignShipment·split(탭째) 3건 전량 제거(수직 슬라이스 3커밋). 서버 `ship()` 메서드(direct-ship 내부 호출) 존치. 부수 발견: ship 호출자가 상세 헤더에도 있었음(2곳), 0-importer 데드 부모 `detail/index.tsx` 동반 삭제. |
| P2-12 | ⬜ | `store-sales-orders.service.ts:624`, `store-return-exchange.service.ts:730` | Wallet Idempotency-Key 가 호출마다 randomUUID — 동시 실행 시 이중 환불 방어가 전적으로 Wallet 측 refundable 검증에 위임 |
| P2-13 | ⬜ | `partial-cancellation-refund-calculator.ts:124-146` | 부분취소 환불 추정치가 이전 취소 기환불액 미차감 — 항상 manual_pending 이라 자동 과다환불은 없으나 운영자 표시 합계가 총액 초과 가능 |
| P2-14 | 🟩 | events↔ledgers 대사 부재 | `stock_events`(진실)↔`stock_ledgers`(파생) 를 재검증/복구하는 reconcile 잡·엔드포인트 없음. `calculateQuantityAsOf`(`stock-event.store.ts:204`) primitive 만 존재 — P0 우회 버그류 탐지 장치로 신설. **완료(작업2 — develop 스쿼시 머지 `ae5f979c0`)**: 탐지 전용 대사 잡 신설, §5 WS-A 작업 2 블록 참조 |
| P2-15 | ⬜ | `order-events.consumer.ts:104` | library grant 가 SO 생성과 동일 tx — grant 실패가 유료 주문 수용을 롤백 (재전달 자가치유 의존). 분리 검토 |

### P3 — 컨벤션/정리 (단, P3-1 은 실질 위험)

| ID | 상태 | 범위 | 내용 |
|---|---|---|---|
| P3-1 | ⬜ | sales-order·fulfillment·inventory 구세대 서비스 전반 | `@app/shared` 도메인 에러 대신 Nest HttpException throw. **단순 스타일 아님**: backlog 워커가 `error instanceof BadRequestException` + 응답 문자열/code 파싱으로 제어흐름 결정(`worker.ts:135,164-179`) — 에러 리팩터 시 매칭 누락 주문이 자동 재시도(wake)에서 조용히 탈락. 코드를 실은 타입 있는 도메인 예외로 이관 + 워커 문자열 파싱 제거를 **한 세트로** |
| P3-2 | ⬜ | `inventory-correction.service.ts:34,83,124`, `location.service.ts:135,240,450`, backlog `worker.ts:61` | ADR-0025 이탈: `this.db.transaction` 직접 호출, `tx?` 전파 없음. `location.service.getLocationById`(`:62`) 의 tx 이탈 latent 버그 포함 |
| P3-3 | ⬜ | `product-sellable-quantity.service.ts:204~485`, `outbox.service.ts:19`, `audit.service.ts:261` | seam 서비스의 반복 `as MergedTx` + `as unknown as` 캐스트, `payload as any` — ADR-0025 의 1회 narrowing 원칙으로 정돈 |
| P3-4 | 🟩 | 스키마/enum 전반 | dead 값 정리: FO status `reserving/labeled/inspecting/inspected/pending`(세터 없음 — invoice 게이트 `invoice.service.ts:229` 의 `inspected` 분기 도달 불가), reservation `pending/active`, shipment `failed/in_transit`, `eventTypeEnum` 의 RESERVE/CONFIRM/RELEASE/CANCEL(원장 미사용 — "예약도 이벤트소싱" 착시, review §5-3), transitionType `MARK_DEFECT/REWORK_GOOD`(작업4 후 producer 0). **(착수 재확인 2026-07-10 정정)**: ① shipment `delivered` 는 **dead 아님**(`fulfillments.service.ts:969` 가 실제 set) — 대상 제외. delivery-provider 의 `in_transit/delivered/failed` 는 별개 타입(`DeliveryStatus`)이라 무관. ② FO `pending`(`transaction.service.ts:152`)·reservation `active`(`:122,344`)는 dead `createFulfillmentOrder` 안에 리터럴 producer 잔존 — **P1-6/P3-5 코드 삭제 선행 필요**. ③ 전부 `pgEnum` — Postgres 는 enum 값 DROP 미지원, 값 제거는 타입 재생성 = **destructive → expand-contract 필수**. `inspected` 게이트 도달 불가 판정은 확정. **✅ 완료(작업 8a, 2026-07-10)**: orphan `event_type` enum(미부착 vestigial, 실제 원장은 `transition_type` 소유) DROP + column-attached dead 값 4종(fulfillment/reservation/shipment/transition)에 8b 마커 주석으로 **재사용 잠금**. **값의 물리적 제거(pgEnum recast)는 의도적 비목표** — 마커가 dead 값 재사용을 차단해 실질 리스크 0, recast 는 destructive·저가치·dev DB 의존이라 스프린트 범위에서 제외(필요 시 optional 후속). ⟶ 완료 처리. |
| P3-5 | 🟩 | `outbound_tasks`/`outbound_task_items/lines` + `FulfillmentOrderTransactionService` | 평행/유휴 상태 서브시스템 — batch 경로와 이중 구현(할당 경로 중복: `outbound-batch.service.ts:152` vs `fulfillment-order-transaction.service.ts:259-262`). **(착수 재확인 2026-07-10 정정)**: ① `shipFulfillmentOrder`/`completeFulfillmentOrder` 는 **이미 부재**(grep 0건 — 감사 서술 outdated). ② outbound_task 3(+`outbound_task_orders`)개 테이블은 **런타임 참조 0**(admin-web 포함) — 스키마 정의/relations/타입 export 만 잔존, 서비스와 무관한 별개 dead 자산. drop 은 expand-contract 로. ③ 서비스 **통째 은퇴 불가** — `cancelFulfillmentOrder`/`updateFulfillmentOrderPriority` 가 admin-web 라이브(`fulfillment-order.client.ts:97,108`), `allocate` 라우트도 배선 live(FE 호출 0). dead 범위 = `createFulfillmentOrder`+헬퍼 3종(P1-6 버그 포함)+Gone POST 핸들러+`consolidation.service.ts:6,171` 죽은 주입. **✅ 작업 5 완료(2026-07-10): 코드부 절제 전량(커밋 `09c00dcdb`) — 저장소 참조 0 확인. `outbound_task` 4테이블 DROP 만 작업 8(expand-contract) 잔여**. **✅ 작업 8a 완료(2026-07-10)**: `outbound_task` 4테이블(+`outbound_task_orders`) DROP 마이그레이션 생성(런타임 참조 0 → 단일 PR, 적용 ⏸ dev DB) — **P3-5 종결**(코드부 작업5 + 테이블 DROP). |
| P3-6 | ⬜ | 인가 | JWT 인증은 글로벌(APP_GUARD)이나 **역할 기반 인가 부재** — 발주 승인·재고 조정·창고 삭제에 role 통제 없음 |
| P3-7 | ⬜ | 규칙 정합 | CLAUDE.md "Inventory 금지: `db.query.*`/`with`" vs ADR-0025 "per-BC 가드레일로 유지" 상충 — inventory 전반에서 광범위 사용 중. 규칙을 한쪽으로 확정하고 문서 정리 |
| P3-8 | ⬜ | `safety-stock.service.ts:25,64,103` 등 | `run` 람다 파라미터가 바깥 `tx` 와 동명(shadowing) — 무해하나 실수 유발 |

---

## 3. 업무 흐름 공백 (막다른 지점 / 미지원 업무)

| ID | 상태 | 공백 | 비고 |
|---|---|---|---|
| W1 | 🟩 | 창고간 이동의 안전한 엔드포인트 부재 | **(착수 재확인 2026-07-10 정정)** 안전 엔드포인트는 이미 존재 — `inventory/transfers` 2단계(`POST` 생성 → `PATCH :id/execute`)가 `StockEventService.transferBetweenWarehouses` 무손실 경로로 배선됨. W1 의 실체 = 손실 경로 `POST /movement/inter-warehouse` 의 병존. 해소 = 해당 엔드포인트를 무손실 경로로 재배선(도착 로케이션 결정 규칙 신설 필요 — DTO 에 `toLocationId` 부재) 또는 은퇴 후 transfers 경로로 일원화. P0-1 과 동일 작업 |
| W2 | 🟩 | 실사 세션 취소 불가 | `cancelled` enum 만 존재(`schema:128`), 세터/라우트 없음. **완료(작업1): `cancelSession` + `POST /stocktaking/sessions/:id/cancel` 신설(draft·in_progress→cancelled, FOR UPDATE)** |
| W3 | 🟩 | 실사 complete ↔ generateAdjustments 순서·원자성 미정의 | 확정 전 조정 가능, 확정 후 재조정 가능 — 상태기계로 잠금 (P0-3 과 함께). **완료(작업1): complete 가 단일 tx 에서 원자 적용+종결, generate 는 무영속 미리보기로 격하** |
| W4 | ⬜ | 토탈피킹 미구현 | `picking-process.service.ts:89,177,257` throw. `total_picking` 배치는 피킹에서 막힘. 로케이션 전략 seam 은 준비됨 — 스프린트 범위 여부 결정 |
| W5 | ⬜ | 합배송·송장분할(`splitShipment`) 흐름 미구현 | 모델(M:N)만 개방 — RFC Non-Goal. 착수 시 P2-1 선행 필수 |
| W6 | ⬜ | 직배(drop-ship) 별도 엔티티 추출 미착수 | `fulfillmentMode='drop_ship'` 분기 산재(`shipment.service.ts:68`, `fulfillments.service.ts:411,872`, `reservation-retry.worker.ts:89`, `outbound-batch.service.ts:215`). 혼합주문이 단일 FO 로 생성되어 직배 품목이 자사 FO 에 흡수되는 잠재버그 상존 — 별도 워크스트림(RFC 명기) |
| W7 | ⬜ | 발주/공급사 단위 반품(RTV) 부재 | 입고 라인 회송(`returnInbound`)만 존재 |
| W8 | ⬜ | 입고 바코드 검수 ↔ 실입고 단절 | `verifyInboundByBarcode`(`inbound.service.ts:1080`) 가 단순 조회 — 검수 결과가 `receiveFromPlan` 에 연결 안 됨 |
| W9 | ⬜ | 로케이션 capacity 미집행 | 스키마/DTO 에만 존재, 입고/적치/이동 검증 없음 |
| W10 | ⬜ | 운영 확인 필요: `confirm`(출고확정) 이 FO 생성 트리거가 아님 | FO 생성은 OrderCreated 시점 backlog — confirm 은 스냅샷 생성뿐(`sales-orders.service.ts:306-362`). ADR-0010 서술과 어긋남 — 의도 확인 후 문서 또는 코드 정정 |
| W11 | ⬜ | 외화 PO 크로스보더 인바운드(source 플랜 → 창고간 이송 → destination 플랜 활성화) 미완성 | 삭제한 `completeInterWarehouseMovement` 가 닫으려던 루프. Path A(소실)·Path B(즉시 atomic) 어느 쪽도 지속 IN_TRANSFER(중국→한국 다일 운송)를 모델링 안 함. 부수: `purchase-order.service.ts:313` 이 만드는 `planType='destination'`(expectedDate=null) 플랜이 활성화 경로 없이 pending 잔존 → `stock_summary` 뷰 `transit_out`/`inbound_pending` 에 영구 반영(기존 조건, 작업 6 이 악화 아님). 착수 시 2단계 상태기계·receive API·도착 로케이션 규칙 설계 필요 |

---

## 4. 문서 정비

| ID | 상태 | 항목 |
|---|---|---|
| D1 | 🟩 | CONTEXT.md 의 낡은 "설계 결정, 미구현" 주석 갱신 (출고주문 스냅샷 / 예약 소진·환원 / 상자·운송장) — 2026-07-08 반영 |
| D2 | ⬜ | ADR-0017 의 SO 상태 소유 서술 — P1-7 결정에 맞춰 정정 |
| D3 | ⬜ | ADR-0010 의 confirm 서술 — W10 확인 후 정정 |

---

## 5. 워크스트림 구성과 권장 순서

**WS-A. 원장 쓰기 단일화 강제** — P0-2, P0-3, P0-4, P2-2, P2-4, P2-14, W3
모든 수량 변화가 `StockEventStore.createEvent`(또는 `InventoryCommandService`)를 통과하도록 재배선 + `stockEvents` 직접 INSERT 금지 아키텍처 테스트 + events↔ledgers reconcile 잡 신설.
> **착수 재확인(2026-07-08):**
> - P0-2 의 'outbox 미반영'은 `createEvent` 가 outbox 를 enqueue 하지 않기 때문 — outbox 는 상위 래퍼 `InventoryCommandService`(adjustUp/adjustDown)가 넣는다. 따라서 실사 조정은 bare `createEvent` 가 아닌 **`InventoryCommandService.adjustUp/adjustDown` 으로 재배선**해야 ledger+sellable+outbox 가 한 tx 에 산다.
> - 직접 INSERT 위반의 실제 사정거리는 프로덕션 `stocktaking.service.ts:362` **단 1곳**(나머지 수량변경 경로는 이미 store 경유). arch test 는 이 1파일 봉인 + 회귀 방지용.
> - P0-4·P2-2 는 라이브가 아닌 **잠복 지뢰**(각각 미배선 dead code / 라우트 주석처리). 실제 라이브 P0 파괴는 실사(P0-2/P0-3)뿐 → 착수 1순위.

> **✅ 작업 1 (실사 정상화) 완료 — 2026-07-09:** P0-2·P0-3·P2-5·P2-6(실사 라이브 delta)·W2·W3 해소 + **직접 INSERT 금지 아키텍처 테스트**(`inventory-write-boundary.arch.spec.ts`) 신설. 완료 시점 원장 원자 적용(`InventoryCommandService.adjustUp/adjustDown`, 라이브 delta), `generateAdjustments`→미리보기 격하, 세션 상태기계(cancel + scan/count 가드, 세션 FOR UPDATE).
> - 브랜치 `feat/stocktaking-normalization` (6 커밋, tip `12eaebd88`) → **develop 스쿼시 머지 `e9ce5597d`** (2026-07-09).
> - 설계 `docs/superpowers/specs/2026-07-09-stocktaking-normalization-design.md` · 계획 `docs/superpowers/plans/2026-07-09-stocktaking-normalization.md`.
> - ⏸ **배포 전 확인**: (1) prod/dev 실사 데이터 유무 — 있으면 마이그레이션 dedup phase 분리(spec §10 #1). (2) dev DB 부재로 통합 테스트 런타임·마이그레이션 적용(`db:setup`) 미실행 — DB 복구 시 실행(arch test·tsc·lint 는 통과).

> **✅ 작업 2 (원장 대사, P2-14) 완료 — 2026-07-09:** events↔ledgers 대사 잡 신설 — **탐지 전용·무상태**(수리(repair)·drift 이력 테이블은 의도적 비목표, 마이그레이션 없음). 단일 SQL 스냅샷 대사 쿼리(grain unpivot → FULL OUTER JOIN, POSTED·non-void 필터 = `applyProjection` 동형) + 야간 크론(03:00 KST, `LedgerReconciliationService`) + 온디맨드 `GET /inventory/ledger-reconciliation` + Prometheus 게이지 `wms_ledger_drift_grains`(severity 라벨, 정상 시 0 명시 set). 작업 1 의 정적 쓰기 경계(arch spec)의 **런타임/데이터 레벨 짝**.
> - 브랜치 `feat/ledger-reconciliation` (8 커밋, tip `f7c2cee07`, SDD 4태스크 + 최종리뷰 fix) → **develop 스쿼시 머지 `ae5f979c0`** (2026-07-09).
> - 설계 `docs/superpowers/specs/2026-07-09-ledger-reconciliation-design.md` · 계획 `docs/superpowers/plans/2026-07-09-ledger-reconciliation.md`.
> - 검증: 단위(대사/severity/크론/메트릭)·arch 경계 회귀·tsc·lint(eslint 0) GREEN. ⏸ 통합 스펙 6건(정상·수량불일치·원장행부재·missing-derived[P0-2 우회클래스]·warehouseId/skuId 필터)은 dev DB 복구 시 실행(작업 1 ⏸ 항목과 동일).

> **✅ 작업 3 (요청 멱등화, P2-4) 구현 완료 — 2026-07-09:** 전용 `inventory_idempotency_requests` 테이블(unique(endpoint,key), 응답 jsonb) + `InventoryIdempotencyService.withIdempotency` 래퍼 신설 — 신규 키는 handler 실행+응답 저장, 중복 키는 저장 응답 replay(본문 해시 불일치·처리중은 409 ConflictError), 30일 보존 야간 크론(purge). `InboundService` 7개 핸들러(simpleInbound·simpleInboundFullscan·individualInbound·receiveFromPlan·putawayFromOrigin·returnInbound·cancelInbound) + `MovementService` 2개 핸들러(moveImmediately·createInterWarehouseTransfer) 전부 래핑, DTO `idempotencyKey` required. `stock_events.idempotencyKey` 는 이벤트 파생 키로 병행 유지(하위 세분화 방어). admin-web 은 `useIdempotentMutation` 훅으로 키 수명주기(생성·mutation 성공/실패 시 재사용/폐기) 래핑 — 컴포넌트 call site 무수정.
> - 브랜치 `feat/inbound-movement-idempotency` (SDD 7태스크, tip `7d176c9e8`) → **develop 스쿼시 머지 `09b2b2609`** (2026-07-09).
> - 설계 `docs/superpowers/specs/2026-07-09-inbound-movement-idempotency-design.md` · 계획 `docs/superpowers/plans/2026-07-09-inbound-movement-idempotency.md`.
> - 검증: 단위(래퍼 6케이스 + purge 1 + 배선 7+2)·arch 경계 회귀·tsc·lint GREEN. admin-web `tsc --noEmit` GREEN(컴포넌트 call site 무수정). ⏸ 통합 스펙 4건(simpleInbound replay·returnInbound replay·다른 본문 409·movement.move 래퍼 replay)은 dev DB 복구 시 실행(작업 1·2 ⏸ 항목과 동일).

> **✅ 작업 4 (dead 정정/이동 경로 청소, P0-4·P2-2) 완료 — 2026-07-09:** 규칙(원장 단일화)을 어기면서 라이브도 아닌(잠복 지뢰) 두 서비스를 **삭제로 청소**. 고쳐 살려두는 대신 제거 — 필요 시 규칙 준수로 신규 작성한다는 판단.
> - **P0-4**: `InventoryCorrectionService` 전량 삭제(파일 1개). 어느 모듈에도 미등록이라 배선 정리 불필요, 전용 DTO 없음, `stockJournals.sourceType`(varchar)라 스키마 무영향.
> - **P2-2**: `SkuLocationMovementService` + `SkuLocationMovementController` + `dto/sku-location-movements/`(4개) 삭제 + `inventory.module.ts` 배선 5줄 제거. **`sku_location_movements` 테이블은 존치** — 향후 재고이동 기능 재도입 예정 + ADR-0005 §5 destructive DROP 회피(코드 제거와 스키마 DROP 분리 원칙). 재도입 시 `moveInternal` 위임으로 원장 정합.
> - 스키마/마이그레이션 무변경. dead enum(`MARK_DEFECT`/`REWORK_GOOD` producer 0화)은 P3-4 통합 정리로 이관.
> - 브랜치 `feat/correction-movement-normalization` (커밋 `5ac16a263`) → **develop 스쿼시 머지 `4afb106ae`** (2026-07-09). 삭제분 워킹트리 반영 확인(2026-07-10).
> - 검증: `nest build core`(tsc/webpack) exit 0 · eslint 0 · arch 경계 회귀(`inventory-write-boundary.arch.spec.ts`) PASS · 저장소 전역 참조 0 재확인. 스키마 무변경이라 dev DB 의존 ⏸ 항목 없음.
> - **WS-A 잔여(미착수): 없음** — WS-A 전 항목(P0-2·P0-3·P0-4·P2-2·P2-4·P2-5·P2-6·P2-14·W3) 완료.

**WS-B. 레거시 경로 은퇴** — P0-1, P0-5, P1-6, P2-11, P3-4, P3-5, W1 *(W2 는 작업1에서 기해소 — 목록에서 제외)*
inter-warehouse 손실 엔드포인트를 무손실 경로로 재배선, dead 지뢰(`processExpiredReservations` 메서드, `createFulfillmentOrder` 경로, dead enum, `outbound_tasks` 테이블) 제거. destructive 스키마 변경은 expand-contract(ADR-0005 §5) 준수.

> **착수 재확인(2026-07-10) — 5개 영역 병렬 검증 완료. 요지:**
> - **사실 유지**: P0-1(라인 밀림, `toState:null` @ `:232`) · P0-5(메서드만 삭제, 서비스 존치) · P2-11(라이브 404 확정, admin-web 동시 수정 필수) · enum dead 판정 대부분.
> - **정정**: W1(안전 경로는 이미 `inventory/transfers` 에 배선 — 실체는 손실 경로 병존) · P1-6(유일 호출자 dead → 잠복 지뢰로 강등) · P3-5(`ship/completeFulfillmentOrder` 이미 부재, 서비스 통째 은퇴 불가 — dead 부분만 절제) · P3-4(shipment `delivered` 는 live producer 존재, 대상 제외).
> - **의존성**: P3-4 의 FO `pending`·reservation `active` 리터럴 producer 가 dead `createFulfillmentOrder` 안에 있어 P1-6/P3-5 코드 삭제가 선행. 전 enum 이 pgEnum 이라 값 제거는 expand-contract.
>
> **권장 작업 분할(순서대로):**
> 1. **작업 5 — dead 지뢰 일괄 소거(코드만)**: P0-5 메서드 삭제 + P1-6/P3-5 코드부(`createFulfillmentOrder`+헬퍼 3종+Gone POST 핸들러+consolidation 죽은 주입). 순수 삭제·스키마 무변경·저위험 1 PR. P3-4 선행조건.
> 2. **작업 6 — P0-1/W1 창고간 이동 무손실화**: WS-B 유일의 라이브 P0. 설계 필요 — 도착 로케이션 결정 규칙, DTO `toLocationId` 간극, `withIdempotency`×transferShip/Receive 멱등 상호작용, `movementJobs.warehouseId` 의미 차이, complete 경로 처분.
> 3. **작업 7 — P2-11 ship 광고 정리**: 서버 `:1075-1077` 제거+spec 2곳 + admin-web(canShip 블록·훅·client) 동시. 부수 데드 버튼 2건(`assignShipment`/`split`) 처리 여부 포함.
> 4. **작업 8 — P3-4/P3-5 스키마 contract**: dead reader 정리(invoice `inspected` 게이트 등) 후 pgEnum 값 재생성 + `outbound_task` 4테이블 DROP — expand-contract 별도 PR, 사이 deploy 필수.

> **✅ 작업 5 (dead 지뢰 일괄 소거, P0-5·P1-6·P3-5 코드부) 완료 — 2026-07-10:** 규칙(원장 단일화·예약 상태값)을 어기면서 라이브도 아닌(잠복 지뢰) dead 코드를 **순수 삭제로 청소**. 스키마·마이그레이션 무변경, 기능 추가 없음 (작업 4 와 동일 성격).
> - **P0-5**: `ReservationLifecycleService.processExpiredReservations` **메서드만** 삭제(독 코멘트 포함 31줄). `timeoutAt` 필터 주석처리로 confirmed 예약 전량 해제하던 복제본 — 정상 경로 `releaseExpiredReservations` + 10분 크론 존치. 서비스·모듈 배선 무변경(활성 호출 4곳).
> - **P1-6 + P3-5 코드부**: `FulfillmentOrderTransactionService.createFulfillmentOrder` + 전용 헬퍼 3종(`validateItems`/`getActiveMappingId`/`checkStockAvailability`) + 파일 내부 인터페이스 2종(`CreateFulfillmentOrderDto`/`FulfillmentOrderResult`) 삭제. `checkStockAvailability` 의 dead `status='active'` 예약 집계 버그(P1-6) 동반 제거. 유일 호출자가 GoneException 뒤 dead 여서 잠복. 부속 배선: 컨트롤러 `POST /fulfillment-orders` Gone 핸들러 + `consolidation.service.ts` 죽은 주입 제거. **존치**: `cancel`/`updatePriority`(admin-web 라이브)·`allocate`(라우트 live) — 서비스 파일·모듈 배선 유지.
> - **P3-4 선행조건 충족**: 이번 삭제로 FO `status='pending'`·reservation `status='active'` 의 **리터럴 producer 가 0**이 됨. pgEnum 값 재생성(destructive, expand-contract)은 작업 8 소유로 유지.
> - **P3-5 잔여**: `outbound_task`/`outbound_task_items/lines`(+`outbound_task_orders`) 4테이블 DROP 은 작업 8(expand-contract). 코드부는 본 작업으로 종결.
> - 브랜치 `feat/dead-path-sweep` (2 커밋: `[inventory]` P0-5 `713a73861` + `[fulfillment]` P1-6/P3-5 `09c00dcdb`) → **develop 스쿼시 머지 `cc8a6161f`** (2026-07-10).
> - 검증: `nest build core`(tsc/webpack) exit 0 · 삭제 심볼(`processExpiredReservations`·transaction 서비스 `createFulfillmentOrder`·`checkStockAvailability`·`getActiveMappingId`·`FulfillmentOrderResult`) 저장소 전역 참조 0 (`fulfillments.service` 의 private `createFulfillmentOrderFromItems` 는 별개 심볼, 존치 재확인) · arch 경계 회귀(`inventory-write-boundary.arch.spec.ts`) PASS · fulfillment 단위 spec 10 suite / 190 test PASS · 변경 4파일 eslint **신규** error 0 (기존 `require-await` 3건은 미변경 메서드에서 HEAD 부터 존재 — repo 전역 lint 는 기존부터 대량 error 상태로 본 작업과 무관). 스키마 무변경이라 dev DB 의존 ⏸ 항목 없음.

> **✅ 작업 6 (창고간 이동 무손실화, P0-1·W1) 완료 — 2026-07-10:** 손실 경로(Path A `movement/inter-warehouse`)를 하드 삭제해 무손실 경로 `inventory/transfers`(Path B)로 일원화. 호출자 전수 감사(FE·BE·타 앱)로 은퇴가 재배선보다 적합함을 확정 — Path A inter-warehouse 는 모노레포 호출자 0(라이브 지뢰), `complete` 는 완전 dead, Path B 는 admin-web 라이브.
> - **P0-1/W1**: `createInterWarehouseTransfer`(출발지만 차감 `toState:null` 소실) + 죽은 `completeInterWarehouseMovement` + 두 라우트(`POST /movement/inter-warehouse`·`/jobs/:id/complete`) + `InterWarehouseTransferDto` + 스펙 케이스 삭제. 동일창고 batch(`moveImmediately`, admin-web 라이브)·조회 라우트 존치. `movementJobs.warehouseId` 의 `to` 의미 사용처 소멸로 divergence 자동 해소.
> - **Path B 경량 하드닝**: `executeTransferJob` 에 job 헤더 `FOR UPDATE`(동시 실행 직렬화) + 실행된 라인 skip(재-PATCH 이중출고 차단). Path B 첫 테스트(단위: 재실행 가드·무손실 라우팅 / 통합 ⏸: 보존·재실행 불변).
> - 스키마·마이그레이션 무변경(작업 4 와 동일). 검증: `nest build core` exit 0 · 삭제 심볼 소스 참조 0 · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS · 단위 GREEN · 통합 ⏸(dev DB 복구 시).
> - 설계 `docs/superpowers/specs/2026-07-10-inter-warehouse-movement-retirement-design.md` · 계획 `docs/superpowers/plans/2026-07-10-inter-warehouse-movement-retirement.md`.
> - 브랜치 `feat/inter-warehouse-retirement` → **develop 스쿼시 머지 `536687448`** (2026-07-10).
> - **스프린트 P0 5건 전량 해소** — WS-B 잔여는 작업 7(P2-11)·작업 8(P3-4·P3-5 스키마 contract)뿐.

> **✅ 작업 7 (ship 광고 정리, P2-11) 완료 — 2026-07-10:** 은퇴한 `POST /fulfillments/:id/ship` 광고와 서버 미광고 데드 액션(assignShipment/split)의 admin-web UI 를 전량 제거. FE↔BE 계약 정합화. 스키마 무변경(작업 4·5·6 과 동일 성격).
> - **서버**: `computeAdminAvailableActions` 의 ship push 블록 삭제(`fulfillments.service.ts:1075-1077`). `ship()` 메서드(`:858`, direct-ship 내부 호출 라이브) 불가침. spec: `invoiced` 상태 ship 미광고 회귀 가드로 교체 + getOne 상세 단언에서 ship 제거.
> - **admin-web (수직 슬라이스 3커밋, 각 tsc 완결)**: ship(상세 헤더 버튼 + shipment-tab 섹션, 둘 다 404 호출) · assignShipment(영구 비활성 폼) · split(항상 차단 Alert 뜨는 데드 탭 — 탭째 제거) 각각 UI+훅+배럴+client+DTO 완결 제거. 0-importer 데드 부모 `detail/index.tsx` 동반 삭제. shipment-tab 은 정보표시·deliver 섹션 존치로 탭 유지.
> - **부수 발견**: ship 호출자가 상세 헤더에도 존재(2곳)했음. split 은 합배송/송장분할(W5) 착수 시 재스캐폴딩.
> - 브랜치 `feat/ship-advertisement-cleanup` (서버 1 + admin-web 슬라이스 3 + 문서) → **develop 스쿼시 머지 완료 `789f71239`** (2026-07-10, 타 develop 작업과 함께 배치 스쿼시). split-tab 등 삭제분·서버 광고 제거 develop 반영 확인.
> - 설계 `docs/superpowers/specs/2026-07-10-ship-advertisement-cleanup-design.md` · 계획 `docs/superpowers/plans/2026-07-10-ship-advertisement-cleanup.md`.
> - 검증: `nest build core` exit 0 · fulfillment 단위(60)/arch 경계 spec PASS · admin-web `type-check` 신규 에러 0(repo 기존 TS7006 debt 74건은 무관)·삭제 심볼 저장소 전역 참조 0 · 변경 파일 eslint error 0. 스키마 무변경이라 dev DB 의존 ⏸ 없음.
> - **WS-B 잔여**: 작업 8(P3-4·P3-5 스키마 contract, expand-contract)뿐.

> **✅ 작업 8a (죽은 스키마 자산 제거, P3-5 잔여·P3-4 orphan enum) 완료 — 2026-07-10:** 런타임 참조 0 인 `outbound_task` 4테이블 + orphan `event_type` enum 을 스키마에서 제거하고 DROP 마이그레이션 생성. 둘 다 참조 0 이라 expand-contract multi-phase 불요(단일 PR). 작업 8 을 **저위험(작업 8a)/고위험(작업 8b)** 로 분할한 앞쪽.
> - **제거**: `inventory.schema.ts` 의 pgTable 4(+sibling relations 5곳·전용 relations 4·집계·타입 export) + `mergeGroupsRelations`(outboundTasks 유일 relation) + orphan `eventTypeEnum`(+`enum-values.ts` 재수출). 실제 원장 grain 은 `transition_type` 소유라 `event_type` 은 병렬 vestigial.
> - **마이그레이션**: `drizzle-kit generate`(오프라인, DB 미연결) → `DROP TABLE ×4 CASCADE` + `DROP TYPE "public"."event_type"`. recast 0. 리뷰 게이트로 SQL 이 정확히 이 5개뿐임 확인. **적용 ⏸**(db:migrate=dev DB) — 작업1~3 미적용분과 일괄, DROP 은 데이터 무관 항상 성공이라 방치 리스크 낮음.
> - **존치**: `sku_location_movements`(작업4 재도입 예정).
> - **8b 마커 주석 동반**: 같은 머지가 column-attached dead enum 4종(transition `MARK_DEFECT`/`REWORK_GOOD`, reservation `pending`/`active`, shipment `in_transit`/`failed`, fulfillment `reserving`/`labeled`/`inspecting`/`inspected`/`pending`)에 "제거 예정: dev DB 복구 후(현황판 작업8b)" 주석을 붙였다(구조 무변경·generate no-op) — 실수 재사용 방지용 잠금표시. 값 자체 제거는 여전히 작업 8b(미착수).
> - **develop 스쿼시 머지 완료 `224d86778`** (2026-07-11, 커밋 제목 "refactor(core): 스키마 dead 필드 정리"). 스테일해진 `feat/dead-schema-contract` 브랜치 직머지가 아니라 현재 develop 위로 재스쿼시(8b 마커 포함). 후속 `3a3d66daf` 로 8a 스쿼시에 딸려든 일회성 진단 스크립트(`scripts/verify-live-migration-state.ts`) 제거.
> - 설계 `docs/superpowers/specs/2026-07-10-dead-schema-contract-design.md` · 계획 `docs/superpowers/plans/2026-07-10-dead-schema-contract.md`.
> - 검증: `nest build core` exit 0 · arch 경계 spec PASS · 삭제 심볼 저장소 전역 참조 0 · 생성 SQL 리뷰(DROP 5개만) · 변경 파일 신규 eslint error 0. 적용/통합 ⏸(dev DB) — 마이그레이션 `20260710171818_drop-outbound-task-and-event-type.sql` develop 반영·journal 등재(idx 33), 실제 `db:migrate` 적용은 dev DB 복구 시.
> - **✅ WS-B 완료 처리 (2026-07-11)**: P0-1·P0-5·P1-6·P2-11·P3-4·P3-5·W1 전량 develop 머지. column-attached enum **값의 물리적 제거**(구 작업 8b — pgEnum recast + `inspected` 게이트 등 dead reader 정리 + live-row-0)는 **의도적 비목표로 확정** — 8a 의 마커 주석이 dead 값 재사용을 차단해 실질 리스크 0, 물리 recast 는 destructive·저가치·dev DB 의존이라 스프린트에서 제외. 필요 시 optional 후속으로 별도 관리(WS-B 재개 아님).

**WS-C. 예약 보강** — P1-3, P1-4, P1-5, P2-1, P2-9
reserve 경로 잠금(ledger FOR UPDATE 또는 sku+warehouse advisory lock), adjustDown 예약 고려, FO 예약 타임아웃 정책 + 잔존 모니터링, 소진의 라인 단위 전환, reserved≤on_hand 대사 체크(잡).

**WS-D. 주문/환불 신뢰성** — P1-1, P1-2, P1-7, P1-8, P1-9, P1-10, P2-12, P2-13, P2-15, W10
컨슈머 poison 분류(영구 실패 = skip/DLQ + 운영 격리, Medusa 결제 훅 원칙과 동일), 반품 환불 상태기계 복구 가능화, SO 상태 결정.

**WS-E. 컨벤션/횡단** — P3-1(워커 파싱 제거와 한 세트), P3-2, P3-3, P3-6, P3-7, P3-8, P2-3, P2-5~P2-8, P2-10, W8, W9

권장 착수 순서: ~~**WS-A·WS-B 의 P0 5건 먼저**(재고 무결성)~~ **P0 5건 전량 완료(작업 1~6, 2026-07-10)** → WS-D 의 포이즌 2건(P1-1/P1-2) → WS-C → 나머지. **WS-A·WS-B 완료**(WS-B 의 물리 enum 값 제거 = 구 작업 8b 는 의도적 비목표). ~~P0-2 와 P0-3 은 반드시 한 PR 로~~(작업1 완료). P3-1 은 backlog 워커 제어흐름과 얽혀 있으므로 독립 PR + FO 생성 실패 시나리오 회귀 테스트 필수.
