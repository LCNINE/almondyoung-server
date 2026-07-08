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
| P0-1 ✅검증 | ⬜ | `movement/services/movement.service.ts:220-235, 254-300` | 창고간 이동이 `toState:null` MOVE 로 **출발지만 차감** — IN_TRANSFER 미기록, complete 는 입고예정 expectedDate 만 갱신 | PO 외 ad-hoc 이동 100개 → 출발 창고 -100, 어디에도 +100 없음 = 영구 소실. 무손실 경로(`TransferService.transferBetweenWarehouses`, ON_HAND→IN_TRANSFER→ON_HAND)가 있으나 컨트롤러에 미연결 |
| P0-2 ✅검증 | ⬜ | `stocktaking/services/stocktaking.service.ts:361-374` | 실사 조정이 `tx.insert(stockEvents)` **직접 INSERT** — StockEventStore 우회 → 원장/판매가능수량/outbox 미반영 | 실사 확정해도 시스템 재고 불변. `stocktakingAdjustments.stockEventId` 는 원장 미반영 유령 이벤트를 참조 |
| P0-3 ✅검증 | ⬜ | `stocktaking.service.ts:329-396` | 실사 조정 멱등성/재실행 방지 부재 (세션 상태 미검사, 처리 플래그 없음) | `generate-adjustments` 2회 호출 → 조정 2배 생성 (P0-2 수정 즉시 실피해로 전환 — **P0-2 와 반드시 함께 수정**) |
| P0-4 ✅검증 | ⬜ | `core/services/inventory-correction.service.ts:48, 93, 134` | `correctReceipt`/`reportTransportLoss`/`processDefectiveItems` 가 fromState/toState 미설정 → `ck_events_side_present`(`schema:812`) 위반 | 세 메서드 모두 **dead code**(모듈·컨트롤러 미등록, 호출처 0) — 배선하는 순간 즉시 500. 이미 `createEvent` 경유라 작업은 '재배선'이 아니라 **상태 인자 채우기 + `correctReceipt` ADJUST_DOWN 창고 사이드 버그(to\*→from\*) + P3-2 tx 전파** (착수 재확인 2026-07-08) |
| P0-5 ✅검증 | ⬜ | `shared/services/reservation-lifecycle.service.ts:130-157` | `processExpiredReservations` 의 `timeoutAt < now()` 필터가 **주석 처리** — 호출 시 confirmed 예약 전체 해제. 현재 호출처 0건(dead 지뢰) | 누군가 크론/컨트롤러에 배선하는 순간 전 예약 해제 → 대량 초과판매. **제거가 답** |

### P1 — 높음 (오동작이 곧 돈/재고로 이어지는 경로)

