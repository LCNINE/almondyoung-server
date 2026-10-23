# K7 주문 취소 — 호출자는 «무엇을 왜 취소하나»만 말한다

2026-10-24 develop `e50a217b9` 코드 기준. 라이브 실측은 사용자 증언과 K6 백필 결과만 쓴다.
출발점은 구조 감사 `docs/order-logistics-architecture-audit-2026-10.md` §5.3·§8.2 의 K7 이고, §8.1 K3 의
«판매주문의 FO 직접 쓰기 제거» 절반을 함께 한다. K6(ADR-0047)이 깐 라인 수량 문 위에 선다.

## 1. 왜

**사용자가 말한 이유는 사고가 아니라 예방이다.** 물류를 아직 전면 도입하지 않아서 취소 때문에 막힌 순간은 없다.
다만 셀메이트에서 warehouse-app 으로 넘어가면 지금 거의 없는 «상자가 생긴 뒤 취소»가 매일 들어오고, 그때 진입점마다
순서와 규칙이 따로 놀면 구조가 합리적이지 못하게 된다(사용자, 2026-10-24).

이미 그 징후가 있다. 취소의 문 다섯 개가 «와우프레스 인쇄 외주를 어떻게 멈추나 → 취소 적용 → 실패하면 보드 기록 →
환불»을 각자 짠다(§4.1). 인쇄 외주 기능(`d4780e8ed`, 10-14) 뒤 사흘 동안 인쇄×취소 수정이 7건 나왔다. 문마다 따로
패치한 결과다.

## 2. 목표

- **G1. 문은 하나다.** 취소하려는 모든 호출자는 커널을 **한 번** 부르고, 앞뒤에 단계를 붙이지 않는다.
  호출자가 넘기는 건 의도뿐이다: 무엇을(전체 / 라인·수량), 누가, 왜, **요청인지 통보인지**, **환불 방침**(§5.5).
- **G2. 상자 전/후는 커널 안쪽의 일이다.** 호출자는 주문에 상자가 있는지 모른다(사용자). 지금의 «V1/V2» 는
  커널 안에서 뜻이 드러나는 이름으로 바꾼다(사용자: V1 이 레거시처럼 읽힌다 — 현역 경로를 누가 지울 위험).
- **G3. 와우프레스 인쇄 외주는 커널이 다룬다.** 호출자는 인쇄를 모른다. 요청/통보 구분에서 처리 방식이 정해진다(§5.3).
- **G4. 취소 커널은 돈을 만지지 않는다.** Wallet 을 부르지 않는다. 환불 방침이 «즉시»면 취소 커밋과 같은 트랜잭션에
  **환불 요청 한 줄**을 남기고, 실행은 커밋 뒤 결제 쪽이 한다(§5.5).
- **G5. 넘긴 직배송 주문의 취소는 파트너에게 알릴 일로 남는다.** 같은 트랜잭션에 «업체 ○○에 알릴 취소» 한 줄(§5.6).
- **G6. 판매주문 코드는 출고 테이블(FO·FOI·예약)을 직접 쓰지 않는다.** 상자 전 취소도 상자 후처럼 출고 모듈의 명령을 부른다(§5.4).
- **G7. 우회는 가드 spec 이 막는다**(§5.9).
- **G8. 채널 종류와 상관없이 같은 문, 같은 방침표로 돈다.** core 직접 주문은 라이브 0건이지만 생겨도 일관되게 작동해야 한다(사용자).

## 3. 하지 않는 것 · 실패로 보는 것

**범위 밖(사용자 합의 2026-10-24):**
- **환불 실행과 환불 금액 규칙** — 결제 도메인의 일이다(사용자). 보류해 둔 환불 공식 두 벌(부분취소 unitPrice×qty vs 반품
  totalPrice, `partial-cancellation-refund-calculator.ts`)은 K8/결제로 넘긴다. K7 은 «환불을 요청할지»라는 방침만 기록한다.
- **취소와 환불의 원자성, 오케스트레이션(사가·보상 트랜잭션)** — 원하지도 않고 바람직하지도 않다(사용자). 환불이 실패해도
  취소는 되돌리지 않는다. Wallet 은 HTTP 로 부르는 별도 서비스라 원래 한 트랜잭션에 묶을 수 없었고, 지금 코드도 Wallet 실패에
  취소를 되돌리지 않는다.
