# 물류 백엔드 정상화 스프린트 현황판 (2026-07)

> 출처: 2026-07-08 물류 백엔드 전수 감사 (fulfillment · inventory core/원장/예약 · inbound/movement/stocktaking/warehouse · sales-order 4개 영역 병렬 감사 + 치명 등급 직접 재검증).
> 이 문서가 본 스프린트의 **상황판(허브)** 이다. 항목 착수/완료 시 상태 컬럼을 갱신한다.
>
> 표기: **✅검증** = 감사 후 코드를 직접 열어 재확인한 항목. 나머지는 감사 보고 기준(착수 시 현장 재확인).
> 상태: ⬜ 미착수 / 🟨 진행 / 🟩 완료 / ⏸ 보류(사유 명기)
>
> **주의 (2026-07-18 표기):** 본 감사(07-08)는 **Outbound V2 재설계(07-14 설계기준선 이후 구현) 이전** 코드를 대상으로 한다. fulfillment/출고 측 file:line 참조 중 `invoice.service.ts`·`openBoxByScan`·`outbound-consumption.service.ts` 등은 V2 컷오버로 **삭제/대체**되었다 (현행: `shipment-planning/dispatch/reservation`, `waybill/`, `outbound-batch-orchestrator`). 해당 항목의 결함 서술은 당시 기준 기록으로 읽을 것. inventory 측(movement/stocktaking/예약 TOCTOU 등) 참조는 대체로 유효하다.

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
| P1-1 ✅검증 | 🟩 | `sales-order/consumers/order-events.consumer.ts:126, 212` | `OrderCancelled`/`OrderRefundCreated` 가 SO 미존재 시 throw → 재throw → 오프셋 미커밋 | out-of-order 전달(취소가 생성보다 먼저) 시 파티션이 포이즌 메시지로 정체. `OrderModified` 는 skip 처리(`:176`)와 불일치. **(착수 재확인 2026-07-12)** 사실 유지 — 라인 정확(:126/:212, Modified skip :175-178), 파일 07-08 이후 무변경. **핵심 발견**: auto-DLQ 인프라(`EventsExceptionFilter`, `@app/events`)가 기존재하고 notification·wallet·analytics·ugc 컨슈머 전부 `@UseFilters` 부착 — **core sales-order 컨슈머만 유일 미부착**(main.ts microservice 에 글로벌 필터도 없음)이라 재throw=무한 재시도가 성립. 해법 뼈대 = 필터 부착 + 영구/일시 실패 분류 |
| P1-2 ✅검증 | 🟩 | `order-events.consumer.ts:138-153` + `sales-orders.service.ts:454,470` | 출고완료 주문의 채널발 전체취소 → `cancel()` BadRequestException → 무한 재시도 | OUT_OF_STOCK/ADMIN 취소가 출고 후 도착하면 영구 소비 실패. **(착수 재확인 2026-07-12)** 사실 유지 — 컨슈머 :138-153 정확, `cancel()` 가드 3곳(:391-394 status / :454 hasShippedFulfillment / :470 shippedQty>0), 채널 이벤트는 partial lines 없이 호출되어 `isFullCancel=true`(:390)로 가드 직행. P1-1 과 같은 필터 미부착 전제 공유 — 한 세트 수정 |
| P1-3 ✅검증 | 🟩 | fulfillment 전역 (`fulfillments.service.ts:805`, `fulfillment-reservations.facade.ts:92`) | FO 예약 `timeoutAt=null` — 만료 크론(`unified-reservation.service.ts:296`) 대상에서 영구 제외 | ship/cancel 없이 방치된 FO 의 예약이 available 을 영구 잠금(과소판매). 타임아웃 정책 결정 + 잔존 예약 모니터링 필요. **(착수 재확인 2026-07-11)** 사실 유지 + 악화 — 살아있는 예약 생성 경로 **전부** null(`transferReservation` 은 원본 timeoutAt 승계도 유실), timeoutAt 설정 가능한 유일 경로(`POST /inventory/reservations` 직행)는 FE 호출 0 → **만료 크론(10분 주기)은 처리 대상이 생성되지 않는 no-op**. 모니터링도 부재: `monitorReservationStats` 빈 스텁, 예약 Prometheus 메트릭 정의만 있고 호출 0, 대사잡은 예약 미취급. 해법 방향: 일괄 timeout 부여는 정당한 출고대기 FO 예약을 풀어 초과판매 위험 — FO 예약 정상 종결 2경로(ship 소진 `reservation-lifecycle:77`/cancel 환원 `:34`)는 건재하므로 **FO 상태↔예약 대사(reconciliation)** 가 자연스러움. 참고: `unified-reservation.service` 는 `inventory/shared/services/` 로 이동(구 core/services) |
| P1-4 ✅검증 | 🟩 | `shared/services/unified-reservation.service.ts:56-87, 257-278` (구 core/services 에서 이동) | 가용 확인→예약 INSERT 사이 락 없음 (TOCTOU) | 동시 요청 둘 다 available=10 을 읽고 각각 10 예약 → `reserved(20) > on_hand(10)` = 초과판매. ADR-0011 의 "감수" 범위를 넘어 단일 창고 내에서도 발생. **(착수 재확인 2026-07-11)** 사실 유지 — FOR UPDATE/advisory lock 전무, READ COMMITTED 라 두 tx 무충돌 커밋. **G11 facade 잠금(FO→FOI 행)은 이 레이스를 못 막음**(다른 FO 간 동일 sku×warehouse 경합은 서로 다른 행을 잠금). 라이브 진입점 4곳 전부 노출: `tryReserveItems`(FO 생성 자동예약)·facade·retry worker(10초 크론, 상시 경합자)·`POST /inventory/reservations` 직행(FOI reservedQty 미갱신 + facade 불변식까지 우회하는 최악 진입점). DB 제약 부재 확정(`ck_ledgers_non_negative` 는 행 음수만, cross-table CHECK 불가). 잠금 지점은 `reserveStock` 내부(전 진입점 일괄 커버) sku×warehouse advisory xact lock 유력 — `tryReserveItems` 멀티 SKU 루프의 교차 데드락 방지로 skuId 정렬 필요. 부수 발견: retry worker 후보선별(view `available_qty`, transit_out 차감)과 실판정 `getAvailableStock`(미차감)의 **가용 정의 불일치**. dead 표면 3종(`adjustReservationOnQuantityChange`·`StockEventService.reserveStock`·unified `transferReservation`) 삭제 후보 |
| P1-5 ✅검증 | 🟩 | `core/services/inventory-command.service.ts:366-477` | `adjustDown` 이 confirmed 예약을 무시하고 로케이션 ON_HAND 만 검증 | `on_hand=10, reserved=10` 에서 adjustDown 5 성공 → `on_hand < reserved` 모순 → 이후 FIFO 소진 throw(일반 Error=500, tx 전체 롤백)로 해당 박스 영구 출고 불가. **(착수 재확인 2026-07-11)** 사실 유지 + **사정거리 확대**: 작업 1 이 실사 완료(`stocktaking.service.ts:438` `completeSession`→delta<0 시 adjustDown)를 배선 — 예약 걸린 SKU 의 **정상 실사 완료가 라이브 트리거**가 됨(감사 시점엔 수동조정 API·파손처리뿐). 핵심 난점은 grain 간극: adjustDown 검증=location 단위, 예약=sku×warehouse(locationId 컬럼 없음) → 가드는 "차감 후 창고 ON_HAND 합 ≥ 창고 confirmed 예약 합" **창고 합산 형태**여야. 집계 부품 `getTotalReservedQuantity(skuId, warehouseId, tx)` 기존재(모듈 순환 여부만 확인). 가드 추가 시 실사 UX 정책 선행 결정 필요(예약 SKU 실사 완료 차단/부분 적용/강제 release — completeSession 은 원자 적용이라 한 라인 throw = 전체 롤백). 잠금 없인 가드도 예약 생성과 TOCTOU — **P1-4 와 같은 잠금 설계를 공유, 한 세트 수정**. 이중화로 대사잡(`LedgerReconciliationService`)에 on_hand<reserved drift 감지 추가 권장 |
| P1-6 | 🟩 | `services/fulfillment-order-transaction.service.ts:344` | 예약을 dead 상태값 `status='active'` 로 조회 (실제 예약은 전부 `'confirmed'` 생성, `unified-reservation.service.ts:75`) | 이 경로 사용 시 예약 전량을 0 으로 보고 배치 가용 과다 계산 → 이미 묶인 재고를 할당 가능으로 오판. **(착수 재확인 2026-07-10)** 버그 코드 실재하나 유일 호출자 `createFulfillmentOrder`(`:51`)가 dead — 컨트롤러 `POST /fulfillment-orders` 는 GoneException(`fulfillment-order.controller.ts:19-21`), 그 외 호출처 0. 즉 P0-4/P2-2 와 같은 **잠복 지뢰**로 강등. 해소 = `createFulfillmentOrder` + private 헬퍼 3종(`checkStockAvailability` 포함) 삭제 — P3-5 코드 정리와 한 몸 |
| P1-7 ✅검증 | 🟩 | `sales_orders.status` 전이 3곳뿐 (`sales-orders.service.ts:357,418,555`) | `processing/shipped/delivered` 미전이 — ADR-0017 이 Core 소유로 명시한 상태들이 미구현 | `getStats()` 출고완료 통계 항상 0(`:831`), `cannotShip` 쿼리 confirmed 전제로 누락. **결정 필요**: FulfillmentShipped 소비로 전이 구현 vs 저장 상태 최소화 선언 + 통계 FO 기준 전환. **(착수 재확인 2026-07-12)** 사실 유지 — `processing/shipped/delivered` writer 리포 전역 0 재확정(파일 무변경, 라인 무드리프트), `FulfillmentShipped` 소비자는 channel-adapter 송장 채널동기화(`fulfillment-events.consumer.ts:41-46`) 1곳뿐으로 SO 무전이. `:328` `NON_CONFIRMABLE` 가드와 ADR-0017 :13 이 세 상태를 열거하나 전부 도달 불가 dead state **✅ 완료(작업 15, 2026-07-13)**: B안 확정 — 저장 전이 미구현, `getStats().outboundComplete` 를 FO shipped-evidence 도출로 전환(중첩), dead 값 마커 선언, ADR-0017(D2) 정정 |
| P1-8 | 🟩 | `store-return-exchange.service.ts:493-513, 748-756` | 반품 환불에서 `already_refunded` 를 완료로 매핑 안 함 (취소 경로 `store-sales-orders.service.ts:747-761` 는 매핑 — 불일치) | 환불은 성공했는데 반품이 `refund_pending` 고착, 재시도로 탈출 불가(수동 처리 필요). **(착수 재확인 2026-07-12)** 사실 유지 — 반품 초회 :493·재시도 :748 모두 `outcome.kind === 'success'` 만 완료 매핑. **라인 정정**: 취소 매핑 682-696→**747-761** (07-10 mypage 리팩토링 `07566b4aa` #505 로 이동 — 감사와 무관 변경, 결함 실질 무영향) |
| P1-9 | 🟩 | `store-return-exchange.service.ts:448-513` | 반품 완료 2단계(환불 호출)가 tx 밖 — 환불 성공 후 크래시 시 상태 불일치 | 돈은 나갔는데 `refund_pending` 유지. P1-8 때문에 자동 복구도 안 됨 — 복구 가능한 상태기계로. **(착수 재확인 2026-07-12)** 사실 유지 — Phase 1(inspected→refund_pending) tx 내 :448-473, Wallet 환불 호출 :486-490 과 완료 update :505-513 은 tx 밖(비트랜잭션). P1-8 과 한 세트 수정 |
| P1-10 | 🟩 | `store-return-exchange.service.ts:1308-1316` | 환불 비례식 분모는 `totalPrice ?? unitPrice*qty`, 분자는 `unitPrice*returnQty` — 기준 불일치 | 라인 할인으로 `totalPrice ≠ unitPrice*qty` 인 주문의 부분 반품 환불액 과대/과소 산정. **(착수 재확인 2026-07-12)** 사실 유지 — `calculateReturnRefund`(:1287-1320), 분모 :1308 / 분자 :1313-1316 / 배분 :1319 |
| P1-11 | ⬜ | `services/shipment.service.ts:36-123` | `openBoxByScan` 이 invoice 만 FOR UPDATE — FO 미잠금, FO당 open 박스 1개 강제 없음 (`issuedForFulfillmentOrderId` DB 부분 unique 부재) | 한 FO 에 non-voided 송장 2개(취소→재발행 경합) → 각각 스캔 → 둘 다 동일 잔량 박스 open → 각자 검수완료 → **on_hand 이중 차감**. **(착수 재확인 2026-07-12)** 사실 유지 — invoice 만 `.for('update')`(:47), FO 조회는 일반 SELECT(:56-64), `idxOpenedForFo`(schema :1379) 는 비-unique(주석 자인 "FO↔상자 M:N 허용, B 에서 shipments unique drop"). **소속 확정(2026-07-12)**: WS-D 미편입 — **별도 설계 항목**. 해법(partial unique/FO 잠금)이 W5 M:N 계약과 충돌해 정합 설계 선행 + 스키마 변경·dev DB 게이트. 무탐지 이중차감(원장대사·좀비대사 모두 못 잡음)이라 우선순위 산정 시 기대 피해 최고 유의 — §5 WS-D 범위 결정 확정 블록 참조 |

### P2 — 중간 (정합성/견고성)

| ID | 상태 | 위치 | 결함 |
|---|---|---|---|
| P2-1 | ⏸ | `outbound-consumption.service.ts:70-73, 136` | `consumeShipment` 가 FO 1:1 가정 — `openedForFo=null` 이면 throw, 예약 소진이 박스 라인이 아닌 **FO 전량** 단위. 합배송/송장분할(M:N) 흐름을 열기 전에 라인 단위 소진으로 전환 필요 (스키마는 이미 M:N 개방). **(착수 재확인 2026-07-11)** 사실 유지(라인 번호까지 정확)·부분 정정: 원장 SHIP 차감(:95-110, 라인별 멱등키)과 FOI shippedQty 누적(:112-131)은 **이미 라인 단위** — FO 전량인 곳은 ① 예약 닫기(:136) ② FO 'shipped' 무조건 전이(:143-146) ③ FulfillmentShipped 이벤트(FO 단수 페이로드) 3곳뿐. 예약은 생성 시점부터 `fulfillmentOrderItemId` 를 채움 → FOI 단위 consume API 신설로 전환 가능(스키마 무변경). 간극: **부분 수량 소진(예약 행 분할) API 부재**(송장분할에 필수), 'consumed' 상태 부재(released+reason 문자열로만 구분), FO 전이 조건부화("모든 FOI shipped") 필요. W5 가 RFC Non-Goal 이라 스프린트 내 착수 범위 결정 필요. **⏸ 보류 확정(2026-07-12): 유일 정당화가 W5(합배송·송장분할) — W5 실착수 전까지 의도적 비목표. 1:1 세계에선 현행 3곳(예약닫기·FO전이·이벤트)이 정상이라 라이브 버그 아님(선제 인프라=YAGNI). §5 WS-C 작업 12 종결 블록 참조.** |
| P2-2 | 🟩 | `core/services/sku-location-movement.service.ts` (삭제됨) | `recordMovement` 가 원장을 건드리지 않는 "이동"을 completed 로 기록 → 로케이션 grain 원장과 물리 위치 불일치 → FIFO 소진이 틀린 로케이션 선택 가능. **단 컨트롤러 라우트 전부 주석처리 — 현재 호출 불가(잠복). 완료(작업4): 서비스·컨트롤러·DTO 삭제.** `sku_location_movements` **테이블은 존치**(향후 재고이동 기능 재도입 예정 — ADR-0005 destructive DROP 회피). 재도입 시 `moveInternal` 위임으로 원장 정합 확보 |
| P2-3 | ⬜ | `inbound/services/inbound.service.ts:782-787` | 초과 수령 무제한 허용 (expectedQty 상한/경고 없음) |
| P2-4 | 🟩 | `inbound.service.ts:107,191,270,760`, `movement.service.ts:92` | 입고/이동 경로 전부 `idempotencyKey` 미전달 — 재전송 시 중복 입고(재고 2배). `stock_events.idempotencyKey` 방어막 무력화. **(+`returnInbound:915`·`createInterWarehouseTransfer:220` 동일). 진짜 재-POST 방어엔 클라이언트 요청 키 필요 — inbound line id 는 이벤트 후 생성이라 못 씀** (착수 재확인 2026-07-08) **완료(작업3): 전용 idempotency 테이블+래퍼로 9개 경로 요청 멱등화, 이벤트 파생 키 병행, admin-web 키 수명주기 래퍼** |
| P2-5 | 🟩 | `stocktaking.service.ts:139-149`, `schema:1716` | 실사 라인 무조건 INSERT — (session×sku×location) unique 없음, 동시 세션 로케이션 배타 제어 없음 → 재스캔/동시 실사 시 이중 조정. **완료(작업1): `(session,sku,location)` unique(NULLS NOT DISTINCT) + `scanLocation` onConflictDoNothing** |
| P2-6 | 🟩 | `stocktaking` 전반 | 실사가 expected 를 스캔 시점 ON_HAND 스냅샷으로만 계산 — 카운팅 중 예약/이동 미고려 (variance-delta 방식의 이중 계산 위험). **완료(작업1): 완료 시 라이브 delta(counted−현재ON_HAND)로 이중계산 위험 해소; 카운팅 중 표시 expected 스냅샷은 조정 정확성에 무영향** |
| P2-7 | ⬜ | `core/services/location.service.ts:534-551` | 로케이션 삭제에 재고 가드 없음 → 도메인 에러 대신 FK 위반 500. qty=0 잔여 row 케이스도 정리 필요 |
| P2-8 | ⬜ | `warehouse/services/warehouse.manager.ts:70-78` | 창고 삭제 in-use 검사와 삭제가 다른 트랜잭션 (TOCTOU) — 최악 500 |
| P2-9 | 🟩 | `fifo-allocate.ts:27-34` vs `allocation-strategy.service.ts:335-341` | FIFO 이중 구현 정렬 기준 불일치 (fifoRank+updatedAt vs updatedAt만) — 계획 로케이션 ≠ 실소진 로케이션. **✅ 완료(작업 9, 2026-07-11)**: 절제 확정 — `AllocationStrategyService` + `allocate`/`available` 두 라우트 + `stock-event.service.ts:22` dead 주입 전량 삭제(정렬 통일 아님). 브랜치 `feat/dead-reservation-surface-sweep` → develop 스쿼시 머지 `d3412b882`. **(착수 재확인 2026-07-11) 실위험 강등**: `AllocationStrategyService` 는 내부 서비스 호출자 0·admin-web 호출 0 — `POST /inventory/reservations/allocate` 로만 노출된 사실상 dead(감사 시점부터 dead 였던 것으로 보임 — 작업 5 삭제분은 이 서비스를 호출한 적 없음). stateless(persist 없음)라 원장 오염 불가, 조회 표시 불일치만 가능. 해소 = 정렬 통일보다 **절제**(P0-4·P1-6 판례): `allocateByFIFO/LocationPriority/MultiWarehouse/ClosestExpiry` 헬퍼 4종 호출자 0, `stock-event.service.ts:22` dead 주입 포함. 존치 결정 시엔 `FifoLocationStrategy` 위임 재구현(비례배분 휴리스틱·`db.query.*`·서비스 내 ConflictException 규칙 위반 동반 해소). 주의: `fifoAllocate` 가 raw ON_HAND 만 보는 건 **의도된 계약**(예약 동시 소진 경로라 available 쓰면 이중차감) — 통일 시 불가침 |
| P2-10 | ⬜ | `outbound-consumption.service.ts:198` | active invoice 부재 시 `carrier:'CJ'` 하드코딩 + trackingNumber `''` 발행 — 불변식 위반을 잘못된 데이터로 다운스트림 전파 |
| P2-11 | 🟩 | `modules/fulfillment/services/fulfillments.service.ts:1075-1077` | `computeAdminAvailableActions` 가 은퇴한 `POST /fulfillments/:id/ship` 을 광고 → UI 렌더 시 404 (RFC Cluster A 후속 #1). **(착수 재확인 2026-07-10) 라이브 404 확정** — admin-web `shipment-tab.tsx:234` 가 버튼 실렌더, 클릭 시 부재 라우트 호출(`fulfillments.client.ts:86`). ship 외 광고 액션 8종 라우트는 전부 실존. 수정 시 **admin-web 동시 수정 필수**(canShip 블록·`useShipFulfillment`·client `ship()`). 부수 발견: 서버가 광고하지 않는 `assignShipment`(`shipment-tab.tsx:48`)/`split`(`split-tab.tsx:62`) 데드 버튼 2건 — 반대 방향 계약 불일치(404 아닌 영구 비활성), 같은 PR 에서 처리 검토. **✅ 작업 7 완료(2026-07-10)**: 서버 광고 블록 삭제 + admin-web ship(헤더+탭)·assignShipment·split(탭째) 3건 전량 제거(수직 슬라이스 3커밋). 서버 `ship()` 메서드(direct-ship 내부 호출) 존치. 부수 발견: ship 호출자가 상세 헤더에도 있었음(2곳), 0-importer 데드 부모 `detail/index.tsx` 동반 삭제. |
| P2-12 | 🟩 | `store-sales-orders.service.ts:691`, `store-return-exchange.service.ts:730` | Wallet Idempotency-Key 가 호출마다 randomUUID — 동시 실행 시 이중 환불 방어가 전적으로 Wallet 측 refundable 검증에 위임. **(착수 재확인 2026-07-12)** 라인 정정 :624→**:691**(07-10 #505 이동) + 서술 정정: "호출마다 UUID"는 취소(:691)·반품 **재시도**(:730)만 — **반품 초회(:485)는 결정적 키** `return:{id}:refund`. 결함 실질(취소·재시도 경로의 이중 환불 방어 위임)은 유지. **✅ 반품 경로 완료(작업 14, 2026-07-12)**: 재시도 randomUUID → intent-first attempt 행의 시도별 결정적 key(`return:{id}:refund:{N}`)로 통일, 동시 재시도는 FOR UPDATE + Wallet 409 로 직렬화. **취소 경로(:691) 결정적 key 는 명시적 후속(⬜)** — 부분취소 amountOverride 로 취소건별 keying 필요, 별도. 취소 경로엔 `in_flight` case 만 추가(net 보존) |
| P2-13 | ⬜ | `partial-cancellation-refund-calculator.ts:124-146` | 부분취소 환불 추정치가 이전 취소 기환불액 미차감 — 항상 manual_pending 이라 자동 과다환불은 없으나 운영자 표시 합계가 총액 초과 가능. **(착수 재확인 2026-07-12)** 사실 유지(:124-146 정확, 파일 무변경) — 항상 `manualRequired: true` 고정 + 호출부(:135-147 부근) manual_pending 기록만이라 advisory only 확인(코드 주석 :14·:168 이 미구현 자인). WS-D 내 최저 순위 |
| P2-14 | 🟩 | events↔ledgers 대사 부재 | `stock_events`(진실)↔`stock_ledgers`(파생) 를 재검증/복구하는 reconcile 잡·엔드포인트 없음. `calculateQuantityAsOf`(`stock-event.store.ts:204`) primitive 만 존재 — P0 우회 버그류 탐지 장치로 신설. **완료(작업2 — develop 스쿼시 머지 `ae5f979c0`)**: 탐지 전용 대사 잡 신설, §5 WS-A 작업 2 블록 참조 |
| P2-15 | ⬜ | `order-events.consumer.ts:104` | library grant 가 SO 생성과 동일 tx — grant 실패가 유료 주문 수용을 롤백 (재전달 자가치유 의존). 분리 검토. **(착수 재확인 2026-07-12)** 사실 유지 — `handleOrderCreated` 단일 `dbService.run`(:77) 안에서 SO 생성(:79-85)·backlog(:103)·grant(:104) 동일 tx, `isPaymentConfirmed` 가드(:101-105) 하 실행 |

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
| W10 | 🟩 | 운영 확인 필요: `confirm`(출고확정) 이 FO 생성 트리거가 아님 | FO 생성은 OrderCreated 시점 backlog — confirm 은 스냅샷 생성뿐(`sales-orders.service.ts:306-362`). ADR-0010 서술과 어긋남 — 의도 확인 후 문서 또는 코드 정정. **(착수 재확인 2026-07-12)** 사실 유지 — `confirm()`(:306-361)은 row lock+상태검사 → 매핑 스냅샷(:343-348) → `confirmed` 전이(:357)뿐, FO/backlog 무관. backlog enqueue 는 `order-events.consumer.ts:103`(OrderCreated). P1-7 결정(작업 15)과 함께 D3 정정 **✅ 작업 15(2026-07-13)** |
| W11 | ⬜ | 외화 PO 크로스보더 인바운드(source 플랜 → 창고간 이송 → destination 플랜 활성화) 미완성 | 삭제한 `completeInterWarehouseMovement` 가 닫으려던 루프. Path A(소실)·Path B(즉시 atomic) 어느 쪽도 지속 IN_TRANSFER(중국→한국 다일 운송)를 모델링 안 함. 부수: `purchase-order.service.ts:313` 이 만드는 `planType='destination'`(expectedDate=null) 플랜이 활성화 경로 없이 pending 잔존 → `stock_summary` 뷰 `transit_out`/`inbound_pending` 에 영구 반영(기존 조건, 작업 6 이 악화 아님). 착수 시 2단계 상태기계·receive API·도착 로케이션 규칙 설계 필요 |

---

## 4. 문서 정비

| ID | 상태 | 항목 |
|---|---|---|
| D1 | 🟩 | CONTEXT.md 의 낡은 "설계 결정, 미구현" 주석 갱신 (출고주문 스냅샷 / 예약 소진·환원 / 상자·운송장) — 2026-07-08 반영 |
| D2 | 🟩 | ADR-0017 의 SO 상태 소유 서술 — P1-7 결정에 맞춰 정정 **✅ 작업 15** |
| D3 | 🟩 | ADR-0010 의 confirm 서술 — W10 확인 후 정정 **✅ 작업 15** |
| D4 | ⬜ | CLAUDE.md 의 "`stock_summary` — projection with optimistic locking (`version` field)" 서술 정정 — 현재 `stock_summary` 는 VIEW(version 필드·projection 테이블 없음, G3 참조). WS-C 착수 재확인(2026-07-11)에서 발견 |

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

> **착수 재확인(2026-07-11) — 4개 영역 병렬 검증 완료 (develop @ 0ec29f19e). 요지:**
> - **사실 유지**: P1-4(TOCTOU — 잠금 전무, G11 facade 잠금으로는 못 막음) · P1-3(전 생성 경로 timeoutAt=null) · P1-5(adjustDown 예약 무시) · P2-1(FO 1:1, 라인 번호까지 정확).
> - **정정**: 예약 서비스 2종(`unified-reservation`·`reservation-lifecycle`)은 `inventory/core/` → `inventory/shared/services/` 이동 · P2-1 은 원장 차감/FOI 누적이 이미 라인 단위(FO 전량은 예약닫기·상태전이·이벤트 3곳만) · **P2-9 실위험 강등**(allocation-strategy 는 호출자 없는 사실상 dead — 절제가 답, 정렬 통일 아님).
> - **악화/확대 (감사 이후 변동)**: P1-5 — 작업 1 의 실사→`adjustDown` 배선(`stocktaking.service.ts:438`)으로 예약 걸린 SKU 의 **정상 실사 완료가 라이브 트리거화**(P0 수리가 P1 트리거 표면을 넓힌 사례). P1-3 — timeoutAt 생산자가 시스템에 없어(유일 설정 경로인 HTTP 직행도 FE 미사용) **만료 크론 전체가 no-op**.
> - **의존성/공통 발견**: P1-4·P1-5 는 같은 sku×warehouse 잠금 설계를 공유 — **한 세트 수정**. P2-1 은 W5(합배송/송장분할) 착수 결정에 종속. 가용 정의 불일치(view `available_qty` 는 transit_out 차감, 실판정 `getAvailableStock` 은 미차감 — retry worker 가 헛재시도 루프 가능). dead 예약 표면 3종(`adjustReservationOnQuantityChange`·`StockEventService.reserveStock`·unified `transferReservation`) + `POST /inventory/reservations` 직행 컨트롤러(불변식 우회) 정리 대상. reservation enum `pending`/`active` 는 dead 값(작업 5 로 유일 소비자 소멸 — 8b 마커 대상과 동일 계열). CLAUDE.md 의 "stock_summary — projection with optimistic locking(version)" 서술 낡음(현재 VIEW, version 없음) → D4.
>
> **권장 작업 분할(순서대로):**
> 1. **작업 9 — dead 예약/할당 표면 소거(코드만)**: P2-9 절제(`AllocationStrategyService` 처분 결정 — 삭제 시 라우트·dead 주입 포함) + dead 예약 메서드 3종 삭제 + `POST /inventory/reservations` 직행 컨트롤러 처분(facade 강제 또는 은퇴). 순수 삭제 위주 저위험 1 PR — 작업 10 이 방어할 진입점 표면을 먼저 줄인다(작업 4·5 판례).
> 2. **작업 10 — P1-4+P1-5 잠금·가드(한 세트)**: `reserveStock` 내부 sku×warehouse advisory xact lock(전 진입점 일괄 커버, skuId 정렬로 교차 데드락 방지) + `adjustDown` 창고 합산 예약 가드 + 실사 완료 시 예약 SKU 정책 결정 + 대사잡 on_hand<reserved drift 감지(2차 방어). 가용 정의 불일치(transit_out) 해소 여부 포함 설계.
> 3. **작업 11 — P1-3 좀비 예약 해소**: 일괄 timeout 부여 대신 **FO 상태↔예약 대사 잡**(terminal FO 의 잔존 confirmed 해제, FOI reservedQty 동기화 + sellable 재계산 의무) + 잔존 예약 모니터링(`monitorReservationStats` 빈 스텁·dead 메트릭 재활용). timeout 기계(dto 필드·크론·expire-stale·admin 버튼) 존치/절제 결정 동반.
> 4. **작업 12 — P2-1 라인 단위 소진 전환**: FOI 단위 consume API 신설 + FO 'shipped' 전이 조건부화 + 이벤트 FO 별 분리. 부분 수량 소진 API·'consumed' 상태는 W5 실착수 시점으로 미룰 수 있음 — W5 가 Non-Goal 유지면 **보류 후보**(스프린트 범위 결정 필요).

> **✅ 작업 9 (dead 예약/할당 표면 소거, P2-9) 완료 — 2026-07-11:** 죽었거나 예약 코어를 우회하는 예약/할당 표면을 **순수 삭제**로 걷어내 작업 10 이 방어할 진입점을 선축소. 스키마·마이그레이션 무변경, 기능 추가 없음 (작업 4·5·6 과 동일 성격).
> - **직행 예약 은퇴 (결정: 완전 은퇴)**: `POST /inventory/reservations`(reserveStock 핸들러) + 컨트롤러 DTO `ReserveStockDto` 클래스 + `ReservationTargetType` enum 삭제. "facade 강제"는 facade 가 FO→FOI 중심이라 FO 없는 수동/MOVEMENT_TASK 예약에 부적합해 기각. FE 호출 0·MOVEMENT_TASK dead 라 은퇴가 답 — 수동 예약 능력 필요 시 규칙 준수로 신규 작성. **불가침**: 코어 `UnifiedReservationService.reserveStock` + 서비스 인터페이스 `ReserveStockDto`(FO 자동경로가 계속 사용).
> - **P2-9 절제**: `AllocationStrategyService`(489줄) + `POST allocate`·`GET available/:skuId` 두 라우트 + dead DTO(`AllocateStockDto`·`AllocationResultDto`·`AvailableStockResponseDto` + nested) + `stock-event.service.ts:22` dead 주입 삭제. **문서 정정**: P2-9 "allocate 로만 노출"은 부정확 — `available/:skuId` 도 같은 서비스 의존이라 동반 은퇴(둘 다 FE 0). `fifo-allocate`/`location-resolution.strategy` 주석은 삭제 클래스명만 빼고 raw-ON_HAND 이중차감 계약 근거 보존.
> - **dead 예약 메서드 소거**: `StockEventService.reserveStock`(deprecated 래퍼)·`UnifiedReservationService.transferReservation`·`ReservationLifecycleService.adjustReservationOnQuantityChange` **+ 문서 미기재였던 MOVEMENT_TASK 라이프사이클 쌍** `handleMovementTaskStatusChange`·`releaseMovementTaskReservations`(총 5종, 전부 호출자 0). 동명이인 라이브(`facade.transferReservation`·`unified.reserveStock`)는 불가침.
> - **MOVEMENT_TASK 타입 narrowing (TS·주석만)**: `'FULFILLMENT_ORDER' | 'MOVEMENT_TASK'` → `'FULFILLMENT_ORDER'`(unified `ReserveStockDto` 인터페이스·`ReservationDto`·by-target swagger enum/description). MOVEMENT_TASK 예약은 **생산자·reader 전부 dead** 확정 → 완전 vestigial. `stock_reservations.target_type` 는 varchar 유지(스키마 무변경, dev DB 의존 없음).
> - **경계(비목표)**: `POST expire-stale`(FE 라이브)·`timeoutAt` 컬럼·만료 크론·`reserveStock` 잠금은 손대지 않음 — 작업 10(잠금·가드)/작업 11(timeout 대사) 소유.
> - 브랜치 `feat/dead-reservation-surface-sweep` (코드 4커밋: dead 메서드 `cffb68686` / AllocationStrategyService `21b788003` / 직행+narrowing `23955df79` / swagger 정합 `d2ce1d9cc`) → **develop 스쿼시 머지 `d3412b882`** (2026-07-12).
> - 설계 `docs/superpowers/specs/2026-07-11-dead-reservation-surface-sweep-design.md` · 계획 `docs/superpowers/plans/2026-07-11-dead-reservation-surface-sweep.md`.
> - 검증: `nest build core` exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · fulfillment 단위 spec 190 PASS · 삭제 심볼 저장소 전역 참조 0 · `MOVEMENT_TASK`/`ReservationTargetType` core 참조 0 · admin-web `tsc --noEmit` 신규 0 · 변경 파일 신규 eslint 0. SDD(태스크별 리뷰 + 최종 whole-branch 리뷰 opus "Ready to merge YES", Critical/Important 0). 스키마 무변경이라 dev DB 의존 ⏸ 없음.
> - **잔여 후속(비차단)**: (a) `recalculateSellableQuantityForReservationSku` 가 유일 호출자(삭제된 `adjustReservationOnQuantityChange`) 소멸로 고아화 — plan 이 명시 존치(제거 시 `ProductSellableQuantityService` 주입 연쇄, 작업 10 재사용 가능성) → defer. (b) admin-web 예약 UI 의 `MOVEMENT_TASK` 필터 옵션 3곳(로컬 타입이라 컴파일 무영향, by-target 이 string 이라 안 깨지고 빈 결과) → FE 후속 티켓.

> **✅ 작업 10 (예약 잠금 + ON_HAND 감소 가드, P1-4·P1-5) 완료 — 2026-07-12:** `available`(미예약 ON_HAND)을 소비하는 전 경로를 `(sku,warehouse)` 로 직렬화하고, ON_HAND 를 예약 해제 없이 줄이는 경로에 창고합산 예약 가드를 세움. 스키마·마이그레이션 무변경(작업 4·5·6·7 판례).
> - **P1-4(잠금)**: `pg_advisory_xact_lock(hashtext('sku:wh'))` 공유 헬퍼(`inventory/shared/locks/`, 단일 + 정렬-내장 배치) → `reserveStock`·`adjustDown`·`transferShip` 단일 락 + 멀티키 tx(`tryReserveItems`·`completeSession`) 배치 락(정렬로 교차 데드락 방지). retry 워커는 예약마다 별 tx(facade 자체 `db.run`)라 배치 불요.
> - **P1-5(가드)**: `adjustDown`·`transferShip` 에 "차감 후 창고 ON_HAND 합 ≥ 창고 confirmed 예약 합" 가드(위반=`ConflictException`). transfer 는 출발지 관점 출고 → available 만 이동(예약 이관 부활 없음). 실사(`completeSession`)·파손(`processDamage`)은 **물리적 사실**이라 `bypassReservationGuard`(THROW 만 skip, 락은 유지) + 완료 시 on_hand<reserved inline warn.
> - **2차 방어**: `LedgerReconciliationService.reconcileReservations`(raw-sum 대사, 뷰 미사용) + 게이지 `wms_reserved_over_onhand_grains` + `GET /inventory/ledger-reconciliation/reservations` + 야간 크론 편승. 실사발 on_hand<reserved 의 **예약 자동해제·조회 UI 는 보류 확정**(범위 결정 2026-07-12 — 게이지 실측 관찰 후 정책 결정, §5 WS-D 블록. 탐지까지만 유지).
> - **가용 정의(P2-9 파생)**: reserve-time 은 transit_out 무시 유지(가드가 백스톱, "firm 예약 > 미실행 이송 plan"). 통일(이송=예약 모델링)은 W11 이연. drift 는 raw 합 비교(뷰 `availableQty` 는 transit_out 반영이라 거짓경보 → 금지).
> - **최종리뷰(opus) 반영**: (I-1) `getAvailableStock`·`getWarehouseReservationBalance` 를 **단일 statement 원자 읽기**로 — 2-statement 읽기면 락 미획득 SHIP 소진(`outbound-consumption:98` → 라이브 `ship()`)이 두 읽기 사이 커밋되며 torn read → 초과예약 창이 남음(P1-4 완결). (I-2 ~~알려진 잔여~~ **✅ 작업 10b 로 해소 `3c5b9d761`**) `reverseEvent`(당일 입고취소 `inbound.service:1010`)가 락·가드 우회로 ON_HAND 감소 — 능동 가드 안 함(lower-level), 대사잡 게이지가 탐지 → 배선 완료(범위 결정 2026-07-12 → 실착수, §5 작업 10b 블록).
> - 설계 `docs/superpowers/specs/2026-07-11-reservation-lock-and-adjust-guard-design.md` · 계획 `docs/superpowers/plans/2026-07-11-reservation-lock-and-adjust-guard.md`.
> - 브랜치 `feat/reservation-lock-and-adjust-guard` (SDD 7태스크 + 스펙 fixture fix + 최종리뷰 fix wave) → **develop 스쿼시 머지 `69da56fff`** (2026-07-12). 검증: `nest build core` exit 0 · arch 경계 spec PASS · 유닛 68 pass/9 skip/0 fail · 변경파일 신규 eslint 0 · 최종 whole-branch 리뷰(opus) "With fixes"→반영 후 clean. 통합 spec 은 dev DB 부재로 ⏸(SKIP) — **`isolatedModules` 라 build/jest 가 spec 을 타입체크 안 함**을 발견, 별도 `tsc`(isolatedModules off)로 deferred 통합 spec 3종 타입체크 GREEN(dev DB 복구 시 런타임 실행).
> - **WS-C 잔여**: 작업 12(P2-1 라인 단위 소진).

> **✅ 작업 11 (좀비 예약 대사, P1-3) 완료 — 2026-07-12:** timeoutAt 을 채우는 생산자가 없어 만료 크론이 no-op 이던 문제를, 예약 수명 기준을 **FO 상태**로 옮겨 해소. terminal FO(`shipped`/`completed`/`canceled`)의 잔존 `confirmed` 예약을 (1) 발생원 봉합 + (2) auto-heal 대사 잡으로 해제. 스키마·마이그레이션 무변경(작업 4·5·6·7·9·10 판례).
> - **핵심 안전성**: heal = **release 만**(`status='released'`, `releaseReservation` 경유 sellable 재계산), **SHIP 원장 append·on_hand 무터치** → 이미 SHIP 된 FO 의 잔존 예약을 release 해도 이중차감 위험 0. release 는 `available` 증가라 작업 10 advisory 락 불요(락 면제 경로와 일관, 최종리뷰 동시성 검증).
> - **발생원 봉합**: `ship()` drop_ship(`fulfillments.service.ts:905`)·`markDelivered()`(`:957`) — 예약 해제 없이 terminal 로 가던 두 경로에 동일 tx 방어 sweep(`reservationLifecycle.releaseLeftoverReservations`, 잔존 시 warn). 정상 소진 경로는 0건 no-op. **부수 발견**: admin 수동 `/reserve`(`FulfillmentReservationsFacade.reserve`)에 drop_ship 가드 부재 + `computeAdminAvailableActions` 가 non-terminal drop_ship 에 reserve 노출 → sweep warn 경로 operator 오용으로 도달가능 → **작업 11b 로 확정**(범위 결정 2026-07-12, §5 WS-D 블록 — 최우선 착수).
> - **대사 잡**: 신규 `FulfillmentReservationReconciliationService`(`inventory/core/services/`, LedgerReconciliationService 패턴 미러) — 단일 raw-SQL 스냅샷 탐지(`stock_reservations` confirmed ⋈ `fulfillment_orders` terminal) → FO 단위 독립 tx heal(멱등·per-FO 실패 격리) + 야간 크론(`@Cron('5 3 * * *')` 03:05 KST, 작업 2 원장대사 뒤 staggered) + 게이지 `wms_zombie_reservations_grains`(pre-heal set)·카운터 `wms_zombie_reservations_healed_total` + 온디맨드 `POST /inventory/reservations/reconcile`.
> - **timeout 기계 절제**: inert 만료 경로 제거 — `UnifiedReservationService.releaseExpiredReservations` + `ReservationCronService`(클래스째, 빈 스텁 크론 포함) + `POST expire-stale`. `timeoutAt` 컬럼·응답 DTO 필드는 **존치**(expand-contract). 고아 래퍼 `recalculateSellableQuantityForReservationSku`(작업 9 잔여, 호출자 0) 동반 삭제.
> - **admin-web 재배선**: placebo 였던 "만료된 예약 일괄 해제"(expire-stale, timeoutAt NULL 이라 항상 0건) → "예약 정합성 정리"(`POST /reconcile`). 항상 "-" 이던 "만료 시각" 컬럼 제거.
> - 설계 `docs/superpowers/specs/2026-07-12-zombie-reservation-reconciliation-design.md` · 계획 `docs/superpowers/plans/2026-07-12-zombie-reservation-reconciliation.md`.
> - 브랜치 `feat/zombie-reservation-reconciliation` (SDD 6태스크 + 최종 whole-branch 리뷰 fix wave, 10커밋) → **develop 스쿼시 머지 `c16670071`** (2026-07-12).
> - 검증: `nest build core` exit 0 · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS · 유닛 5 suites/70 tests GREEN · 삭제 심볼 전역 참조 0 · admin-web `type-check` 신규 0 · 변경파일 신규 eslint 0. 최종 opus 리뷰 "With fixes"→반영(deferred spec `outbound-consumption.integration.spec.ts:77` 3-arg→2-arg 생성자 정정, temp-tsconfig RED→GREEN 검증). 통합 spec 없음(신규 전부 유닛). 스키마 무변경이라 dev DB 의존 ⏸ 없음.

> **⏸ 작업 12 (P2-1 라인 단위 소진 전환) 보류 확정 → WS-C 종결 처리 — 2026-07-12:** 라인 단위 소진 전환의 **유일한 정당화가 W5(합배송·송장분할, RFC Non-Goal)** 라, W5 실착수 전까지 **의도적 비목표**로 확정(WS-B 구 8b 물리 enum 제거와 동형 처분). 코드 변경 없음 — 이 결정을 상황판에 기록만.
> - **1:1 세계에선 현행이 정상**: 원장 SHIP 차감(`outbound-consumption.service.ts:98-110`)·FOI shippedQty 누적/전이(`:112-131`, `newShipped>=qty` 이미 조건부)는 **이미 라인 단위**. "FO 전량" 3곳(예약 닫기 `:136`·FO 무조건 shipped 전이 `:143-146`·FulfillmentShipped 단수 페이로드 `:149`)은 상자=FO 인 1:1 에서 전부 옳다(코드 주석 `:22-24`·`:126` 자인). 즉 라이브 버그가 아닌 **W5 대비 선제 인프라** — 지금 만들면 YAGNI.
> - **인접 위험과 비중복**: "한 FO 에 상자 2개" 이중 on_hand 차감은 **P1-11**(invoice 재발행 경합, WS-D 계열) 소유 — 작업 12 의 FO 전이 조건부화로는 그 이중차감을 못 막음(상태만 변경). 방금 develop 머지된 **작업 11(좀비 예약 대사)** 은 "FO ship=terminal" 무조건 전이를 전제로 heal — 작업 12 가 전이를 조건부화하면 작업 11 가정과 리플. 두 근거 모두 **지금 손대지 않는 편이 안전**.
> - **W5 착수 시 한 세트 설계(불가침 계약)**: 현행 1:1 은 DB unique 로 강제되지 않는 **관례**(P1-11 — FO당 open 박스 1개 강제 부재). W5 착수 시 ① FOI 단위 consume API ② 부분 수량 소진(예약 행 분할) ③ `consumed` 상태 ④ FO 전이 "모든 FOI shipped" 조건부화 ⑤ 이벤트 FO별 분리를 한 세트로 설계하고, **작업 11 terminal-FO heal 가정과의 정합**을 그 설계의 필수 항목으로 둔다.
> - **✅ WS-C 완료 처리 (2026-07-12)**: P1-3·P1-4·P1-5·P2-9 전량 develop 머지(작업 9·10·11). P2-1(작업 12)은 W5 게이트 보류로 종결. WS-C 재개 아님 — W5 착수는 별도 워크스트림 결정.

**WS-D. 주문/환불 신뢰성** — P1-1, P1-2, P1-7, P1-8, P1-9, P1-10, P2-12, P2-13, P2-15, W10
컨슈머 poison 분류(영구 실패 = skip/DLQ + 운영 격리, Medusa 결제 훅 원칙과 동일), 반품 환불 상태기계 복구 가능화, SO 상태 결정.

> **착수 재확인(2026-07-12) — 4개 영역 병렬 검증 완료 (develop @ 3b66e8efb). 요지:**
> - **사실 유지: 전 항목** — P1-1·P1-2·P1-7·P1-8·P1-9·P1-10·P2-12·P2-13·P2-15·W10 결함 실질 전부 유효, 감사 이후 해소된 것 없음. `order-events.consumer.ts`·`sales-orders.service.ts`·`store-return-exchange.service.ts`·`partial-cancellation-refund-calculator.ts` 는 07-08 이후 무변경(라인 무드리프트).
> - **정정(라인/서술)**: `store-sales-orders.service.ts` 만 07-10 mypage 리팩토링(`07566b4aa` #505, 감사 무관)으로 변경 — P1-8 취소 매핑 682-696→**747-761**, P2-12 :624→**:691** (§2 행 반영 완료). P2-12 "호출마다 randomUUID"는 과도 — 반품 초회(:485)는 결정적 키, UUID 는 취소·반품 재시도만. (표기: sales-order 서비스 실경로는 `sales-order/services/` 하위.)
> - **핵심 발견 (P1-1·P1-2 해법 방향)**: auto-DLQ 인프라 `EventsExceptionFilter`(`@app/events`, 재시도→DLQ→에러 삼킴→offset commit)가 **기존재**하고 notification·wallet·analytics·ugc 등 타 앱 컨슈머는 전부 `@UseFilters` 부착 — **core sales-order 컨슈머만 유일 미부착**(core main.ts 의 microservice 에 글로벌 필터도 없음)이 무한 재시도의 직접 원인. 해법 뼈대 = 필터 부착 + 영구 실패 분류(out-of-order 취소·출고 후 취소 → skip/DLQ + 운영 격리).
> - **P1-7 결정지점 재확정**: `FulfillmentShipped` 발행처 3곳(`outbound-consumption:149,193`·`fulfillments:926`) 대비 소비자는 channel-adapter 송장 채널동기화 1곳뿐 — SO 전이 컨슈머 부재. ADR-0017 :11-14 는 processing/shipped/delivered 를 Core 소유 상태로 명시하나 writer 0 인 도달 불가 상태(D2 정정 대상 그대로), 표시 레이어는 이미 FO 상태 의존(:40 각주).
> - **범위 결정 확정 (2026-07-12) — 4건 전원 WS-D 미편입.** 판단 축: 주제 응집도(①②④는 재고 무결성 = WS-C 계열, WS-D 는 주문/환불로 유지) · 컨텍스트 신선도(①③은 작업 10·11 부품 재사용 — 지금이 싸다) · 탐지 백스톱 유무(①②는 게이지가 탐지, ④는 무탐지) · 수정 형태(코드만 vs 스키마·정책) · 스프린트 판례(구 8b·작업 12 의 근거 명기 보류). 처분:
>   ① **`reverseEvent` 락·가드 우회 → 작업 10b 신설(WS-C 후속 미니, 코드만)** — 당일 입고취소 `inbound.service.ts:1010` → `stock-event.store.ts:300` 가 advisory lock·예약 가드 둘 다 미경유로 ON_HAND 감소. 작업 10 의 락·가드 부품을 이 경로에 배선. 라이브 + 게이지 백스톱 존재 + 부품 재사용이라 저위험 — 컨텍스트 신선할 때 즉시(작업 13 전후 끼움).
>   ② **실사발 on_hand<reserved 예약 자동해제·조회 UI → 명시적 보류**(작업 12·구 8b 판례) — 자동해제 = available 환원이라 초과판매 트레이드오프인데 정책 근거가 될 운영 데이터 부재. **재개 조건**: 게이지 `wms_reserved_over_onhand_grains` 실측(비영 빈도·규모) 관찰 후 정책 결정. 탐지 + 수동 대응은 현행 유지(`reconcileReservations` 탐지 전용).
>   ③ **drop_ship reserve 가드 부재 → 작업 11b 신설(독립 미니 PR)** — facade `reserve`(`fulfillment-reservations.facade.ts:33`) drop_ship 가드 + `computeAdminAvailableActions`(:1095-1096) reserve 제외 + admin-web 동시 수정(작업 7 수직 슬라이스 판례). 라이브(운영자 도달 가능) + 코드만 + 소형 — **4건 중 최우선 착수**.
>   ④ **P1-11 → WS-D 미편입, 별도 설계 항목으로 존치**(§2 ⬜ 유지, 소속 명기) — 무탐지 이중차감(원장대사·좀비대사 모두 못 잡음)이라 기대 피해는 4건 중 최고지만, 해법(FO당 open 박스 partial unique 또는 FO 잠금)이 W5 가 의도적으로 떨어뜨린 unique 와 정면 충돌 → W5 계약 정합 설계 선행 + 스키마 변경·dev DB 게이트. WS-D 에 편입하면 D 전체가 이 게이트에 물림.
>   (부수: admin-web MOVEMENT_TASK 필터 3곳(작업 9 잔여 (b)) 잔존 — `reservations/template/index.tsx:148` 외 2곳, FE 후속 티켓 유지.)
>
> **권장 작업 분할(순서대로):**
> 1. **작업 13 — 컨슈머 포이즌 분류(P1-1·P1-2)**: `EventsExceptionFilter` 부착 + 영구/일시 실패 분류(SO 미존재 out-of-order·출고 후 취소 → skip/DLQ + 운영 격리) + FO 생성 경로 회귀 가드. P2-15(grant tx 분리)는 동일 파일·동일 tx 라 동반 검토.
> 2. **작업 14 — 반품 환불 상태기계(P1-8·P1-9 한 세트 + P2-12)**: `already_refunded` 완료 매핑(취소 경로와 정합) + 환불 성공 후 크래시 자가치유 가능한 상태기계 + 결정적 Idempotency-Key 통일. P1-10(비례식 기준 통일)은 동일 파일이라 동반 가능, P2-13 은 advisory only 라 후순위.
> 3. **작업 15 — SO 상태 결정(P1-7·W10 + D2·D3)**: FulfillmentShipped 소비로 전이 구현 vs 저장 상태 최소화 선언 + 통계 FO 기준 전환 — **결정 선행**, 결정에 따라 ADR-0017(D2)·ADR-0010(D3) 정정 동반.
> 4. ~~범위 결정~~ → **확정(2026-07-12): 4건 전원 WS-D 미편입** — ③ **✅ 작업 11b**(drop_ship 가드, 최우선·독립 미니 PR) · ① **✅ 작업 10b**(reverseEvent 락·가드 배선, WS-C 후속 미니 — `3c5b9d761`) · ④ P1-11 별도 설계 항목(W5 계약 정합 + 스키마·dev DB 게이트) · ② 보류(게이지 실측 관찰 후 정책 결정). 상세는 위 착수 재확인 요지의 처분 블록.

> **타 세션 착수 노트 (2026-07-12)** — 작업 11b·10b·13 을 별도 대화 세션에서 진행하기 위한 인수인계. 상황판 본문에 없는 설계 쟁점·추가 조사 결과만 담는다.
>
> **공통 규약(전 작업 · 과거 작업 1~11 블록의 암묵 관행 명문화):** 브랜치 `feat/<slug>` → 설계 spec + 계획 plan(`docs/superpowers/specs|plans/`) → develop **스쿼시 머지** → 본 상황판 상태 갱신. 검증 체크리스트: `nest build core` exit 0 · arch 경계 spec(`inventory-write-boundary.arch.spec.ts`) PASS · 삭제 심볼 저장소 전역 참조 0 · **변경 파일 신규 eslint error 만**(repo 전역 lint 는 상시 debt — 전역 결과로 판정 금지) · admin-web 변경 시 `type-check` 신규 0. dev DB 부재 중이라 통합 spec 은 ⏸(SKIP) 관행 — 단 `isolatedModules` 라 build/jest 가 spec 을 타입체크하지 않으므로 deferred spec 은 별도 `tsc`(isolatedModules off)로 타입체크(작업 10 발견). 스키마 무변경 달성 가능하면 우선.
>
> **작업 13 (컨슈머 포이즌) 설계 쟁점:** SO 미존재 취소/환불을 단순 skip 하면 out-of-order 상황에서 **취소가 유실**된다(뒤늦게 OrderCreated 가 도착해 SO 가 생겨도 skip 된 취소는 복구 불가 — 기존 `OrderModified` skip `:175-178` 도 같은 문제 내포). 선택지: skip(유실 감수) / 지연 재시도(backlog 유사 기계) / DLQ+운영 격리 — **이벤트 유형별로 다르게** 갈 수 있음(취소=유실 불가 → 지연/DLQ, P1-2 의 출고 후 취소=비즈니스 영구 실패 → 반품 경로 안내+운영 격리). `EventsExceptionFilter` 의 재시도→DLQ→에러 삼킴→offset commit 동작·`@RetryPolicy` 세부는 `libs/events/src/filters/events-exception.filter.ts` + `libs/events/docs/` 참조. 필터 부착 시 `EventTypeGuard` 인터셉터(`order-events.consumer.ts:28-30`)와의 상호작용 확인. 회귀 가드: G4(SO+backlog 동일 tx)·G7(주문 수집 멱등). P2-15(grant tx 분리)는 동일 tx 블록(`:77-105`)이라 동반 검토.
>
> **작업 11b (drop_ship reserve 가드) FE 표면 확정(착수 노트 조사):** reserve 광고 게이트 `inventory-tab.tsx:30`(`canReserve = adminAvailableActions.includes('reserve')`) → `reserve-dialog.tsx`(`useReserveFulfillment`) → client `fulfillments.client.ts:49`(`POST /fulfillments/:id/reserve`, `:54` unreserve 인접). 서버가 광고에서 reserve 를 빼면 FE 는 게이트로 자동 숨김 — 단 직접 API 호출 방어로 **facade 가드가 본체**, 광고 제거는 UX(작업 7 판례: 광고·라우트·UI 동시 정리). **잔존 데이터 결정 필요:** 가드는 신규 생성만 차단 — 기존 non-terminal drop_ship FO 에 이미 걸린 confirmed 예약은 작업 11 heal(terminal 한정) 범위 밖 → 일회 정리 vs 대사 잡 확장 vs 방치(terminal 도달 시 heal) 중 선택.
>
> **작업 10b (reverseEvent) — 표면 3종으로 확대(착수 노트 조사로 확정, 상황판 본문의 ①보다 넓음):**
> - **표면 A(파생 라이브)**: 당일 입고취소 `inbound.service.ts:1010` → `eventStore.reverseEvent`.
> - **표면 B(직접 라이브 — 신규 발견)**: `DELETE /inventory/stocks/events/:eventId/cancel`(`stock-projection.controller.ts:97`) → `StockProjectionManager.cancelEvent`(`stock-projection.manager.ts:10`) → `reverseEvent`. **admin-web 라이브**(`stocks.client.ts:87`) + **임의 이벤트 지정 가능**한 가장 넓은 우회 표면, tx 미전파.
> - **표면 C(dead)**: `inventory-command.service.ts:562` 래퍼 — 호출자 0. 작업 4·5·9 판례로 **절제 후보**(존치 시 배선 지점 후보이기도 함 — 선택지 참조).
> - **배선 레벨 결정**: 작업 10 은 store 를 lower-level 로 남겼는데(호출부가 락·가드 소유), 표면 B 가 임의 이벤트라 호출부 각개 래핑은 누락 위험 → `StockEventStore.reverseEvent` 내부 일괄(판단 번복) vs 호출부 2곳+C 처분. **내부 일괄이 누락 없는 쪽**이나 store 의 낮은 레이어 원칙과 상충 — 설계에서 명시 결정.
> - **가드 정책**: 입고취소·이벤트취소는 실사·파손과 달리 물리적 사실이 아닌 **시스템 정정** → bypass 가 아닌 THROW 대상이 자연스러움. 단 방향 분기 필요: ON_HAND **감소** 방향 reversal(IN 계열 취소)만 락+가드 대상, 증가 방향(OUT 계열 취소)은 가드 불요.

> **✅ 작업 11b (drop_ship 예약/이전 주입 가드) 완료 — 2026-07-12:** drop_ship FO 의 "자사 재고 예약 없음" 불변식을 예약 **생성 경로**에서 강제. 작업 11 부수 발견(operator 수동 `/reserve` 가드 부재 + 광고 노출 → sweep-warn 도달)을 봉합. 스키마 무변경(작업 4·5·6·7·9·10·11 판례).
> - **facade 가드(본체)**: `reserve`(drop_ship THROW)·`transferReservation`(from·to 양방향 THROW)·`getTransferCandidates`(NULL-safe drop_ship 후보 제외 — `or(isNull, ne)` 로 null-mode=in_house 보존). `unreserve` 는 무가드 유지(예약 감소 방향, 잔존 정리 escape hatch).
> - **광고**: `computeAdminAvailableActions` 에서 drop_ship non-terminal → `reserve`·`transferReservation` 제외, `unreserve`·`cancel`·`forwardDropShip` 유지.
> - **admin-web**: surface #1 인라인 예약 버튼을 `adminAvailableActions.includes('reserve')` 서버 계약 기반으로 전환(surface #2 InventoryTab·unreserve/transfer 섹션은 광고 게이트라 자동 반영).
> - **잔존 데이터 = 방치**: 배포 전 non-terminal drop_ship FO 의 기존 confirmed 예약은 terminal 도달 시 기존 `ship()`/`markDelivered()` sweep 이 heal. 일회 정리·대사잡 non-terminal 확장은 비목표(작업 12·구 8b 판례).
> - 설계 `docs/superpowers/specs/2026-07-12-drop-ship-reserve-guard-design.md` · 계획 `docs/superpowers/plans/2026-07-12-drop-ship-reserve-guard.md`.
> - 브랜치 `feat/drop-ship-reserve-guard` → develop **스쿼시 머지 `08c25a58e`** (2026-07-12).
> - 검증: `nest build core` exit 0 · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS · facade/service 유닛 신규 6건 포함 GREEN(3 suites, 120 tests) · admin-web `type-check` 신규 0(현재 baseline 자체가 clean, exit 0). **eslint 재확인 결과 브리핑 기대치와 상이** — 변경 파일 신규 error 0 이 아니라 **13건**(facade.spec.ts +4 · fulfillments.service.spec.ts +9, `develop` 대비 diff): 전부 신규 추가 테스트 코드 내부(`no-unsafe-assignment`/`no-unsafe-call`/`no-unsafe-member-access`/`prettier`) — 프로덕션 코드(`fulfillment-reservations.facade.ts`·`fulfillments.service.ts`)는 0건, 파일 기존 패턴(`any`-타입 mock 파괴·private 메서드 브래킷 호출)과 동일 계열의 연장. getTransferCandidates 필터는 deferred 통합 spec 1건(DB 없으면 auto-skip · isolatedModules-off tsc 타입체크 CLEAN). 스키마 무변경이라 dev DB ⏸ 없음.
> - **WS-D 잔여**: 작업 13(컨슈머 포이즌 P1-1·P1-2)·작업 14(반품 환불 상태기계)·작업 15(SO 상태) + ② 보류(게이지 실측). *(작업 10b reverseEvent = ✅ 완료, 아래 블록)*

> **✅ 작업 10b (reverseEvent 락·가드 배선, 작업 10 I-2) 완료 — 2026-07-12:** 작업 10 이 `adjustDown`·`transferShip`·reserve 를 봉한 뒤 유일하게 남았던 우회 경로 `StockEventStore.reverseEvent` 에 `(sku,warehouse)` advisory 락 + 창고합산 예약 불변식 가드를 **store 내부** 배선. ON_HAND 를 **순감소**시키는 방향의 역분개(입고취소·조정취소 등)만 가드 → 예약 걸린 재고의 역분개를 차단(`on_hand<reserved` 예방). 스키마·마이그레이션 무변경(작업 4·5·6·7·9·10·11·11b 판례).
> - **배선 레벨(설계 포크 결정)**: store **내부 일괄** — 표면 B(`DELETE /inventory/stocks/events/:eventId/cancel` → `stock-projection.manager.ts:10`, admin-web 라이브·임의 이벤트·tx 미전파)가 store 를 직접 호출하므로 호출부 각개 래핑은 누락 위험. 내부 배선이 표면 A(입고취소 `inbound.service:1010`)·B 전부 자동 커버. `DbService.run` 이 tx 없으면 자체 tx 를 열어 advisory 락을 commit 까지 유지 → 표면 B tx 미전파 무해.
> - **방향 판정(순수 헬퍼 `reversalOnHandDecrement`)**: 역분개는 원 이벤트 to-측을 from-측(감소)으로 반전 → 감소 창고 = `original.toWarehouseId`, 조건 = `original.toState==='ON_HAND'` && 창고내이동(from==to·양쪽 ON_HAND) 아님. 상태 규칙 하나로 전 transitionType 커버(RECEIVE/ADJUST_UP=가드, SHIP/ADJUST_DOWN/SCRAP=면제, 창고내MOVE=net0 면제, 창고간MOVE/transferReceive=to-창고 가드). 가드=**THROW**(`ConflictException` 409 — 시스템 정정이라 실사·파손의 bypass 아님).
> - **레이어링(순환 회피)**: 불변식 가드(`readWarehouseReservationBalance`/`violatesReservationInvariant`/`assertReservationInvariant`)를 `InventoryCommandService` → `inventory/shared/locks/reservation-invariant.ts` leaf 로 추출(store↔command 순환 방지, 작업 10 락 헬퍼와 co-locate). adjustDown·transferShip·stocktaking 호출부는 free fn 으로 재배선 — 동작 무변경(semantic 동일). **dead 표면 C**(`InventoryCommandService.reverseEvent`, 호출자 0) 절제.
> - 설계 `docs/superpowers/specs/2026-07-12-reverse-event-lock-and-guard-design.md` · 계획 `docs/superpowers/plans/2026-07-12-reverse-event-lock-and-guard.md`.
> - 브랜치 `feat/reverse-event-lock-and-guard` (SDD 4태스크: shared 추출 → 방향 헬퍼 → reverseEvent 배선 → dead C 절제) → **develop 스쿼시 머지 `3c5b9d761`** (2026-07-12).
> - 검증: `nest build core` exit 0 · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS(직접 INSERT 는 store 내부라 무영향) · 신규 유닛 GREEN(reservation-invariant 3 + reversal-direction 5) · 삭제 심볼(`InventoryCommandService.reverseEvent`) 전역 참조 0 · 변경 파일 신규 eslint 0 · admin-web 무변경. 통합 spec(`reverse-event-guard.integration.spec.ts` 4케이스)은 dev DB 부재로 ⏸(`describeIfDb` skip) — repo내 temp-tsconfig(isolatedModules off)로 타입체크 CLEAN, dev DB 복구 시 런타임 실행. 최종 whole-branch 리뷰(opus) **"Ready to merge: Yes"**(Critical/Important 0, 4정확성질문 sound, minor 3=전부 pre-existing/deferred). 스프린트 유닛 2 fail 은 develop 에도 있는 pre-existing baseline(내 diff 밖 `product-sellable-quantity.calculator`·`apps/medusa`) → 회귀 0.
> - **행동 변화(라이브)**: 표면 A(입고취소)·B(admin-web `DELETE .../cancel`) 이 예약 stranding 유발 감소 역분개 시 **409** 반환(운영 remedy=예약 먼저 해제). admin-web 기존 에러토스트 경로 — runtime hard-break 체크는 dev DB 복구 시 verify.
> - **WS-C/WS-D 위치**: WS-C 코어(작업 9~11)의 최종 I-2 잔여를 닫는 WS-C 후속 미니. 상황판 처분 ①(2026-07-12) 완결. WS-D 본류(작업 13~15)·② 보류(게이지 실측)는 잔존.

> **✅ 작업 13 (컨슈머 포이즌 분류, P1-1·P1-2) 완료 — 2026-07-12:** core `OrderEventsConsumer` 만 유일하게 auto-DLQ 필터 미부착이라 실패 메시지가 offset 미커밋 → 무한 포이즌으로 파티션을 정체시키던 것을, `@UseFilters(EventsExceptionFilter)` 부착 + Nest 4xx non-retryable 분류로 재시도→DLQ→offset commit 전환. 스키마·마이그레이션 무변경(작업 4·5·6·7·9·10·11·11b·10b 판례).
> - **P1-1**: `OrderCancelled`(`nonRetryableErrors:[NotFoundException, BadRequestException]`)·`OrderRefundCreated`(`[NotFoundException]`)의 SO-not-found → 분류로 **즉시 DLQ**. 근거: 주문 이벤트는 `aggregateId=externalOrderId` 파티션 키(`order-event.publisher.ts:170,216,264`) = 같은 주문 Created/Cancelled 순서보장 → SO 미존재는 재시도해도 미출현(실제 원인=OrderCreated 의 DLQ 낙하)이라 영구 실패. DLQ **보존**이라 skip 유실·무한재시도 둘 다 회피(착수 노트의 "취소=DLQ+운영 격리").
> - **P1-2**: 출고 후 전체취소 → `cancel()` `BadRequestException`(4 throw-site 전부 영구 비즈니스 거부 확인: 빈 부분취소·shipped SO·shipped FO·shippedQty) → non-retryable 즉시 DLQ.
> - **OrderCreated 관대 정책(P2-15 완화, tx 분리 미착수)**: `@RetryPolicy({maxRetries:5,…})` — grant tx 분리(P2-15 본체)는 범위 밖 유지, 정책 완화로 일시 grant/DB 실패의 유료주문 DLQ 낙하만 낮춤(범위 결정: 사용자). **OrderModified 무변경**(not-found skip+수정 무시 = 의도).
> - **부수 수정**: event-contracts payload import 를 `import type` 로 — bare `@packages/event-contracts` 가 jest `moduleNameMapper` 에 미등록(하위경로만)이고 `isolatedModules` 하 값 import 가 런타임 require 로 남아 이 spec 이 원래 CI 에서 실행 불가였던 것 해소. 회귀 가드가 실제로 돌게 됨.
> - 설계 `docs/superpowers/specs/2026-07-12-consumer-poison-classification-design.md` · 계획 `docs/superpowers/plans/2026-07-12-consumer-poison-classification.md`.
> - 브랜치 `feat/consumer-poison-classification` (spec·plan·impl·리뷰반영 4커밋, tip `2a6706784`) → **develop 머지 `599d82523`** (2026-07-12).
> - 검증: `nest build core` exit 0 · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS · 컨슈머 스펙 11(기존 wiring) + 필터·분류 메타데이터 회귀 가드 5 = 16 GREEN · 변경 파일 신규 eslint 0. 최종 whole-branch 리뷰(opus) **"Ready to merge: Yes"**. 통합 spec 없음(신규 전부 유닛)·스키마 무변경이라 dev DB ⏸ 없음.
> - **⚠️ 리뷰 발견 fast-follow (본 작업 범위 밖, 별도)**: ① **공유 필터 버그** — `EventsExceptionFilter`(`events-exception.filter.ts:112`)가 pure `updateRetryContext` 반환값 폐기 + `retryContext` const 미재대입으로 `attemptNumber` 0 고정 → 영구 **retryable** 실패 시 무한 1s 루프·`maxRetries`/`backoff` **inert**(전 컨슈머 영향). **P1 경로는 nonRetryable 로 while 루프 미진입이라 무영향**, OrderCreated 관대정책만 필터 수정 후 발효(forward-correct). `@app/events` 공유 인프라라 별도 PR(전 컨슈머 회귀 테스트 동반) — **이슈 #507 → ✅ 해소(2026-07-13, EventRetryInterceptor 재설계, #508 상호참조)**. ② **DLQ 관측성** — 시끄러운 파티션 정체 → 조용한 DLQ+offset commit 으로 바뀌므로 프로덕션 의존 전 DLQ 토픽 알림 존재 확인 필요. ③ **jest 매퍼 갭** — `^@packages/event-contracts` 를 domain-types 처럼 `(|/.*)` bare 케이스로 확장 시 타 core 스펙도 근본 해소(이번엔 `import type` 로 스코프 제한 대응).
> - **WS-D 잔여**: ~~작업 14(반품 환불 상태기계)~~ 완료 · 작업 15(SO 상태 결정 P1-7·W10 + D2·D3) + ② 보류(게이지 실측).
>
> **✅ 이벤트 재시도/DLQ 필터→인터셉터 재설계 (작업 13 fast-follow, #507·#508) 완료 — 2026-07-13:** 작업 13 의 P1-1/P1-2 는 완료 표기 시점에 프로덕션에서 실제로는 **미작동**이었다 — `EventsExceptionFilter` 가 RPC 에러 경로에서 `host.getHandler()=null` 로 `:51` 즉시 크래시(#508)해 `@RetryPolicy`·DLQ·offset commit 이 전면 무력(#507 의 `attemptNumber` inert 도 같은 필터 결함). **필터를 통째 제거하고 `EventRetryInterceptor` 로 재설계**해 분류·재시도·DLQ·offset commit 이 실작동하게 됐고, Nest RPC 실배선 인프로세스 회귀 가드로 봉인.
> - **기전 교체(현재 코드 상태)**: `libs/events/src/filters/events-exception.filter.ts`(226줄) **삭제** → `EventRetryInterceptor` 를 `EventsModule` 에서 **전역 `APP_INTERCEPTOR` 자동 등록**(`events.module.ts:183`) = EventsModule 을 import 하는 **전 컨슈머 자동 적용**이라 작업 13 의 근본원인이던 "필터 미부착 사고" 를 원천 차단. core `OrderEventsConsumer` 의 `@UseFilters` 제거, `@RetryPolicy` 메타데이터는 인터셉터가 소비(consumer 로직 무재작성). 타 앱 ingest 컨슈머(orders/products)도 동반 정합.
> - **검증**: `event-retry.interceptor.spec.ts`(단위) + `event-retry.wiring.spec.ts`·`events.module.spec.ts`(실배선 인프로세스 — Nest RPC 바인딩 경로에서 분류/DLQ/삼키기 검증) GREEN. 최종리뷰 반영(`DlqDeliveryError` 중첩 전파 가드·실배선 retryable 케이스).
> - **GitHub**: #507·#508 둘 다 **CLOSED**(2026-07-12). 설계 `docs/superpowers/specs/2026-07-13-event-retry-interceptor-design.md` · 계획 `docs/superpowers/plans/2026-07-13-event-retry-interceptor.md`.
> - 브랜치 `feat/event-retry-interceptor` → **develop 스쿼시 머지 `2f456d295`** (2026-07-13). *(이전 표기 "머지 대기"는 이 머지로 해소.)*
> - **✅ 컨슈머 앱 롤아웃 — #510 search 완료(2026-07-13):** 인터셉터가 `EventsModule` import 앱에 자동 적용되는데, search 는 `main.ts` 의 `forConsumer`(전송 배선)만 있고 어느 모듈에서도 `EventsModule` 을 import 하지 않아 `EventRetryInterceptor` 가 DI 미등록이던 **유일 컨슈머 앱** → 포이즌 시 offset 미커밋·무한 재전달. `search.module.ts` imports 에 `EventsModule.forConsumerModule` 조건부(`KAFKA_BROKERS`) 추가로 정합(channel-adapter graceful-degradation 판례), `search.module.spec.ts` 가 @Module 메타데이터 정적 검사로 봉인(라이브 인프라 불필요). **develop 머지 `2ab298538`**, GitHub 이슈 **#510 CLOSED**. **잔여 = #509**(channel-adapter 자체 로컬 `RetryPolicy` → `@app/events` 이관 검토, needs-triage) + DLQ 토픽 알림 확인.

> **✅ 작업 14 (반품 환불 상태기계, P1-8·P1-9 + P2-12 + P1-10) 완료 — 2026-07-12:** 반품 환불을 **시도별 결정적 idempotency key + intent-first attempt 행 상태기계**로 재구성. Wallet 이 idempotency key(=correlationId)로 성공·실패를 모두 캐시(24h)하고 동시 같은 key 를 409 IN_FLIGHT 로 막는다는 코드 확인(`apps/wallet/.../http-idempotency.interceptor.ts`·`idempotency.service.ts`)이 설계의 축 — 랜덤 key 는 오히려 크래시 복구를 깨뜨림. P1-8·P1-9·P2-12 는 하나의 메커니즘.
> - **핵심 3규율(브레인스토밍)**: ① N 증가(새 attempt 행·새 key)는 Wallet 이 **확정 실패(determinate 4xx)** 를 반환한 다음만 — 불확정(5xx·네트워크·409 IN_FLIGHT·partial_pending)은 같은 key 재생(부분환불은 `already_refunded` 방어 안 됨). ② Wallet 호출 前 attempt 행(key·amount·pending)을 커밋하는 intent-first 기록이 key·amount 의 SoT — 재사용 시 행에서 로드(재계산 금지). ③ 409 IN_FLIGHT ≠ 확정 실패 → 같은 key 재시도 버킷.
> - **P1-9(크래시 복구)**: `attemptReturnRefund` 3-phase — A(tx, `return_request` FOR UPDATE: pending attempt 재사용 or 신규 INSERT, Wallet 호출 前 durable) → B(tx 밖 Wallet, 행의 key·amount) → C(tx, FOR UPDATE: `classifyRefundOutcome` 로 succeeded/failed/pending 전이). 초회(`completeReturnRequest`)·재시도(`retryReturnRefund`) 통합 위임. Wallet 성공 후 크래시 → 재시도가 pending 행 재사용 → 같은 key replay → completed 수렴.
> - **P1-8**: `already_refunded → completed` 매핑(취소 경로와 정합, 2차 방어). **P2-12(반품 경로)**: 재시도 randomUUID → 결정적 `return:{id}:refund:{N}`. 취소 경로 P2-12 는 **명시적 후속**(부분취소 keying 별도) — 취소엔 `in_flight` case 만 추가(net 보존). **P1-10**: `calculateReturnRefund` 분자를 분모와 동일 `lineWeight(totalPrice ?? unitPrice*qty)` 기준으로 통일(할인 라인 과대/과소 해소).
> - **신규 테이블 `return_refund_attempts`**(스프린트 첫 스키마 변경 — 규율 2 의 durable SoT 요구가 정당화): `(rrId, attemptNumber, idempotencyKey, amount, status, walletOutcome)`, `unique(rrId,N)` + partial `unique(rrId) where pending`(반품당 in-flight ≤1). additive 단일 PR, **마이그레이션 적용 ⏸**(dev DB, 작업 1·2·3·8a 미적용분과 일괄). client 정제: `failed.determinate`(4xx=true/5xx=false) + `in_flight` kind.
> - 설계 `docs/superpowers/specs/2026-07-12-return-refund-state-machine-design.md` · 계획 `docs/superpowers/plans/2026-07-12-return-refund-state-machine.md`. SDD 6태스크(T5 리뷰 Important 1건=Phase C 경합가드 반영: 동시 success 완료 attempt 를 stale failed 로 뒤집어 N+1 이중환불 여는 경로 차단, RED→GREEN).
> - 브랜치 `feat/return-refund-state-machine` (10커밋: docs 2 + code 8, tip `e12b3e928`) → **develop 스쿼시 머지 `5669866a9`** (2026-07-12).
> - 검증: `nest build core` exit 0 · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS · 신규/변경 유닛 GREEN(store-return-exchange 28/28·wallet-client 12/12·classification 7/7·store-sales-orders +1 in_flight) · 변경 파일 신규 eslint 0(store-return-exchange 64→51·wallet-client 3→0 감소) · admin-web 무변경. 전체 sales-order 스위트 32 fail 은 **전부 pre-existing baseline**(merge-base worktree 대조 확정, 회귀 0 — partial-cancellation-refund-calculator[P2-13 계열]·sales-orders·store-sales-orders 기존 실패). 통합 spec `it.todo`(dev DB 복구 시 실 DB 동시성 검증) ⏸. 최종 whole-branch 리뷰(opus) **"Ready to merge: Yes"**(Critical/Important 0, 7 정확성질문 hand-trace 통과).
> - **WS-D 잔여**: 작업 15(SO 상태 결정 P1-7·W10 + D2·D3) + ② 보류(게이지 실측) + P2-12 취소 경로 key(명시적 후속) + P1-11(별도 설계 항목).

> **✅ 작업 15 (SO 상태 결정, P1-7·W10 + D2·D3) 완료 — 2026-07-13:** SO 저장 상태를 최소 선언(실 lifecycle `pending→confirmed→cancelled`)하고 출고완료 통계를 FO 기준으로 도출. **B안 확정**(사용자 결정) — 저장 전이 구현(A) 기각. 근거: 표시 레이어가 이미 100% FO 도출(SO.status 는 SoT 아님)·SO↔FO 0..1:0..1(디지털주문 FO 0개)·유일 실결함은 `getStats.outboundComplete=0` 하나. 스키마 무변경(작업 4~11 판례).
> - **P1-7**: `getStats().outboundComplete` = `byStatus(processing/shipped/delivered)`(항상 0) → confirmed SO 중 FO shipped-evidence(`status∈{shipped,completed} OR shippedAt≠null`, 표시 레이어와 동일 정의) 보유 건수. `outboundRequested`(=confirmed) 유지 → `완료 ⊆ 요청` 중첩(Choice 2). admin-web 반환 shape 불변 → FE 무변경.
> - **dead 선언**: `orderStatusEnum` 의 `processing/shipped/delivered` 마커 주석(재사용 잠금, 구 8b 판례; 최종리뷰 I1 로 `timeout` 도 producer 0 인 예약 값 확인 — 실 lifecycle=`pending→confirmed→cancelled`) + `NON_CONFIRMABLE` 방어 주석 + `store-sales-orders.service.ts` 죽은 SO.status OR-폴백 2곳 제거(동작 무변경). pgEnum 값 물리 제거는 비목표.
> - **D2(ADR-0017)**: SO 상태 소유 표 정정 — 세 값 producer 0, 표시는 FO(`status`+`shippedAt`) 도출 SoT. SHIPPING/DELIVERED 조건을 FO 기준으로. **D3(ADR-0010)/W10**: `confirm()` 은 FO 생성 트리거 아님(FO=OrderCreated backlog) 명확화.
> - 설계 `docs/superpowers/specs/2026-07-13-sales-order-status-derivation-design.md` · 계획 `docs/superpowers/plans/2026-07-13-sales-order-status-derivation.md`.
> - 브랜치 `feat/sales-order-status-derivation`(설계·계획 docs 2 + T1 getStats FO 도출 · T2 dead 선언 · T3 ADR 정정(+인용 fix) · T4 현황판(+eslint import wrap fix) · 최종리뷰 정확성 fix, code tip `290d592f1`) → **develop 스쿼시 머지 `2f3807da4`** (2026-07-13, 완료블록 최종 정정 포함).
> - 검증: `nest build core` exit 0(webpack compiled) · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS(1/1) · `sales-orders.service.spec.ts` **5 failed / 32 passed / 37 total**(5 fail 은 develop 대비 pre-existing baseline — merge-base 대조 확정, 회귀 0; getStats 신규 유닛이 base 31→32 passed 로 +1, dead status 합과 FO 도출 구분 회귀 가드 포함 GREEN) · 변경 파일(`sales-orders.service.ts`·`store-sales-orders.service.ts`·`inventory.schema.ts`) eslint develop 대비 **신규 0**(초기 `isNotNull` import printWidth 초과 +1 을 멀티라인 wrap 으로 해소 — in-project 동일경로 대조 branch 145=develop 145). admin-web 무변경. 스키마 무변경이라 dev DB ⏸ 없음. 통합 spec 없음(신규 전부 유닛, 작업 11·13 판례).
> - 최종 whole-branch 리뷰(opus, merge-base 5669866a9..b6ebc577a) **"Ready to merge: With fixes"** — Critical 0, 코드 정확성(predicate parity·nesting·dead-branch 안전성 repo 전수) 통과. Important I1(timeout 도 producer 0 — schema 주석·ADR-0017 D2 사실정정) + Minor M1(ADR-0010 confirm 인용 306-363→319-377, import wrap 라인드리프트)·M2(getStats 주석 hasShippedEvidence 만)·t3(ADR-0017 PREPARING dead processing 제거) 반영 후 clean(`290d592f1`). defer: t1(목이 shippedAt-leg/groupBy 미실행, dev DB 이연)·t2(방어 가드 주석 부재, 가독성).
> - **비고**: 작업 13·14 코드는 이미 develop 반영됨(스쿼시 `5669866a9`·`599d82523`) — 상황판 "머지 대기" 표기가 뒤처졌던 것으로, WS-D 잔여는 ② 보류(게이지 실측) + P2-12 취소경로 key + P1-11(별도 설계)뿐.
> - **WS-D 본류(작업 13~15) 완료** — 잔여: ② 보류 · P2-12 취소경로(명시적 후속) · P1-11(별도 설계 항목).

> **✅ DLQ 관측 메트릭 (잔여 우선순위 ① DLQ 알림 확인 후속) 완료 — 2026-07-13:** 작업 13/이벤트 인터셉터 재설계가 실패 모드를 "조용한 DLQ 적재 + offset commit"으로 바꾼 뒤, DLQ 이벤트에 알림·메트릭이 **코드·인프라 어디에도 없던 것**(조사: 앱 알림 주석처리·메트릭 미등록·Redpanda 미스크레이프·로그만 존재)을 메트릭 방출로 해소. 스키마 무변경.
> - **메트릭**: `libs/events/src/dlq/dlq.metrics.ts` 신규 — `events_dlq_messages_total{topic,consumer,error}`(발행 성공=조용한 유실 관측) + `events_dlq_send_failures_total{topic,consumer}`(발행 실패=offset 미커밋 치명 케이스). prom-client 전역 register 모듈 스코프 싱글턴(DLQHandler 2곳 프로바이드 중복 등록 회피). `error` 라벨=클래스명만(카디널리티).
> - **배선**: `DLQHandler.sendToDLQ` emit 성공/catch 지점 inc. 시그니처·envelope·EventsModule 무변경. dead alert 코드(`shouldAlert`+TODO 주석) 절제.
> - **커버리지(Core 우선 MVP)**: 코드는 전 컨슈머 균일 배포되나 Alloy가 Core `/metrics`만 스크레이프 → **실관측은 Core DLQ**(작업 13 하드닝한 주문/환불/재고 컨슈머 커버). non-Core 확장(각 앱 `/metrics`+Alloy 타겟)은 known gap.
> - **운영자 후속(리포 밖)**: Grafana Cloud 알림 규칙은 UI 관리 — 이 작업은 메트릭 방출만 제공. 권장 PromQL: warn `sum(increase(events_dlq_messages_total[10m])) by (topic,consumer) > 0` · critical `sum(increase(events_dlq_send_failures_total[5m])) > 0`.
> - 설계 `docs/superpowers/specs/2026-07-13-dlq-observability-metrics-design.md` · 계획 `docs/superpowers/plans/2026-07-13-dlq-observability-metrics.md`.
> - 검증: `nest build core` exit 0 · arch 경계 spec PASS · `dlq.metrics.spec.ts` 2 GREEN · 삭제 심볼(`shouldAlert`) 참조 0 · 프로덕션 변경파일 신규 eslint 0. 통합 spec 없음(신규 전부 유닛).

**WS-E. 컨벤션/횡단** — P3-1(워커 파싱 제거와 한 세트), P3-2, P3-3, P3-6, P3-7, P3-8, P2-3, P2-5~P2-8, P2-10, W8, W9

권장 착수 순서: ~~WS-A·B P0 → WS-D 포이즌 → WS-C → 나머지~~ → **본류 전량 종결(2026-07-13)** — WS-A(작업 1~4)·WS-B(5~8a)·WS-C(9~11 + 후속 10b·11b)·WS-D(13~15) 전부 develop 머지. **잔여 우선순위**: ① ✅ 이슈 #507·#508(`EventsExceptionFilter` attemptNumber inert + RPC 에러 경로 즉시 크래시 — 필터 제거 후 `EventRetryInterceptor` 전역 등록으로 해소, **develop 스쿼시 머지 `2f456d295`**, GitHub CLOSED) + **✅ #510 search 컨슈머 인터셉터 배선 완료**(EventsModule 미import 였던 유일 컨슈머 앱 → `forConsumerModule` 추가, **develop 머지 `2ab298538`**, 2026-07-13, GitHub CLOSED) — **잔여는 DLQ 관측 메트릭(✅ 2026-07-13, events_dlq_* 방출 — Grafana Cloud 알림 규칙은 운영자 후속) + #509**(channel-adapter 로컬 RetryPolicy 이관 검토, needs-triage) ② ⏸ dev DB 복구 시 마이그레이션 5건(작업 1·2·3·8a·14) 적용 + deferred 통합 spec 일괄 실행 ③ P2-12 취소 경로 key(명시적 후속) ④ WS-E(P3-1 은 backlog 워커 제어흐름과 얽혀 독립 PR + FO 생성 실패 회귀 테스트 필수) ⑤ P1-11 별도 설계(W5 계약 정합 선행). 보류 2건(P2-1 W5 게이트 · on_hand<reserved heal 게이지 실측)은 재개 조건 명기로 종결.