| ID | 상태 | 위치 | 결함 | 실패 시나리오 |
|---|---|---|---|---|
| P1-1 ✅검증 | ⬜ | `sales-order/consumers/order-events.consumer.ts:126, 212` | `OrderCancelled`/`OrderRefundCreated` 가 SO 미존재 시 throw → 재throw → 오프셋 미커밋 | out-of-order 전달(취소가 생성보다 먼저) 시 파티션이 포이즌 메시지로 정체. `OrderModified` 는 skip 처리(`:176`)와 불일치 |
| P1-2 ✅검증 | ⬜ | `order-events.consumer.ts:138-153` + `sales-orders.service.ts:454,470` | 출고완료 주문의 채널발 전체취소 → `cancel()` BadRequestException → 무한 재시도 | OUT_OF_STOCK/ADMIN 취소가 출고 후 도착하면 영구 소비 실패 |
| P1-3 ✅검증 | ⬜ | fulfillment 전역 (`fulfillments.service.ts:804`, `fulfillment-reservations.facade.ts:92`) | FO 예약 `timeoutAt=null` — 만료 크론(`unified-reservation.service.ts:296`) 대상에서 영구 제외 | ship/cancel 없이 방치된 FO 의 예약이 available 을 영구 잠금(과소판매). 타임아웃 정책 결정 + 잔존 예약 모니터링 필요 |
| P1-4 | ⬜ | `core/services/unified-reservation.service.ts:257-277, 56-79` | 가용 확인→예약 INSERT 사이 락 없음 (TOCTOU) | 동시 요청 둘 다 available=10 을 읽고 각각 10 예약 → `reserved(20) > on_hand(10)` = 초과판매. ADR-0011 의 "감수" 범위를 넘어 단일 창고 내에서도 발생 |
| P1-5 | ⬜ | `core/services/inventory-command.service.ts:366-428` | `adjustDown` 이 confirmed 예약을 무시하고 로케이션 ON_HAND 만 검증 | `on_hand=10, reserved=10` 에서 adjustDown 5 성공 → `on_hand < reserved` 모순 → 이후 FIFO 소진 throw 로 출고 실패 |
| P1-6 | ⬜ | `services/fulfillment-order-transaction.service.ts:344` | 예약을 dead 상태값 `status='active'` 로 조회 (실제 예약은 전부 `'confirmed'` 생성, `unified-reservation.service.ts:75`) | 이 경로 사용 시 예약 전량을 0 으로 보고 배치 가용 과다 계산 → 이미 묶인 재고를 할당 가능으로 오판 |
| P1-7 ✅검증 | ⬜ | `sales_orders.status` 전이 3곳뿐 (`sales-orders.service.ts:357,418,555`) | `processing/shipped/delivered` 미전이 — ADR-0017 이 Core 소유로 명시한 상태들이 미구현 | `getStats()` 출고완료 통계 항상 0(`:831`), `cannotShip` 쿼리 confirmed 전제로 누락. **결정 필요**: FulfillmentShipped 소비로 전이 구현 vs 저장 상태 최소화 선언 + 통계 FO 기준 전환 |
| P1-8 | ⬜ | `store-return-exchange.service.ts:493-513, 748-756` | 반품 환불에서 `already_refunded` 를 완료로 매핑 안 함 (취소 경로 `store-sales-orders.service.ts:682-696` 는 매핑 — 불일치) | 환불은 성공했는데 반품이 `refund_pending` 고착, 재시도로 탈출 불가(수동 처리 필요) |
| P1-9 | ⬜ | `store-return-exchange.service.ts:448-513` | 반품 완료 2단계(환불 호출)가 tx 밖 — 환불 성공 후 크래시 시 상태 불일치 | 돈은 나갔는데 `refund_pending` 유지. P1-8 때문에 자동 복구도 안 됨 — 복구 가능한 상태기계로 |
| P1-10 | ⬜ | `store-return-exchange.service.ts:1308-1316` | 환불 비례식 분모는 `totalPrice ?? unitPrice*qty`, 분자는 `unitPrice*returnQty` — 기준 불일치 | 라인 할인으로 `totalPrice ≠ unitPrice*qty` 인 주문의 부분 반품 환불액 과대/과소 산정 |
| P1-11 | ⬜ | `services/shipment.service.ts:36-123` | `openBoxByScan` 이 invoice 만 FOR UPDATE — FO 미잠금, FO당 open 박스 1개 강제 없음 (`issuedForFulfillmentOrderId` DB 부분 unique 부재) | 한 FO 에 non-voided 송장 2개(취소→재발행 경합) → 각각 스캔 → 둘 다 동일 잔량 박스 open → 각자 검수완료 → **on_hand 이중 차감** |

### P2 — 중간 (정합성/견고성)