- **K3 의 취소와 무관한 FO 직접 쓰기 둘** — 직배송 «완료»가 FO 에 `'shipped'` 를 쓰는 것(`direct-ship.service.ts:486`),
  채널 배송지 변경이 FO 배송지를 쓰는 것(`channel-order-change.manager.ts:247`). K3 본편으로 남긴다(사용자).
- **파트너에게 자동 발송(메신저·알림톡)** — 연락처·채널·실패 처리가 붙는 다른 프로젝트다. 이번엔 대기함과 운영자 처리까지(§5.6).
- **파트너가 «이미 보냈다»고 답하는 흐름** — 만들지 않는다. 넘긴 뒤 취소는 우리 쪽에서 확정이고, 이미 보낸 건 업체가 반품으로
  처리한다(사용자: «아쉬운 거지»). 통지는 한 방향이다.
- **반품·교환** — K8.
- **채널 능력을 주문의 사실로 싣기** — #1123. K7 은 이음새(능력 함수)와 임시 방어(대조 가드·fail-closed)만 만든다(§5.8).
- **대기 오퍼레이션 재개 레지스트리** — K4. 상자 후 취소가 «대기»로 끝나는 경우의 재개 구조는 그대로 둔다(§5.4).

**실패로 보는 것(사용자, 2026-10-24):**
- **전형적인 얕은 모듈.** 취소하려는 호출자가 상자 유무·와우프레스·직배송 파트너·환불 실행 주체·잠금 순서·인쇄 보드 기록 중
  하나라도 알아야 하면 실패다. 이름만 커널이고 호출자가 여전히 precheck → gate → cancel → note 를 엮고 있으면 실패다.
- 커널이 Wallet·와우프레스·채널 정산을 끌어와 새 god object 가 되는 것도 실패다. 커널은 «순서와 기록»을 소유하고, 각 일은
  그 모듈의 문을 부른다.

## 4. 지금 지도

### 4.1 취소가 들어오는 문 다섯 개

| 문 | 위치 | 와우프레스 | 취소 적용 | 환불 |
|---|---|---|---|---|
| 고객 셀프 취소 | `store-sales-orders.service.ts:944` `processCancelRequest` | 먼저 **gate**(`keepOnRefusal`). 못 멈추면 «인쇄 빼고 취소» 안내(`PrintPartialCancelAvailableError`) → 고객 동의 시 `excludePrint` 로 재요청 | `cancelRequests.request` 안에서 | 채널 명령(`refundMode: 'auto'`) |
| 관리자 취소 | `store-sales-orders.service.ts:137` `adminCancelRequest` | 먼저 gate. 취소 실패 시 `noteSalesCancelFailed` | 채널 주문: `cancelRequests.request`. core 직접: `salesOrdersService.cancel` | 채널 주문: 채널. **core 직접: 여기서 Wallet** — 전체=자동(`requestWalletRefundAfterCancel`), 부분=`manual_pending`+추정액 |
| 무통장 환불 승인 | `store-sales-orders.service.ts:354` `cancelByWalletIntentAfterRefund` (wallet → core 내부 라우트 `sales-orders.controller.ts:186`) | 취소 **전에** record | `cancelRequests.request` | 이미 끝남 |
| 채널 취소 이벤트 | `order-events.consumer.ts:209` `handleOrderCancelled` | 취소 뒤 `holdUnsent`(트랜잭션 안) → 커밋 뒤 record | `salesOrdersService.cancel` + `cancelSettler.settleCancelled` | 채널 |
| 채널 수량 감소 | `channel-order-change.manager.ts:178` `tryDecrease` | `print_orders` **직접 UPDATE**(`holdUnsentPrint` :216) — savepoint 밖, 거절돼도 남는다 | savepoint 안 `salesOrders.cancel`. 즉시 안 끝나면(박스 대기·출고분 회수) 되돌리고 `pending` | 채널 |

판정만 하는 곳: `planCancellation`(`sales-orders.service.ts:2014`) — `ChannelCancelRequestManager.precheck`(:95)와
고객 `linesWithoutPrint`(store :280)가 부른다.

**core 직접 주문의 고객 셀프 취소는 지금 에러다.** 고객 문은 `cancelRequests.request` 로 가는데, 이 함수는 채널 경로가 `core`
면 `does not take cancel commands` 를 던진다(`channel-cancel-request.manager.ts:124`). 라이브 0건이라 드러나지 않았다.

채널 경로 판정은 `channel-cancel-route.ts`: `medusa` = 명령(`command`), `naver`·`coupang` = 판매자센터(`seller_center`, 관리자 취소
거절·수집으로만 받음), 그 밖 = `core`.

### 4.2 취소 본체 `SalesOrdersService.cancel`(`:487`)의 갈래

`hasV2FulfillmentHistory`(`:1602`)가 가른다: 이 주문의 FOI 가 출고 계획이 만든 상자 줄에 하나라도 올라가 있으면 V2.
(옛 V1 출고는 필요할 때 상자를 열고 `opened_for_fulfillment_order_id` 를 찍었다 — 그 상자는 V2 로 치지 않는다. 옛 방식은 은퇴.)

| 갈래 | 지금 이름 | 하는 일 | 출고 테이블 |
|---|---|---|---|
| 상자 후 | `cancelV2Outstanding`(`:1797`) | 상자별 `ShipmentPlanningService.cancelOutstanding`(`shipment-planning.service.ts:607`) — 출고 명령. 박스 작업 중이면 대기 오퍼레이션 | **출고 모듈이 쓴다** ✓ |
| 상자 전 전체 | `cancel` 본문 | FO `status='canceled'` 직접(`:610`), 예약은 `reservationLifecycle.handleFulfillmentOrderStatusChange`, 백로그 닫기, 디지털 이용권 회수 | **판매주문이 직접 쓴다** |
| 상자 전 부분 | `cancelPartial`(`:1388`) → `adjustFulfillmentForPartialCancellation`(`:2202`) | FOI `qty` 감소·0이면 `'canceled'`(`:2282`), 예약 직접 해제·감소(`:2377`), FO `totalQty`·status(`:1520`) | **판매주문이 직접 쓴다** |

**라이브 취소는 전부 상자 전이다.** K6 PR1 백필(10-20)에서 취소 196주문 전부 `before_shipment` 였다. 셀메이트 시절이라 상자가 안 생겼다.

FOI 취소 표현도 둘이다: 출고 계획은 `canceledQty` 증가, 판매주문 상자 전 부분취소는 `qty` 감소. K6 읽는 문은
`qty − canceled_qty` 로 읽어 둘 다 같은 «요구 수량»이 된다(`line-quantities.sql.ts:173`).

### 4.3 직배송 파트너

운영자가 업체별로 주문을 엑셀·CSV 로 내려받아 넘기고 `forwarded` 로 표시한다(`direct-ship.service.ts:268` `forwardOrdersToCompany`,
:347 `exportOrdersForCompany`). 업체에 자동으로 보내는 연결은 없다. 넘긴 뒤 들어온 취소는 **시스템 어디에도 «알려야 함»이
남지 않는다.** 지금은 운영자가 취소 소식을 모아서 보내거나 메신저로 알린다(사용자).

### 4.4 와우프레스 취소 모듈 (`print-order/services/print-order-cancellation.manager.ts`)

- `cancelForOrder(salesOrderId, mode, lines?, options)` — mode `'gate'`(멈출 수 있으면 멈추고, 못 멈추면 던진다) / `'record'`(멈춰 보고,
  못 멈추면 `cancel_refused` 로 보드에 남긴다). 와우프레스 HTTP 라서 트랜잭션 밖에서 부른다.
- `holdUnsent(salesOrderId, lines, tx)` — 아직 안 보낸 인쇄를 트랜잭션 안에서 붙잡는다.
- `noteSalesCancelFailed(result, cause)` — 인쇄를 멈춘 뒤 판매주문 취소가 실패하면 인쇄 행에 남긴다.

## 5. 설계

### 5.1 문 하나

판매주문 모듈에 커널 하나(가칭 `OrderCancellation`)를 둔다. 공개 표면은 의도를 받는 문 하나와, 요청 전에 «받아들일 범위»를
보여 주는 판정 하나다(고객 «인쇄 빼고 취소» 안내·관리자 모달이 쓴다).

의도에 담기는 것:

| 칸 | 뜻 |
|---|---|
| 대상 | 판매주문 + (없으면 전체) 라인·수량 |
| 종류 | **요청**(아직 거절할 수 있다 — 고객·관리자) / **통보**(이미 취소됐다, 거절할 수 없다 — 채널 이벤트·무통장 승인) |
| 즉시성 | 통보 중 «즉시 끝나지 않으면 아무것도 하지 말고 거절 사유를 돌려라»(채널 수량 감소의 R1 — 새 대기·회수를 만들지 않는다) |
| 요청자 | 고객 / 운영자 / 채널 / wallet 승인 — `cancelled_by`·감사 기록용 |
| 사유 | reasonCode·reasonDetail |
| 환불 방침 | §5.5 |
| 멱등 키 | 호출자의 sourceKey(Idempotency-Key·이벤트 id·`wallet-refund-approval:<intent>`) |
| 출처 시각 | 통보면 채널이 말한 취소 시각 |

결과: 적용된 범위(전체/부분, 라인·수량), 대기로 남은 것(상자 후 취소 대기), 거절 사유(즉시성 거절일 때), 그리고 «인쇄 빼고
취소 가능» 같은 고객 안내 코드. 고객 안내의 에러 코드(`PRINT_PARTIAL_CANCEL_AVAILABLE` 등)는 스토어프론트 계약이라 그대로 둔다.

### 5.2 커널이 소유하는 것

- 잠금 순서(판매주문 → FOI → 열린 상자 → 라인 → 예약, 지금 `channel-cancel-request.manager.ts:128` 주석이 정본)
- 범위 판정(K6 라인 수량 문 `readLineQuantities` 위의 `planCancellation`)과 거절 문구(`CANCEL_MSG_*`)
- 멱등·재전송 판정(`findV2CancellationReplay`·`validateCancellationReplay`·취소 요청 행의 sourceKey)
- 상자 전/후 갈래 선택(§5.4)
- 와우프레스 처리 순서(§5.3)
- 취소 기록(`sales_order_cancellations` + 라인 행 — K6 쓰기 문), 효과 링크(business links), `SalesOrderCancelled` 이벤트, 감사 로그
- 채널 주문이면 채널 취소 요청 행 + `CancelChannelOrder` 명령(지금 `ChannelCancelRequestManager.request` 의 확정 부분)
- 같은 트랜잭션의 환불 요청(§5.5)·파트너 통지(§5.6)
- 디지털 이용권 회수, FO 생성 백로그 닫기(지금 전체취소 본문에 있는 것)

커널이 **부르는** 것(소유하지 않는다): 출고 모듈의 취소 명령, 와우프레스 취소 모듈, 채널 정산 settler. 커널 파일 안에 «이 금액을
환불한다», «이 업체에 이렇게 보낸다» 같은 업무 규칙이 들어오면 §3 의 실패다.

`ChannelCancelRequestManager` 의 정산 쪽(정산 실패 기록·다시 시도·계좌 송금 전환·리컨실러 재발행)은 취소가 아니라 채널 돈의
정산이라 그대로 둔다. 확정(`request`)만 커널 안으로 들어온다 — 빌더가 «커널이 manager 의 확정 함수를 부른다»와 «확정 코드를 커널로
옮긴다» 중 고른다.

### 5.3 요청 / 통보와 와우프레스

**요청(고객·관리자):** 판정 → 와우프레스 **gate**(트랜잭션 밖, 먼저) → 트랜잭션[적용·기록·환불 요청·파트너 통지·이벤트] →
트랜잭션이 실패하면 `noteSalesCancelFailed`. 고객 요청이면 와우프레스 거절을 보드로 넘기지 않고 고객에게 바로 알린다(`keepOnRefusal`).
인쇄 때문에 전체취소를 못 하고 인쇄 외 줄이 남으면 «인쇄 빼고 취소 가능»을 돌려준다. «인쇄 빼고»로 다시 온 요청의 라인 계산
(`linesWithoutPrint` — 살아 있는 인쇄 줄과 디지털 줄을 뺀다)도 커널 안이다.

**통보(채널 취소 이벤트·무통장 승인):** 거절할 수 없으니 받아들이고, 트랜잭션 안에서 안 보낸 인쇄를 붙잡고(`holdUnsent`), 커밋 뒤
와우프레스 **record**(못 멈추면 `cancel_refused` 로 보드). 재전송 이벤트면 `redeliveredSince` 를 넘긴다.

**적용할 수 없는 통보 (설계자 판단):** 통보는 «커널이 거절할 업무 판단이 없다»는 뜻이지 «항상 적용된다»는 뜻이 아니다. 이미 출고된 줄을
취소하라는 채널 이벤트처럼 적용이 불가능하면 지금처럼 도메인 거절을 던지고, 컨슈머는 재시도하지 않아 이벤트 실패 출구(#1016 7·8번,
DLQ·실패 기록)로 간다 — 운영자가 거기서 본다. 출고분은 반품/K8 의 일이다. 결과 타입에 새 갈래를 만들지 않는다.