| ID | 상태 | 위치 | 결함 |
|---|---|---|---|
| P2-1 | ⬜ | `outbound-consumption.service.ts:70-73, 136` | `consumeShipment` 가 FO 1:1 가정 — `openedForFo=null` 이면 throw, 예약 소진이 박스 라인이 아닌 **FO 전량** 단위. 합배송/송장분할(M:N) 흐름을 열기 전에 라인 단위 소진으로 전환 필요 (스키마는 이미 M:N 개방) |
| P2-2 | ⬜ | `core/services/sku-location-movement.service.ts:86-99` | `recordMovement` 가 원장을 건드리지 않는 "이동"을 completed 로 기록 → 로케이션 grain 원장과 물리 위치 불일치 → FIFO 소진이 틀린 로케이션 선택 가능. **단 컨트롤러 라우트 전부 주석처리 — 현재 호출 불가(잠복). 수정 = `moveInternal` 위임** (착수 재확인 2026-07-08) |
| P2-3 | ⬜ | `inbound/services/inbound.service.ts:782-787` | 초과 수령 무제한 허용 (expectedQty 상한/경고 없음) |
| P2-4 | ⬜ | `inbound.service.ts:107,191,270,760`, `movement.service.ts:92` | 입고/이동 경로 전부 `idempotencyKey` 미전달 — 재전송 시 중복 입고(재고 2배). `stock_events.idempotencyKey` 방어막 무력화. **(+`returnInbound:915`·`createInterWarehouseTransfer:220` 동일). 진짜 재-POST 방어엔 클라이언트 요청 키 필요 — inbound line id 는 이벤트 후 생성이라 못 씀** (착수 재확인 2026-07-08) |
| P2-5 | ⬜ | `stocktaking.service.ts:139-149`, `schema:1716` | 실사 라인 무조건 INSERT — (session×sku×location) unique 없음, 동시 세션 로케이션 배타 제어 없음 → 재스캔/동시 실사 시 이중 조정 |
| P2-6 | ⬜ | `stocktaking` 전반 | 실사가 expected 를 스캔 시점 ON_HAND 스냅샷으로만 계산 — 카운팅 중 예약/이동 미고려 (variance-delta 방식의 이중 계산 위험) |
| P2-7 | ⬜ | `core/services/location.service.ts:534-551` | 로케이션 삭제에 재고 가드 없음 → 도메인 에러 대신 FK 위반 500. qty=0 잔여 row 케이스도 정리 필요 |
| P2-8 | ⬜ | `warehouse/services/warehouse.manager.ts:70-78` | 창고 삭제 in-use 검사와 삭제가 다른 트랜잭션 (TOCTOU) — 최악 500 |
| P2-9 | ⬜ | `fifo-allocate.ts:27-34` vs `allocation-strategy.service.ts:337` | FIFO 이중 구현 정렬 기준 불일치 (fifoRank+updatedAt vs updatedAt만) — 계획 로케이션 ≠ 실소진 로케이션 |
| P2-10 | ⬜ | `outbound-consumption.service.ts:198` | active invoice 부재 시 `carrier:'CJ'` 하드코딩 + trackingNumber `''` 발행 — 불변식 위반을 잘못된 데이터로 다운스트림 전파 |
| P2-11 | ⬜ | `fulfillments.service.ts:1076` | `computeAdminAvailableActions` 가 은퇴한 `POST /fulfillments/:id/ship` 을 광고 → UI 렌더 시 404 (RFC Cluster A 후속 #1) |
| P2-12 | ⬜ | `store-sales-orders.service.ts:624`, `store-return-exchange.service.ts:730` | Wallet Idempotency-Key 가 호출마다 randomUUID — 동시 실행 시 이중 환불 방어가 전적으로 Wallet 측 refundable 검증에 위임 |
| P2-13 | ⬜ | `partial-cancellation-refund-calculator.ts:124-146` | 부분취소 환불 추정치가 이전 취소 기환불액 미차감 — 항상 manual_pending 이라 자동 과다환불은 없으나 운영자 표시 합계가 총액 초과 가능 |
| P2-14 | ⬜ | events↔ledgers 대사 부재 | `stock_events`(진실)↔`stock_ledgers`(파생) 를 재검증/복구하는 reconcile 잡·엔드포인트 없음. `calculateQuantityAsOf`(`stock-event.store.ts:204`) primitive 만 존재 — P0 우회 버그류 탐지 장치로 신설 |
| P2-15 | ⬜ | `order-events.consumer.ts:104` | library grant 가 SO 생성과 동일 tx — grant 실패가 유료 주문 수용을 롤백 (재전달 자가치유 의존). 분리 검토 |

### P3 — 컨벤션/정리 (단, P3-1 은 실질 위험)

| ID | 상태 | 범위 | 내용 |
|---|---|---|---|
| P3-1 | ⬜ | sales-order·fulfillment·inventory 구세대 서비스 전반 | `@app/shared` 도메인 에러 대신 Nest HttpException throw. **단순 스타일 아님**: backlog 워커가 `error instanceof BadRequestException` + 응답 문자열/code 파싱으로 제어흐름 결정(`worker.ts:135,164-179`) — 에러 리팩터 시 매칭 누락 주문이 자동 재시도(wake)에서 조용히 탈락. 코드를 실은 타입 있는 도메인 예외로 이관 + 워커 문자열 파싱 제거를 **한 세트로** |
| P3-2 | ⬜ | `inventory-correction.service.ts:34,83,124`, `location.service.ts:135,240,450`, backlog `worker.ts:61` | ADR-0025 이탈: `this.db.transaction` 직접 호출, `tx?` 전파 없음. `location.service.getLocationById`(`:62`) 의 tx 이탈 latent 버그 포함 |
| P3-3 | ⬜ | `product-sellable-quantity.service.ts:204~485`, `outbox.service.ts:19`, `audit.service.ts:261` | seam 서비스의 반복 `as MergedTx` + `as unknown as` 캐스트, `payload as any` — ADR-0025 의 1회 narrowing 원칙으로 정돈 |
| P3-4 | ⬜ | 스키마/enum 전반 | dead 값 정리: FO status `reserving/labeled/inspecting/inspected/pending`(세터 없음 — invoice 게이트 `invoice.service.ts:229` 의 `inspected` 분기 도달 불가), reservation `pending/active`, shipment `failed/in_transit/delivered`(추적 전용), `eventTypeEnum` 의 RESERVE/CONFIRM/RELEASE/CANCEL(원장 미사용 — "예약도 이벤트소싱" 착시, review §5-3) |
| P3-5 | ⬜ | `outbound_tasks`/`outbound_task_items/lines` + `FulfillmentOrderTransactionService` | 평행/유휴 상태 서브시스템 — batch 경로와 이중 구현(할당 경로 중복: `outbound-batch.service.ts:153` vs `fulfillment-order-transaction.service.ts:261`). dead 출고 경로(`shipFulfillmentOrder`/`completeFulfillmentOrder`)는 RFC 명기 지뢰 — 은퇴 |
| P3-6 | ⬜ | 인가 | JWT 인증은 글로벌(APP_GUARD)이나 **역할 기반 인가 부재** — 발주 승인·재고 조정·창고 삭제에 role 통제 없음 |
| P3-7 | ⬜ | 규칙 정합 | CLAUDE.md "Inventory 금지: `db.query.*`/`with`" vs ADR-0025 "per-BC 가드레일로 유지" 상충 — inventory 전반에서 광범위 사용 중. 규칙을 한쪽으로 확정하고 문서 정리 |
| P3-8 | ⬜ | `safety-stock.service.ts:25,64,103` 등 | `run` 람다 파라미터가 바깥 `tx` 와 동명(shadowing) — 무해하나 실수 유발 |

---

## 3. 업무 흐름 공백 (막다른 지점 / 미지원 업무)

| ID | 상태 | 공백 | 비고 |
|---|---|---|---|
| W1 | ⬜ | 창고간 이동의 안전한 엔드포인트 부재 | P0-1 해소 = `POST /movement/inter-warehouse` 를 `TransferService` 2단계 경로로 재배선 (또는 입고예정 연계를 job↔plan FK 로 명시) |
| W2 | ⬜ | 실사 세션 취소 불가 | `cancelled` enum 만 존재(`schema:128`), 세터/라우트 없음 |
| W3 | ⬜ | 실사 complete ↔ generateAdjustments 순서·원자성 미정의 | 확정 전 조정 가능, 확정 후 재조정 가능 — 상태기계로 잠금 (P0-3 과 함께) |
| W4 | ⬜ | 토탈피킹 미구현 | `picking-process.service.ts:89,177,257` throw. `total_picking` 배치는 피킹에서 막힘. 로케이션 전략 seam 은 준비됨 — 스프린트 범위 여부 결정 |
| W5 | ⬜ | 합배송·송장분할(`splitShipment`) 흐름 미구현 | 모델(M:N)만 개방 — RFC Non-Goal. 착수 시 P2-1 선행 필수 |
| W6 | ⬜ | 직배(drop-ship) 별도 엔티티 추출 미착수 | `fulfillmentMode='drop_ship'` 분기 산재(`shipment.service.ts:68`, `fulfillments.service.ts:411,872`, `reservation-retry.worker.ts:89`, `outbound-batch.service.ts:215`). 혼합주문이 단일 FO 로 생성되어 직배 품목이 자사 FO 에 흡수되는 잠재버그 상존 — 별도 워크스트림(RFC 명기) |
| W7 | ⬜ | 발주/공급사 단위 반품(RTV) 부재 | 입고 라인 회송(`returnInbound`)만 존재 |
| W8 | ⬜ | 입고 바코드 검수 ↔ 실입고 단절 | `verifyInboundByBarcode`(`inbound.service.ts:1080`) 가 단순 조회 — 검수 결과가 `receiveFromPlan` 에 연결 안 됨 |
| W9 | ⬜ | 로케이션 capacity 미집행 | 스키마/DTO 에만 존재, 입고/적치/이동 검증 없음 |
| W10 | ⬜ | 운영 확인 필요: `confirm`(출고확정) 이 FO 생성 트리거가 아님 | FO 생성은 OrderCreated 시점 backlog — confirm 은 스냅샷 생성뿐(`sales-orders.service.ts:306-362`). ADR-0010 서술과 어긋남 — 의도 확인 후 문서 또는 코드 정정 |

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

**WS-B. 레거시 경로 은퇴** — P0-1, P0-5, P1-6, P2-11, P3-4, P3-5, W1, W2
inter-warehouse 컨트롤러를 `TransferService` 로 재배선, dead 지뢰(`processExpiredReservations`, `FulfillmentOrderTransactionService` 출고 경로, dead enum, `outbound_tasks`) 제거. destructive 스키마 변경은 expand-contract(ADR-0005 §5) 준수.

**WS-C. 예약 보강** — P1-3, P1-4, P1-5, P2-1, P2-9
reserve 경로 잠금(ledger FOR UPDATE 또는 sku+warehouse advisory lock), adjustDown 예약 고려, FO 예약 타임아웃 정책 + 잔존 모니터링, 소진의 라인 단위 전환, reserved≤on_hand 대사 체크(잡).

**WS-D. 주문/환불 신뢰성** — P1-1, P1-2, P1-7, P1-8, P1-9, P1-10, P2-12, P2-13, P2-15, W10
컨슈머 poison 분류(영구 실패 = skip/DLQ + 운영 격리, Medusa 결제 훅 원칙과 동일), 반품 환불 상태기계 복구 가능화, SO 상태 결정.

**WS-E. 컨벤션/횡단** — P3-1(워커 파싱 제거와 한 세트), P3-2, P3-3, P3-6, P3-7, P3-8, P2-3, P2-5~P2-8, P2-10, W8, W9

권장 착수 순서: **WS-A·WS-B 의 P0 5건 먼저**(재고 무결성) → WS-D 의 포이즌 2건(P1-1/P1-2) → WS-C → 나머지. P0-2 와 P0-3 은 반드시 한 PR 로. P3-1 은 backlog 워커 제어흐름과 얽혀 있으므로 독립 PR + FO 생성 실패 시나리오 회귀 테스트 필수.