**즉시성 통보(채널 수량 감소):** 시도하기 전에 해당 라인의 안 보낸 인쇄를 붙잡는다 — **거절돼도 붙잡은 건 남는다**(지금 savepoint 밖
UPDATE 와 같은 효과. 그사이 와우프레스가 원래 수량으로 주문하지 않게). 인쇄 줄이 살아 있으면 거절(`CANCEL_NOT_IMMEDIATE`).
직접 UPDATE 는 와우프레스 모듈의 문으로 바꾼다.

**사용자 결정(2026-10-24):** 요청이면 먼저 멈춰 보고 못 멈추면 거절, 통보면 받아들인 뒤 멈춰 보고 못 멈추면 운영자에게 — «최선의 대응».

무통장 승인은 지금 취소 **전에** record 한다(«돈은 이미 나갔다, 인쇄를 최대한 빨리 멈춘다» store :379). 통보 규칙으로 맞추면 순서가
뒤로 간다. 조건: **통보에서는 커밋이 실패하든 와우프레스가 실패하든 운영자가 볼 곳에 남아야 한다**(돈은 나갔는데 인쇄가 조용히
계속되면 안 된다). 순서는 빌더가 이 조건으로 정한다.

### 5.4 상자 전 / 상자 후 — 이름과 출고 명령

**이름:** `V1`/`V2`, `cancelV2Outstanding`, `hasV2FulfillmentHistory`, `planV2Outstanding`, `findV2CancellationReplay`, 그리고 주석·
spec·테스트 이름의 «V1/V2 취소»를 «상자 전/상자 후»의 뜻이 드러나는 이름으로 바꾼다(예: `beforeBoxing`/`afterBoxing`, 정확한
이름은 빌더). 이름은 커널 안쪽에만 있다 — 호출자 표면에는 갈래가 없다.

**상자 전 취소의 출고 명령:** 출고 모듈에 «아직 상자에 오르지 않은 출고지시 수요를 줄인다» 명령을 하나 둔다(`ShipmentPlanningService.
cancelOutstanding` 의 상자 전 짝). 그 명령이 소유하는 것:
- FOI 취소 수량 — **표현은 `canceledQty` 하나로**(출고 계획과 같은 표현). `qty` 를 깎지 않는다. K6 읽는 문은 `qty − canceled_qty` 라
  읽는 값이 같다.
- 예약 해제(`ShipmentReservationService` 또는 기존 예약 수명주기의 문으로 — 판매주문의 `stock_reservations` 직접 UPDATE 를 없앤다)와
  판매 가능 수량 재계산
- FO status·합계는 **투영**(`fulfillment-progress.service.ts`)으로 정한다. 판매주문이 FO status 를 쓰지 않는다(K3 규칙).

판매주문 쪽에 남는 건 «라인 수량 → SKU 수요 감소분» 계산(구성 `qtyPerUnit`, K6 문)뿐이고, 결과를 출고 명령에 넘긴다.
지금 `adjustFulfillmentForPartialCancellation` 의 «나눠떨어지지 않으면 400» 같은 판정은 그대로 커널 쪽 판정이다.

상자 후 취소가 박스 작업 중이라 **대기**로 끝나는 경우(대기 오퍼레이션 + 리컨실러 재개)는 지금 구조 그대로다. K4 몫.

### 5.5 환불 방침

**사용자 결정(2026-10-24):** 환불은 결제 도메인의 일이다. 취소했지만 환불하지 말아야 할 때와 취소하지 않고 환불해야 할 때가
있다. 관리자가 취소한 뒤 환불을 따로 결정하면 된다. 단 **고객이 직접 취소하면 결제 취소도 바로 되어야 한다.**

요청자가 방침을 정하고, 커널은 기록만 한다:

| 방침 | 쓰는 곳 | 커널이 하는 일 |
|---|---|---|
| **즉시** | 고객 셀프 취소 | 취소 커밋과 **같은 트랜잭션에** 환불 요청 한 줄(outbox 또는 요청 행). 실행은 커밋 뒤, 취소 id 로 멱등 |
| **나중에 결정** | 관리자 | «결제됐고 환불 결정 전»이 남는다 → 관리자 목록 |
| **이미 함** | 무통장 환불 승인 | 아무것도 안 남긴다(기록에 «이미 환불됨») |
| **채널이 함** | 채널 취소·수량 감소 이벤트 | 아무것도 안 남긴다 |

**환불 방침은 결제를 core 가 쥔 주문에만 효과가 있다(사용자 결정 2026-10-24).** Medusa 는 커머스 엔진이라 주문 취소 안에 결제 취소가
들어 있다. 그 모델을 거스르지 않는다 — 채널 주문이면 요청자가 누구든 «채널이 함»으로 귀결되고, 커널은 지금처럼 `CancelChannelOrder`
를 낸다(`refundMode: 'auto'`, ADR-0042·0044). **Medusa 관리자 취소도 지금처럼 즉시 환불된다.** Medusa 코드·라이브 동작은 바뀌지 않는다.
«취소와 환불은 다른 일»은 core 취소 커널의 원칙이다 — 커널은 어떤 주문이든 돈을 만지지 않고, 돈을 쥔 쪽이 자기 규칙으로 정산한다.
Medusa 주문에서 «취소 따로, 환불 따로»가 필요한 경우는 이미 길이 있다: 무통장 승인(이미 환불), 부분취소의 «이미 환불한 금액» 상계.
core 직접 주문은 결제 쪽(Wallet)이 실행한다.

**보장하는 건 하나다:** «고객 취소가 커밋되면 환불 요청은 반드시 남는다» — 프로세스가 취소와 환불 사이에서 죽어도 사라지지 않는다.
원자성도 보상도 없다(사용자). 환불이 막히면 «나중에 결정»과 같은 관리자 목록에 실패로 뜨고 거기서 다시 시도한다.

**«즉시»의 금액 (설계자 판단, 사용자 확인 전):** 환불 요청 행에는 금액을 담지 않고 취소 id 만 담는다 — 금액은 결제 쪽이 정한다.
core 직접 주문의 고객 **전체**취소는 지금 관리자 전체취소가 쓰는 금액(`totalAmount`)으로 실행된다. 고객 **부분**취소(«인쇄 빼고 취소» 등)는
자동 금액 규칙이 아직 없으므로(K8 보류) 실행자가 금액을 정하지 못하고 «환불 결정 전» 관리자 목록으로 떨어진다 — 요청은 남고 사라지지
않는다. K8 이 부분취소 금액을 정하면 그때 자동이 된다. `partial-cancellation-refund-calculator` 를 자동 실행에 쓰지 않는다.

**관리자 목록:** «취소됐고 결제됐는데 환불이 결정·완료되지 않은 주문». 지금도 부분취소는 `manual_pending` 환불 링크로 비슷한 일을
하고, 주문 내역 화면에 환불 필터가 있다(`admin-web/src/features/order/history/hooks/refund-filter.utils.ts`). 이것을 전체취소와
실패까지 넓히는 형태가 자연스럽다(빌더 확인). 목록에서의 결정 동작(환불 실행·환불 안 함)은 기존 동작(`retryWalletRefund`·수동 환불
완료 확인)을 쓰고, **금액 규칙은 건드리지 않는다**(K8/결제).

**이 결정으로 바뀌는 지금 동작:** core 직접 주문의 관리자 전체취소가 Wallet 자동 환불을 더 이상 부르지 않는다(§6 D2).

### 5.6 직배송 파트너 통지 대기함

**사용자 결정(2026-10-24):** 대기함 방식. 넘기는 흐름과 같은 모양으로 모아서 보낸다. 자동 메신저는 나중에 같은 대기함에 붙인다.

- 넘긴(`forwarded`) 직배송 출고지시가 걸린 취소가 커밋되면, 같은 트랜잭션에 «업체 ○○에 이 취소(주문·라인·수량)를 알려야 함» 행을 남긴다.
- admin-web 직배송 화면(`app/(admin)/order/direct-ship/page.tsx`)에 업체별 「알릴 취소」. 운영자는 엑셀로 내려받거나(주문 내보내기와
  같은 모양) 보고 메신저로 보낸 뒤 «알림 완료». 알리지 않은 지 오래된 건 눈에 띄게.
- 통지는 한 방향이다. 업체 응답을 받는 상태는 없다.
- 넘기기 **전**(`pending`) 직배송 취소는 지금처럼 출고지시에서 빠질 뿐 통지할 게 없다.

### 5.7 문 다섯 개는 이렇게 된다

| 문 | 커널에 넘기는 의도 |
|---|---|
| 고객 셀프 취소 | 요청 · 고객 · 환불 즉시 (· «인쇄 빼고» 재요청이면 그 표시) |
| 관리자 취소 | 요청 · 운영자 · 환불 나중에 결정(core 가 돈을 쥔 주문에만 효과 — 채널 주문은 채널이 정산) (· Medusa 부분취소의 «이미 환불한 금액») |
| 무통장 환불 승인 | 통보 · wallet 승인 · 환불 이미 함 |
| 채널 취소 이벤트 | 통보 · 채널 · 환불 채널이 함 · 출처 시각·이벤트 id |
| 채널 수량 감소 | 즉시성 통보 · 채널 · 환불 채널이 함 |

고객 셀프 취소의 «셀프 취소 차단» 판정(`selfCancelBlockOf`, 진행 단계 기반)은 «고객에게 이 버튼을 보여 주나»라는 화면 판정이라
고객 문에 남아도 된다. 다만 같은 판정이 커널 거절과 어긋나면 안 된다 — 빌더가 둘이 같은 근거(K6 진행 단계·라인 수량 문)를 읽는지 확인한다.

### 5.8 채널 능력 — 이름이 아니라 능력을 읽는다

**사용자 결정(2026-10-24):** core 는 채널의 세부사항을 알 필요가 없다. 본편은 «채널 능력을 주문의 사실로 싣는다»(#1123)이고,
K7 은 그 이음새와 임시 방어만 만든다.

core 가 채널에 대해 알아야 하는 건 능력 셋뿐이다: ① 취소를 명령으로 보낼 수 있나 / 판매자센터에서만 / core 직접, ② 돈을 누가
정산하나(채널 / core·Wallet), ③ 부분취소 «이미 환불한 금액» 상계를 받나(ADR-0043). 지금은 ①만 표(`channel-cancel-route.ts`,
channel-adapter `channel-capabilities.ts` 의 손 사본)로 있고, 나머지는 `salesChannel === 'medusa'` 리터럴로 흩어져 있다
(`channel-cancel-request.manager.ts:66`, `self-cancel-block.ts:35`, `store-sales-orders.service.ts:341·364`).

K7 이 하는 것:
- **능력을 읽는 함수 하나**(«이 주문의 취소 능력»). 커널과 문들은 이것만 부른다. 지금은 채널 이름으로 표를 찾고, #1123 뒤에는 주문에
  저장된 사실을 읽게 안쪽만 바뀐다 — 이게 이음새다.
- **모르면 거절(fail-closed).** 지금 «표에 없는 채널 → core 직접»(`channel-cancel-route.spec.ts` 의 `cafe24 → core`)을 없앤다. 알려진
  채널(`sales_channel` enum: `medusa`·`naver`·`coupang`·`3pl`)은 전부 표에 명시한다. `3pl` 은 지금 `core` 로 떨어지는데, 명시적으로 같은
  값으로 적는다(동작 변경 없음 — `3pl` 의 돈을 누가 쥐는지는 빌더가 확인해 표에 적는다).
- **대조 가드.** 루트 jest 가 core 표와 channel-adapter `CHANNEL_CAPABILITIES` 를 같이 읽어 ①(`automatedCancellation`)이 어긋나면 빨갛다.
  #1123 이 끝나면 지운다.
- 취소 경로에서 채널 이름 리터럴을 없앤다. 스토어프론트 고객 조회의 `'medusa'`(`store-sales-orders.service.ts:563` 등, «우리 스토어프론트
  주문»이라는 다른 뜻)와 환불 계산기의 `'medusa'`(K8)는 범위 밖.

### 5.9 가드

`@CronOnce` 가드·K6 `line-quantity-read.guard.spec.ts` 와 같은 방식. 빨개지는 것:
- 커널 밖에서 판매주문 취소 적용 함수(지금 `SalesOrdersService.cancel`)·`planCancellation` 을 부르는 것
- 커널 밖에서 와우프레스 취소 문(`cancelForOrder`·`holdUnsent`·`noteSalesCancelFailed`)을 취소 목적으로 부르는 것, `print_orders` 를
  판매주문 코드에서 직접 UPDATE 하는 것
- 판매주문 모듈 코드가 `fulfillment_orders`·`fulfillment_order_items`·`stock_reservations`·`shipments`·`shipment_lines` 에 직접 쓰는 것
  (K3 본편 두 곳 `channel-order-change.manager.ts:247` 배송지·`entrance-password-cleaner.ts` 는 명시적 예외 목록으로 시작 — 예외 목록이
  줄어드는 방향만 허용)
- 커널이 Wallet 클라이언트를 import 하는 것
- 취소 경로(커널·문 다섯 개)에서 채널 이름 리터럴로 판정하는 것(§5.8), core 능력 표와 channel-adapter 능력 표의 어긋남

## 6. 이름 붙은 동작 변경

| | 변경 | 라이브 영향 |
|---|---|---|
| D1 | core 직접 주문의 고객 셀프 취소가 에러 대신 동작한다(취소 + 즉시 환불 요청) | 0 (core 직접 주문 0건, 사용자) |
| D2 | core 직접 주문의 관리자 전체취소가 Wallet 자동 환불을 부르지 않는다 → 관리자 목록 «환불 결정 전» | 0 |
| D3 | 상자 전 부분취소의 FOI 표현이 `qty` 감소에서 `canceledQty` 증가로 | 화면·통계는 K6 문(`qty − canceled_qty`)이라 같음. `qty` 를 직접 읽는 곳이 남았는지 빌더가 확인 |
| D4 | 상자 전 취소의 FO status 가 판매주문 직접 쓰기 대신 투영으로 | 투영 어휘와 같으면 0. 다르면 빌더가 나열 |
| D5 | 넘긴 직배송 주문 취소가 파트너 통지 대기 행을 남긴다 | 새 행만 생김 |
| D6 | 무통장 승인의 와우프레스 처리가 통보 규칙으로(§5.3) | 순서만, 조건 충족 시 결과 같음 |
| D7 | 채널 수량 감소의 인쇄 붙잡기가 직접 UPDATE 에서 와우프레스 모듈 문으로 | 0 |
| D8 | 능력 표에 없는 채널은 «core 직접» 대신 거절(§5.8) | 0 (enum 네 값 전부 표에 명시) |

## 7. 진행 (제안, 빌더가 계획에서 확정)

K6 처럼 PR 마다 계획을 따로 쓴다. 제안 순서:
1. **이름 바꾸기 + 커널 껍데기 + 능력 함수** — V1/V2 → 상자 전/후. 커널 문을 만들고 문 다섯 개를 커널로 옮기되 안쪽은 지금 코드를 그대로 부른다. 능력 함수·대조 가드·D8. 가드(호출자 고정) 추가.
2. **와우프레스 순서를 커널로** — 요청/통보 규칙, D6·D7.
3. **상자 전 취소의 출고 명령** — G6, D3·D4. 가드에 «판매주문이 출고 테이블 직접 쓰기 금지» 추가.
4. **환불 방침** — D1·D2, 관리자 목록.
5. **파트너 통지 대기함** — D5, admin-web 화면. 새 테이블이면 expand 마이그(`migrate → deploy`).

## 8. 빌더에게 맡기는 것

- 커널 이름·파일 위치·의도 타입의 정확한 모양
- 상자 전/후의 정확한 이름
- `ChannelCancelRequestManager.request` 의 확정 부분을 옮길지 부를지
- 환불 요청을 outbox 이벤트로 남길지 요청 행으로 남길지, 실행자(core 컨슈머가 Wallet 을 부르는지 등) — §5.5 의 보장만 지키면 된다
- 파트너 통지 행의 저장 위치(새 테이블 / 기존 링크 테이블)
- 무통장 승인 와우프레스 순서(§5.3 의 조건 안에서)
- `selfCancelBlockOf` 와 커널 판정의 근거 일치 확인

## 9. 배포

배포 단위: Core(전 PR), admin-web(4·5). 마이그가 생기면 additive 라 `migrate → deploy`. 배포 전 게이트는 PR 별 계획에서 정한다.
확인할 후보: 옛 방식 상자(`opened_for_fulfillment_order_id` 가 찍힌 상자)를 가진 진행 중 주문 수 — 0 이 아니면 그 주문은 상자가 있어도
상자 전 갈래로 간다(지금과 같음, 확인만).

## 10. 진행

- PR 1 (이 PR): 커널 껍데기·이름·능력 표 — 동작 변경 없음(D8 제외).
- PR 2: 와우프레스 순서 — 통보 세 문의 받아들이기·붙잡기·커밋 뒤 record(D6·D7), 채널 취소 수신을 한 번 부르기.
