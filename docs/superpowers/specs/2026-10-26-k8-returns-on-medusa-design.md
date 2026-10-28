# K8 — 반품·교환은 Medusa 의 주문 변경으로, 창고 일은 core 원장으로 — 설계

- 날짜: 2026-10-26
- 출발점: `docs/order-logistics-architecture-audit-2026-10.md` §8.2 K8 («환불 금액 정책 + 반품·교환 수명주기»)
- 대화로 정한 것은 «결정»에, 설계자가 정한 것은 «설계자 판단»에 따로 적는다.

## 1. 왜

### 1.1 업무

반품은 이 시스템에서 한 번도 처리된 적이 없다. 레거시 시스템 시절에는 한진에 회수를 접수하고, 창고에 도착한 물건을
검수해 다시 팔 수 있으면 재고로 넣고 아니면 불량으로 돌렸다. 지금은 운영자가 wallet 관리자 화면에서 금액을 직접 넣어
환불한다 — 반품비 차감도 사람이 계산해 사유 칸에 적는다(「반품비 2,500원 차감 후 환불」).

원하는 것은 «상식적으로 작동하는 반품과 환불»이다: 고객이 신청하면 우리가 회수를 접수하고, 창고에 도착하면 반품
입고하고, 검수한 뒤 환불이 나간다. 택배비는 사유에 따라 누가 내는지 정해진다.

### 1.2 코드 — 반품 모델이 두 벌이고 둘 다 한 번도 안 돌았다 (2026-10-26 라이브 실측, 읽기 전용)

| 무엇 | 라이브 |
| --- | --- |
| core `return_requests` · `exchange_requests` · `return_refund_attempts` | 0행 |
| core inventory `returns` · `return_items` (`inventory/core/services/return.service.ts`) | 0행 |
| Medusa `return` · `order_exchange` · `order_claim` | 0행 |
| wallet `refunds.kind = 'RETURN'` (운영자가 wallet 에서 직접) | 26건 · 674,510원 (6~10월) |

- 판매주문 쪽 core 반품(`store-return-exchange.service.ts`)은 Medusa 주문의 환불을 **core 가 직접 Wallet 으로** 낸다.
  취소는 Medusa 가 돈을 쥔다(`channel-cancellation-capability.ts` 의 `medusa.settlesMoney = 'channel'`) — 반대 방향이다.
- 상태 전이는 «읽고 나서 쓰기»에 직전 상태 CAS 가 없고, 반품·교환 사다리가 복붙 두 벌이다. 교환을 완료해도 새 물건이
  나가지 않는다(`desiredVariantId` 를 읽는 코드 0).
- inventory 쪽 반품은 도착한 물건을 `return_default` 위치에 **`ON_HAND` 로 `RECEIVE`** 한다. 판매성은 창고 단위
  (`inSellableWarehouse`)라 검수 전부터 판매가능수량에 잡힌다.
- 원장 `stock_state` 는 `ON_HAND`·`DEFECTIVE`·`IN_TRANSFER` 셋뿐이고, 첫 커밋부터 «반품» 상태가 없었다.
  원장에는 from→to 전이 검증 맵이 없다(DB CHECK 만).
- 반품 수량과 출고 후 취소 수량이 서로를 빼지 않는다(`lineRemainingSql` 이 반품을 모른다) — 같은 수량에 두 번 환불이 열린다.

### 1.3 «환불 공식 두 벌»은 돈 문제가 아니었다

감사 문서가 보류한 «부분취소 `unitPrice×qty` vs 반품 `totalPrice`»는 라이브에서 금액 차이 0원이다(라인 37,424개 전부
`total_price = unit_price × quantity`, 부분취소 13건 두 공식 결과 동일). 그리고 core 의 부분취소 계산기
(`partial-cancellation-refund-calculator.ts`)는 `settlesMoney = 'core'` 인 `3pl` 주문(0건)에서만 돈다.
**라이브 주문의 부분취소 환불은 Medusa 워크플로(`apps/medusa/src/workflows/orders/partial-cancel/`)가 이미 자동으로 한다** —
상품 단위 할인 비례 배분, 주문 시점 배송비 정책 스냅샷(`policySnapshot`)으로 무료배송 재계산, 앞선 환불 상계, auto/manual.
그래서 K8 의 «금액 정책»은 새로 만들 것이 아니라 **이 Medusa 정산 도구를 반품이 같이 쓰게 하는 일**이다.

## 2. 목표 · 비목표 · 반목표

### 목표

1. 고객이 스토어프론트에서, CS 가 관리자 화면에서 반품을 신청한다. 반품 기록과 돈은 Medusa 의 주문 변경(Return)이 소유한다.
2. 우리가 한진에 회수(`svcCatCd = 'R'`)를 접수한다.
3. 창고에 도착하면 원장에 «반품» 상태로 들어간다 — 판매가능수량에 잡히지 않는다.
4. 검수가 «반품 → 출고가능(반품양품)» 또는 «반품 → 불량»으로 원장을 옮기고, 그 결과를 Medusa 에 «수령»으로 알린다.
5. 수령이 확정되면 환불이 자동으로 나간다(무통장·Wallet 거절이면 수동으로 떨어진다). 택배비는 사유 규칙대로 뺀다.
6. 같은 사유 규칙을 Medusa 부분취소에도 적용한다(지금은 품절 취소에도 배송비를 뺀다).
7. 교환·클레임도 같은 길 위에 «새 물건 출고»를 더해 연다(뒤 PR).
8. core 의 옛 반품·교환 코드와 inventory 반품 코드를 걷어낸다.

### 비목표

- 네이버·쿠팡 주문의 반품. 그 채널은 판매자센터가 처리한다(`settlesMoney = 'channel'`, 채널 클레임 API 는 별개).
- core 정산(`3pl`) 주문의 취소 환불 정리 — K7 이월 둘(결정 대기 환불 둘 중 남은 건의 «환불 실행», 반품 환불 Wallet 가드 예외)과
  #1023 의 core 쪽 접기. 닿는 주문이 0건이다. #1023 의 core 호출자는 이 작업으로 반품 쪽이 사라져 `3pl` 취소만 남는다.
- 반품 사유별 «반품 불가 상품» 정책(인쇄 상품 제외 등은 #1070 의 축).
- 무통장 환불의 계좌 수집 화면. wallet 의 MANUAL(송금 대기) 경로를 그대로 쓴다.

### 반목표 — 이렇게 되면 동작해도 실패다

- 로그인 없이, 또는 남의 주문으로, 또는 고객이 정한 반품비로 반품이 만들어진다.
  (Medusa 기본 `POST /store/returns` 가 정확히 그렇다 — 인증·소유 확인 없음, `return_shipping.price` 를 클라이언트가 정함.)
- 검수 전 반품 물건이 판매가능수량에 잡힌다.
- 물건이 도착·검수되기 전에 환불이 나간다(CS 가 수동으로 내는 경우는 예외).
- 같은 수량이 취소와 반품으로 두 번 환불된다.
- Medusa 대시보드에서 반품을 받아 우리 정산(잠금·종류 표지·택배비 규칙)을 우회한다.
- core 와 Medusa 가 «돌아온 수량»을 서로 다르게 알고, 아무도 그 어긋남을 모른다.

## 3. 결정 (대화에서 정한 것)

| # | 결정 |
| --- | --- |
| D1 | **Medusa 가 반품·교환·클레임 기록과 돈을 소유한다. core 는 창고 일(반품 입고 → 원장 «반품» → 검수 → Medusa 에 수령 알림)과 한진 회수를 맡는다.** «Medusa 는 커머스 엔진으로서의 역할을 해내야 한다.» |
| D2 | 원장에 «반품» 상태를 둔다. 출고가능이 아니다. 검수가 «반품 → 출고가능» 또는 «반품 → 불량»으로 옮긴다. |
| D3 | 환불은 검수 뒤에 나간다. 가능하면 자동. |
| D4 | 택배비는 사유가 정한다. **고객 사정(단순 변심)**: 반품 택배비를 고객이 내고, 남는 주문이 무료배송 기준 아래로 떨어지면 처음 면제한 배송비도 뺀다. **판매자 잘못(하자·오배송·설명과 다름·배송 중 파손)**: 빼지 않는다. 출고 전 취소는 반품 택배비 없이 무료배송 깨짐만 적용한다. |
| D5 | 고객 신청은 기한 안에서만(물건 받은 날부터 7일, 전자상거래법 청약철회). **CS 접수는 기한을 넘겨도 받고 넘긴 사유를 남긴다** — «CS 는 모든 코너 케이스의 종착지». |
| D6 | 반품 사유와 반품용 배송 옵션은 시드로 보장한다. |
| D7 | 설계 문서 하나, PR 여러 개. 전부 이어서 한다. 금액·Medusa 흐름과 커널은 끝까지 설계하고, 화면·한진·교환은 «커널의 어느 문을 부르는지»와 열린 질문까지 적는다. |
| D8 | core 의 옛 반품·교환 코드(판매주문·inventory 둘 다)는 걷어낸다 — 라이브 0행이라 옮길 데이터가 없다. |
| D9 | **반품은 core 출고 개통(warehouse-app + 한진) 뒤에 연다.** 셀메이트 시기에는 열지 않는다 — 그동안은 지금처럼 CS 가 처리한다. PR 은 순서대로 만들어 둔다. (근거: 4.0) |
| D10 | 검수 결과는 셋이다: **양품**(→ 출고가능), **불량**(→ 불량, 환불), **환불 보류**(CS 판단 — 단순 변심인데 사용·훼손, 다른 물건 등). 보류 건은 CS 가 정산 라우트로 차감액과 메모를 넣어 끝낸다. 요청보다 적게 오면 도착분만 정산하고 나머지는 CS 가 닫을 때까지 남는다. **CS 가 도착 전에 먼저 환불하는 것도 같은 정산 라우트(«선환불»)로 낸다** — wallet 직접 환불은 Medusa 가 몰라 검수 뒤 이중 환불이 된다. |

## 4. 모양

### 4.0 개통 조건 — 셀메이트 시기에는 반품 가능 수량이 0이다 (D9)

2026-10-26 라이브(최근 30일): 상자 `shipped` 785 · `delivered` 131, 그러나 `dispatch_attempts` 0행, 원장 `SHIP` 이벤트 0행.
셀메이트가 출고 전 과정을 하고 스크립트가 결과만 밀어 넣기 때문이다. core 의 배송완료 수량(K6 `deliveredParcelsSql`)은
«`dispatched` 출고 시도 × 그 시도의 `delivered` 추적»으로 세므로 **지금 모든 라이브 주문의 반품 가능 수량은 0** 이다.
원장도 출고로 줄어든 적이 없어, 반품을 원장에 넣으면 재고가 부푼다.

그래서 이 설계는 core 출고 개통 뒤를 전제로 한다. 따로 기능 플래그를 두지 않는다 — 반품 가능 수량이 0이면 고객 라우트와
CS 라우트가 둘 다 거절하므로, 개통 전에는 자연히 닫혀 있다. **CS 의 기한 넘김(D5)은 날짜만 넘기고 수량은 넘기지 않는다.**

### 4.1 한 장 그림

```
고객/CS ──(우리 Medusa 라우트)──▶ Medusa Return 요청·확정 ──(폴링: ChannelReturnRequested)──▶ core «반품 예정»
                                         │                                                      │
                                         │                                           한진 회수 접수(R) (뒤 PR)
                                         │                                                      │
                                         │                                           창고 도착: 원장 null → RETURNED
                                         │                                           검수:     RETURNED → ON_HAND | DEFECTIVE
                                         │                                                      │
Medusa 정산: 수령(양품/불량) + 택배비 + 환불 ◀──(channel-orders 명령)── core «검수 끝, 수령 알림»
         │
         └─(channel-adapter 폴링: OrderRefundCreated 등)──▶ core 고객 이벤트(SalesOrderClaimProgressed·SalesOrderReturned)
```

경로는 지금 취소가 쓰는 것과 같다: core→Medusa 는 `channel-orders.commands.v1` 명령을 channel-adapter 가 받아 Medusa 관리자
라우트를 부르고(`medusa.client.ts`), Medusa→core 는 channel-adapter 가 Medusa 를 5분마다 폴링해 `orders.events.v1` 로 낸다
(`medusa-order.source.ts`). Medusa 는 Kafka 를 직접 쓰지 않는다.

### 4.2 Medusa — 반품을 여는 문 (설계자 판단 포함)

**기본 라우트는 막고 우리 라우트를 둔다.** 문서가 권하는 순서(추가데이터 → 훅 → 미들웨어 → 구독 → 라우트 복제)로 보면,
반품 워크플로에는 훅이 거의 없고(`createAndCompleteReturnOrderWorkflow.hooks.setPricingContext` 하나) 미들웨어로는
«서버가 정한 반품비»·«기한»·«사유별 부담 주체»를 넣을 수 없다. 그래서:

- `POST /store/returns` 는 미들웨어로 거절한다(문서 «Restrict Return Creation» 의 미들웨어 방식, 정확한 method·matcher).
  이유: 인증·소유 확인이 없고, 반품비를 클라이언트가 정하고, `receive_now` 는 반품 품목이 아니라 주문 전체를 입고하려 든다
  (`core-flows/dist/order/workflows/return/create-complete-return.js:279-284`).
- 관리자 쪽 반품·교환·클레임 **쓰기** 라우트(`/admin/returns/**`, `/admin/exchanges/**`, `/admin/claims/**` 의 POST·DELETE)도
  미들웨어로 거절한다. 읽기는 둔다. 대시보드로 받으면 우리 정산(잠금·환불 종류·택배비 규칙)을 우회하기 때문이다(반목표).
  지금 이 라우트들에 걸린 우리 미들웨어는 없다.
- 우리 라우트는 다른 경로에 «복제»한다(override 아님). 코어 워크플로를 엮어 쓴다 — 지금 부분취소가 order edit 워크플로를
  엮는 방식과 같다.

**우리 워크플로 셋** (이름은 빌더 몫):

1. **반품 요청** — 고객용 store 라우트(로그인 + 주문 소유자 + 기한)와 관리자용 admin 라우트(CS, 기한 넘김 허용 + 넘긴 사유 필수).
   - 입력: 주문, 품목·수량, 사유(Medusa `ReturnReason`), 메모.
   - 하는 일: `beginReturnOrder` → `requestItemReturn` → 반품 배송 방법 추가(`custom_amount = 0`) → `confirmReturnRequest` 를
     한 번에. 반품 요청 주문 변경을 열어 둔 채로 두지 않는다 — 한 주문에 열린 주문 변경은 하나뿐이라(`order-module-service.js:1015-1037`)
     열어 두면 그동안 부분취소가 막힌다.
   - **반품 배송비를 요청 때 매기지 않는 이유**: `confirmReturnRequest` 는 `pending_difference > 0` 이면 새 결제 컬렉션(NOT_PAID)을
     만든다(`create-or-update-order-payment-collection.js:84-94`). 고객에게 «결제할 돈»이 생긴 것처럼 보인다. 택배비는 4.4 의 정산에서 뺀다.
   - 반품 가능 수량과 기한의 근거는 core 다(Medusa 는 배송완료일·소포를 모른다 — 빌더가 확인할 것). 설계자 판단: core 내부 API 가
     라인별 «반품 가능 수량»(K6 `claimable` 의 후신)과 «받은 날»을 주고, Medusa 라우트가 그것으로 판정한다.
     **PR 3 에서 확정한 결과.**
     - (N2) core 는 «청구를 빼기 전» 사실만 준다 — 줄마다 `deliveredUnits`·`lastDeliveredAt`. K6 `claimable` 은 쓰지 않는다(PR 5 가 반품 예정 기록에 다시 이으면 두 번 빠진다).
       반품으로 빠진 수량은 Medusa 가 자기 반품 기록으로 뺀다: `min(deliveredUnits, item.quantity) − (requested + received + dismissed)`.
     - (N1) Medusa 는 출고를 모른다 — `fulfilled_quantity` 가 0 이라 코어 검증(`quantity ≤ fulfilled − return_requested`)이 막는다.
       반품 요청 직전 **반품이 잡는 수량만큼만** `registerFulfillment` 로 올리고, 반품 취소 때 되돌린다. 배송완료 전부를 올리면 주문 수정이 그 아래로 수량을 못 줄인다.
       출고 기록으로 Medusa 가 배송 사실을 알게 하는 길은 #1148.
2. **반품 취소** — 도착 전에만. `cancelReturn` + (회수 예약이 있으면) core 가 한진 예약을 취소한다.
3. **반품 정산** — core 의 «검수 끝» 명령만 부른다(4.4).

**반품용 배송 옵션과 provider.**
- 반품 배송 방법은 `is_return` 규칙이 켜진 옵션에서만 만들 수 있다. 라이브에는 0개다.
- `provisionShippingGroup` 은 같은 shipping profile 의 다른 옵션을 전부 지운다(`provision-shipping-group.ts:187-196`).
  그래서 반품 옵션은 **배송비 그룹 profile 밖, 전용 profile(type `return`) 하나에 하나만** 둔다 — 그 함수가 지울 길이 아예 없다
  (PR 2 계획 N1. 처음엔 «그 함수 안에서 그룹 옵션과 함께 보장»이었다). 코어의 반품 배송 방법 생성은 profile 을 검사하지 않고,
  반품 택배비는 옵션이 아니라 `policySnapshot` 으로 계산하므로(4.4) 그룹마다 옵션이 있을 이유가 없다. 시드(`seed-shipping.ts`, 멱등)로
  보장한다. Medusa 컨테이너는 뜰 때마다 `package.json` 의 `start` 로 시드를 돌린다.
- 반품 옵션이 없으면 요청 워크플로가 거절하고 이유를 남긴다(시드 누락이 조용히 깨지지 않게).
- `almond-fulfillment` provider 에 `createReturnFulfillment` 가 없다 — 기본 클래스는 던진다(`utils/dist/fulfillment/provider.js:338-340`).
  `{ data: {}, labels: [] }` 를 돌려주는 구현을 넣는다. 한진 회수는 Medusa 가 아니라 core 가 접수한다(한진 클라이언트·HMAC·설정이 core 에 있다).
- 반품 옵션의 가격 계산(`calculatePrice`)은 옵션 data 에 정책이 없으면 던진다(`service.ts:120-129`). 반품 옵션은 0원 고정
  (`custom_amount` 로 덮음)으로 두고 이 경로를 타지 않게 한다 — 방법은 빌더 몫.

**반품 사유 시드.** Medusa `ReturnReason` 6종: 단순 변심 · 하자 · 설명과 다름 · 오배송 · 배송 중 파손 · 기타.
각 사유의 `metadata` 에 부담 주체(`customer` / `seller` / `operator`)를 둔다. core 의 옛 `return_reason_code` 6종과 같은 집합이다.
스토어프론트는 기타를 빼고 다섯만 보여 준다. 기타는 CS 접수 전용이고, CS 가 **접수할 때** 부담 주체를 고른다 — 정산이 사람을
기다리며 멈추지 않게(설계자 판단). 부담 주체는 반품 기록(`metadata`)에 남고 정산이 그것을 읽는다.

**Medusa→core 호출이 처음 생긴다.** 지금 medusa 코드에는 core 를 부르는 클라이언트가 없다. 자격 API 는 P0 내부 API 인증을 쓰고,
core 가 응답하지 않으면 반품 신청이 실패한다(재시도 안내) — 받아들인다(설계자 판단). 자격을 Medusa 에 미리 복제하지 않는다.

### 4.3 core — 반품 예정과 창고 일

**반품 예정 기록(새 테이블, 이름은 빌더 몫 — 예: `customer_returns` + 줄).** core 가 창고 일과 한진 회수의 닻으로 쓴다.
Medusa return id 를 유일키로 갖는다. 운송장 테이블은 `waybills.shipment_id NOT NULL` 이라 출고 상자에 묶여 있어 회수 운송장의
닻이 될 수 없다 — 이 테이블이 그 자리다.

상태 사다리(설계자 판단): `expected`(Medusa 에서 확정 관측) → `arrived`(창고 도착, 원장 RETURNED) → `inspected`(검수 끝,
원장 이동 끝, 수령 알림 냄) → `refund_pending`(Medusa 수령 확정, 환불이 «실패»로 남아 CS 가 다시 해야 함) → `settled`(환불 성공 —
auto 든 wallet «송금 대기»인 manual 이든 — 또는 수동 완료) / `canceled`(도착 전 취소). 환불이 바로 성공하면 `inspected` 에서 `settled` 로
곧장 간다. manual 도 `settled` 다(취소 정산이 manual 을 `applied` 로 닫는 것과 같다 — PR 6 결과의 N17).
검수에 «환불 보류»가 하나라도 있으면 `inspected` 대신 `held`(CS 판단 대기)로 가고, 수령 알림은 CS 가 차감액을 넣을 때 낸다(D10).
요청보다 적게 오면 도착한 줄만 `arrived` 이후로 가고, 나머지 줄은 CS 가 «미도착으로 닫기»를 할 때까지 남는다 — 닫아도 Medusa
반품의 남은 품목은 취소하지 않는다(아래 PR 6b 결과). 기록 단위 상태는 줄 상태에서 유도하든 따로 두든 빌더 몫이되, «아직 안 끝난 줄이 있는 반품»이
목록에서 보여야 한다. 전이는 K2 처럼
**직전 상태 CAS** 한 함수가 소유하고, 트랜잭션은 `db.run(fn, tx)` 로 전파한다(ADR-0025). 옛 core 반품의 «읽고 나서 쓰기»를
되풀이하지 않는다.

- **받는 창고**: 원래 출고한 창고의 `return_default` 위치(설계자 판단). 오늘 고객 출고는 `부천 물류창고`(판매 창고) 한 곳이고,
  라이브 창고 넷 모두 `return_default` 위치가 있다(2026-10-26 실측).
- **세트 상품**: 검수는 SKU 단위(원장 단위)로 받는다. Medusa 에는 판매 라인 단위로 알린다 — 세트 한 벌은 구성품이 전부 양품이면
  양품, 하나라도 불량이면 불량(설계자 판단). Medusa 쪽 환불 금액은 양품·불량이 같아 이 선택이 돈을 바꾸지 않는다.
- **직배(K3 입점사 상자) 품목**: 이번 개통에서는 고객 신청 대상에서 뺀다(자격 API 가 0 을 준다). CS 가 시스템 밖에서 처리한다.
  우리가 재고로 가진 적이 없는 물건이라 원장에 넣으면 유령 재고가 된다. 직배 반품은 입점사 흐름과 함께 따로 설계한다(설계자 판단,
  직배는 라이브 0건).

- **도착(`arrived`)** 시각이 **환불 기한(3영업일, 전자상거래법 제18조 ②)** 의 시작이다. 기한은 화면에서 보이게 한다(정렬·경고).
  영업일 계산은 주말만 빼고 공휴일은 무시한다(설계자 판단 — 보수적으로 짧게 잡힌다).
- **검수(`inspected`)** 는 줄(SKU)마다 «양품 / 불량 / 환불 보류» 수량을 받는다. 셋의 합이 도착 수량과 같아야 하고, 도착 수량은
  요청 수량 이하다. 원장은 양품 → `RETURN_ACCEPT`, 불량·환불 보류 → `RETURN_REJECT`(재판매 불가). 환불 보류는 돈의 판단이지
  재고 판단이 아니다 — 보류 건이라도 물건은 불량 재고로 간다(설계자 판단, 다시 팔 수 있으면 CS 가 뒤에 평범한 재고 조정으로 옮긴다).
- 검수가 끝나면 **«수령 알림» 명령**(4.4)을 outbox 로 낸다. 같은 트랜잭션이다.

**Medusa→core 관측.** channel-adapter `MedusaOrderSource` 가 반품을 읽게 한다(지금은 취소·환불만 읽는다, `medusa-order.source.ts:257-305`).
~~계약에 이미 있고 발행자·소비자가 0인 `OrderReturnRequested`(`orders.stream.ts`)를 쓰고, 반품 취소와 정산 완료도 관측한다
(새 이벤트가 필요하면 추가 — 이벤트 계약 enum 추가는 **소비자 선배포**).~~ **대체됨 — 아래 «PR 5 에서 확정한 결과» 를 따른다**
(새 이벤트 `ChannelReturnRequested`·`ChannelReturnCancelled`, 소비자 선배포 제약 없음). 지연은 폴링 주기(5분)까지다.

**고객 이벤트는 그대로 core 가 낸다.** `SalesOrderClaimProgressed`(requested·collected·completed)와 `SalesOrderReturned` 계약과
소비자(notification 메일, ugc 리뷰 적립 회수)를 바꾸지 않는다. core 가 반품 예정 기록의 전이에서 낸다:
requested = `expected` 관측, collected = `arrived`, completed = `settled`. `SalesOrderReturned` 의 `remainingQuantity` 는 core 가 계산한다.

**K6 수량 사실.** 지금 `claimable`·`return_*`·`exchange_active` 칸은 옛 반품 테이블을 읽는다(`claim-quantities.sql.ts`). 읽는 곳은
옛 반품 자격 판정과 스토어 actions 화면(`store-sales-orders.service.ts:557-591`)뿐이다. 반품 예정 기록으로 다시 잇는다:
진행 중 = `expected`·`arrived`·`inspected`·`held`·`refund_pending`, 소진 = `settled`. **취소 상한이 반품이 잡은 수량을 뺀다**
(`remaining − returnHeld`, 정산 전 반품도) — `lineRemainingSql`(`remaining`)은 그대로 둔다(아래 PR 5 결과의 N6). 출고 후 취소와
반품의 이중 환불을 막는다(반목표). Medusa 쪽은 두 주문 변경이 같은 주문 합계를 줄이므로 저절로 막히지만, core 가 먼저 막아야
명령 자체가 나가지 않는다.

**PR 5 에서 확정한 결과.**
- (N1) Medusa→core 사실은 새 이름 둘 — `ChannelReturnRequested`·`ChannelReturnCancelled`(`orders.events.v1`). 발행자·소비자가 0이던
  `OrderReturnRequested` 는 계약에서 지웠다. 옛 계약을 고쳐 쓰면 옛 스키마를 가진 소비자가 새 payload 검증에서 throw 하지만, 새 이름은
  옛 소비자가 warn 하고 넘긴다 — 위 «Medusa→core 관측»의 **소비자 선배포는 필요 없다**.
- (N3) 반품 예정 기록은 `customer_returns`·`customer_return_lines`(줄 = 판매 라인 × 판매 단위). 상태 enum 은 위 사다리 전부
  (`expected·arrived·inspected·held·refund_pending·settled·cancelled`)를 지금 만든다 — 이 PR 이 쓰는 전이는 `→ expected`·`expected → cancelled`
  뿐이지만, K6 상태 목록이 enum 칼럼을 문자열과 비교하므로 값을 뒤 PR 에서 더하면 목록 고치기를 잊는 순간 도착한 반품이 청구에서 빠진다.
- (N5) K6 는 새 기록을 **SKU 합에만** 더한다(`claimTotalsBySkuSql`, 줄 수량 × 굳은 구성의 `qty_per_unit`, 기존 `return_active`·
  `return_consumed` 칸에 합친다). 줄이 소포를 모르므로 소포 합에는 없다 — 소포 자격이 `least(소포 − 소포 청구, SKU claimable)` 이라
  SKU 몫이 덮는다. 옛 반품 표 읽기는 PR 10 까지 남아 두 길의 반품이 서로를 뺀다.
- (N6) `remaining` 은 반품을 빼지 않는다 — 채널 변경 대조가 `remaining` 을 Medusa 줄 수량과 비교하는데 Medusa 반품은 `item.quantity` 를
  줄이지 않고, `SalesOrderReturned.remainingQuantity` 도 같은 값이다. 대신 `LineQuantities.returnHeld`(취소되지 않은 반품 줄의 판매 단위 합)를
  두고, 취소 요청 검사 세 곳(상자 전 부분취소·상자 후 재계획·요청 때 판정)만 `remaining − returnHeld` 를 상한으로 쓴다. 전체취소 몫과
  «남는 것 없음» 판정은 주문 − 취소로 센다.
- (N8) 고객 이벤트는 이 PR 에서 `SalesOrderClaimProgressed` 의 `requested` 하나다(`expected` 기록을 만든 트랜잭션에서). `collected`·`completed`·
- (N9) 스토어프론트가 Medusa 고객 라우트를 부를 때는 `getAuthHeaders()`(`_medusa_jwt`)를 헤더로 넘기고 `withAuth: false` 로 호출한다 — `withAuth: true` 의 bearer 는 user-service 토큰이라 Medusa 가 401 로 거절한다(PR 9·11 이 따라 하지 말 것).
  `SalesOrderReturned` 는 그 전이를 만드는 PR 6 이 낸다. 반품 취소에는 고객 이벤트 단계가 없다.
- channel-adapter 의 Medusa 주문 조회 `ORDER_FIELDS` 는 `returns.items.*` 로 반품 품목을 읽는다 — `returns.items.quantity` 를 이름으로 적으면
  Medusa 가 응답에서 그 칸을 뺀다(`apps/medusa/integration-tests/http/return-observation-fields.spec.ts` 가 실측으로 못 박는다).

**PR 6 에서 확정한 결과.**
- (N1·N2) core→Medusa 는 명령 하나 `SettleChannelReturn`(`channel-orders.commands.v1`), Medusa→core 는 성공 `ChannelReturnSettled`(채널 재수집이 낸다)와 실패 `ChannelReturnSettlementFailed`(channel-adapter 가 직접). 반품 실패는 새 사실 이름이다 — `ChannelOrderSettlementFailed.scope` enum 을 넓히면 옛 소비자가 throw 한다. 전부 새 이름이라 옛 소비자는 warn 하고 넘기므로 **소비자 선배포가 필요 없다**.
- (N3) SKU 항목 테이블 `customer_return_items` = 반품 줄 × 굳은 구성 SKU(`expected_qty = 줄 수량 × qty_per_unit`, 검수 결과 세 칸은 검수 전 null). 접수(`recordRequested`)가 줄과 함께 만든다. 구성 없는 줄은 거절한다.
- (N4) 도착은 기록 행이 멱등을 진다 — `customer_return_arrivals`(키 unique). 도착 수량은 그 행들의 합이고 칸을 따로 두지 않는다. 한 반품이 두 소포로 나눠 와도 된다.
- (N5) 받는 창고는 첫 도착이 정한 창고이고, 그 주문을 배송완료한 창고 중 하나여야 한다 — 위 «원래 출고한 창고»를 검증으로 옮겼다.
- (N7) 부분 도착은 이번 PR 에서 검수를 거절한다. 위 «도착한 줄만 정산하고 나머지는 CS 가 닫는다»는 PR 6b 의 «미도착으로 닫기»가 연다.
- (N9) 정산 명령의 재발행은 core 크론(`customer-return-settlement-retry`, 5분)이다. 같은 requestId 로 다시 내고, 12번을 넘기면 `stalled` 로 멈춰 error 로그를 남긴다(사람 일). 영구 거절은 건드리지 않는다.
- (N11) Medusa 반품 취소는 core 에 도착을 묻는다 — 자격 API 응답의 `customerReturns` 에서 그 반품이 `expected`·`cancelled` 가 아니면 `return_arrived`(400). core 에 기록이 없으면(관측 지연 ≤ 5분) 통과하고, core 가 응답하지 않으면 502 다. PR 3 숙제의 답이다.
- (N17) 정산 결과: `ChannelReturnSettled`(환불까지 끝, auto·manual 무관)는 `settled`, `ChannelReturnSettlementFailed` 가 `received: true`(수령 확정, 환불만 남음)면 `inspected → refund_pending`. 실패 사실은 순서 없이 와도 `at` 이 더 늦은 것만 적는다. 위 사다리 문장을 이에 맞게 고쳤다.
- (f) 검수자 id 는 이번 PR 에서 저장하지 않는다(칸 없음) — 창고 화면(PR 7)과 함께 더한다. → PR 7b 에서 `inspected_by`.

**PR 6b 에서 확정한 결과.**
- (N1) CS 의 문(미도착 닫기·보류 정산·선환불·다시 시도·계좌 송금)은 core 라우트다. CS 는 Medusa 를 직접 부르지 않는다 — core 가 기록과 명령을 한 트랜잭션에 묶어야 크론 재발행·관측이 한 기록 위에 선다. 읽기 하나(정산 미리보기, 4.4)만 Medusa 의 관리자 라우트를 직접 읽는다.
- (N7) 선환불과 정산은 Medusa 주문 잠금이 줄 세운다. 정산이 먼저 돌면 뒤에 온 선환불은 영구 거절(`return_already_settled`)이라 core 는 선환불을 `superseded` 로 둔다. 선환불이 먼저면 정산이 그만큼 뺀다. 그래서 선환불이 진행 중이어도 검수를 막지 않는다.
- (N8) 미도착 닫기는 줄의 `missing_qty` 다. 줄마다 «온전히 도착한 벌» = SKU 항목별 `floor(도착 / qty_per_unit)` 의 최솟값을 세고 `missing_qty = 줄 수량 − 그 값` 을 쓴다. 정산 명령의 줄 수량은 `quantity − missing_qty`, 0 인 줄은 싣지 않고 `closesMissing: true` 를 싣는다. 검수는 «기대 = 도착»이 아니라 «합 = 도착»만 본다(일부만 온 세트의 구성품도 원장에서 정리돼야 한다). 닫힌 수량은 K6 가 다시 청구할 수 있다. **Medusa 의 남은 반품 품목은 취소하지 않는다** — 반품은 `partially_received` 로 남는다. 지원되는 워크플로가 «나머지만 취소»를 하지 않는다 — 반품 취소 워크플로는 받은 품목이 있는 반품을 거절한다(`@medusajs/core-flows/dist/order/workflows/return/cancel-return.js:43`, «Can't cancel a return which has returned items»). 대가로 그 줄의 재반품이 막힌다(알려진 잔여).
- (N8 후속) 닫은 뒤에는 **새 도착 키만** 거절(Conflict)한다. 닫기 전 키의 재전송은 view 를 돌려줘 창고 재시도가 멱등이다. 닫은 뒤 늦게 온 소포는 시스템 밖(CS)에서 다룬다. 일부만 온 세트의 구성품만 온 반품은 닫지도 취소하지도 못한다(같은 이유).
- (N10·N11) 다시 시도·계좌 송금은 취소 정산의 꼴이다. 대상은 정산·선환불 둘이고 `refused`·`stalled` 만 받는다. 진행 칸에 `issues`(지금까지 낸 수, 재발행 멱등키의 일부)와 `attempts`(마지막 재시작 뒤 낸 수, 상한 12)를 따로 둔다 — `issues` 가 없는 행은 `attempts` 로 읽는다. 저장된 명령 칸을 고쳐 크론 재발행도 같은 값을 낸다. 다시 시작한 칸은 `restartedAt`·`restartedBy` 를 들고, `at` 이 그보다 이른 실패 사실(다시 시작하기 전 발행의 늦은 실패)은 버린다 — 다시 시작한 칸이 그 실패로 `refused` 로 돌아가지 않게. 선환불이 Medusa 의 기록 전 거절(`return_prepay_rejected:*`, 예: 금액 넘침)로 `refused` 면 선환불 요청이 새 금액·메모로 갈아 끼운다(발행 세대는 `issues + 1` 로 잇는다). wallet 거절(`wallet_refund_refused:*`)은 Medusa 기록이 있어 갈아 끼우지 못한다(새 금액이면 `request_id_conflict`).
- (N14) 보류 수량은 Medusa 에 폐기로 알린다(`rejectedQty + heldQty`) — 원장(DEFECTIVE)과 Medusa 재고가 같은 쪽을 본다. 돈은 바뀌지 않는다.
- (N15, **열린 질문 Q1**) 선환불한 반품은 미도착으로 닫지도 취소하지도 못한다 — 닫으면 `owed < P` 로 상계 뒤 차액이 양수(NOT_PAID 결제 컬렉션)가 되고, 취소하면 환불이 반품 없이 남는다. 끝내 안 오면 목록에 `expected`/`arrived` 로 남는다. 대안은 «손실로 닫기»(안 온 수량을 Medusa 에 폐기로 알려 장부를 닫는다)이고 아직 답이 없다. 답이 «손실로 닫기»면 core 에 문 하나가 늘고 정산 명령의 `closesMissing` 판정이 갈린다.

### 4.4 정산 — 수령 + 택배비 + 환불 (Medusa)

core 의 «검수 끝» 명령(새 명령 타입, `channel-orders.commands.v1`) → channel-adapter → 우리 Medusa 관리자 라우트.
응답 계약은 부분취소 라우트(`apps/medusa/src/api/admin/orders/[id]/partial-cancel/route.ts`)와 같은 모양으로 둔다
(200 / 400 거절 / 400 `wallet_refund_refused:*` / 502 `refund_pending`). 실패는 `ChannelOrderSettlementFailed` 로 core 에 돌아온다.

정산 워크플로가 한 잠금(`orderCancelLockKey`) 안에서 하는 일:

1. `beginReceiveReturn` → 양품은 `receiveItemReturnRequest`, 불량은 `dismissItemReturnRequest`(damaged) → `confirmReturnReceive`.
   Medusa 의 주문 합계(`pending_difference`)가 돌려줄 돈을 정한다 — `return.refund_amount` 는 기본 흐름에서 늘 null 이다
   (`order/dist/services/actions/create-return.js:12`). 상품 할인은 수량 비례로 자동 차감된다(`utils/dist/totals/line-item/index.js:52-64`).
   **불량 수량도 환불 대상**으로 계산된다 — 판매자 잘못(하자) 반품에서 맞는 동작이다.
2. **택배비 차감** (D4, 사유의 부담 주체가 `customer` 일 때만):
   - 반품 택배비: 반품에 든 배송 그룹마다 한 번, 그 그룹 정책(주문 시점 `policySnapshot`)의 `baseFee` + 지역 추가비(제주·도서산간).
     `free` 그룹은 0, `per_quantity` 그룹도 `baseFee` 한 번(설계자 판단 — 회수는 상자 한 번이다). 같은 주문에서 반품을 여러 번 하면
     반품마다 뺀다(회수가 매번 일어난다). 정책 타입에 반품비 칸을 새로 두지 않는다.
   - 무료배송 깨짐: 부분취소의 `planShipping`(순수 함수, `plan-shipping.ts`)을 «남는 수량»으로 돌려 처음 면제한 배송비를 계산한다.
   - **전량 반품**: `planShipping` 은 남는 수량이 0이면 `newFee = 0` 이라 처음 면제한 배송비를 빼지 않는다. 그러나 D4 는 «전체 반품이면
     왕복»(무료배송 주문이면 처음 배송비 + 반품 택배비, 예 2,500 + 2,500)이다. 그래서 그룹의 남는 수량이 0이 될 때는 «처음 면제했던
     그룹 요금»(스냅샷 정책으로 원래 수량을 계산한 값 − 실제로 낸 배송비)을 따로 더한다.
   - 차감 합은 이번 환불액을 넘지 않는다(`chargeCap`).
   - **계산식은 아래 «PR 6 에서 확정한 결과»의 N13 이 정본이다**(이 목록은 그 식의 배경).
   - 차감을 주문에 남기는 방법(반품 배송 방법의 `custom_amount`, 또는 부분취소처럼 배송 방법 추가)은 빌더 몫. 조건: 고객에게
     NOT_PAID 결제 컬렉션이 생기지 않을 것, 다음 부분취소의 배송비 재계산을 깨지 않을 것(아래 함정).
3. 환불: 부분취소가 쓰는 `issuePaymentRefund`(`settlement/issue-payment-refund.ts`)를 `kind: 'RETURN'` 으로(이미 정의돼 있다,
   `almond-payment/refund-data.ts:148-149`). auto 기본, 무통장·Wallet 영구 거절이면 manual 로 떨어진다. 결제별 «캡처 − 환불» 여유
   안에서 나누는 로직·장부 맞추기(`wallet-refund-ledger.ts`)·Idempotency-Key 는 부분취소 것을 그대로 쓴다.
   `partial-cancel-order.ts` 안의 private `refund()`·`loadOrder()` 를 settlement 로 꺼내 두 워크플로가 같이 쓴다.
4. Medusa 재고: `confirmReturnReceive` 는 `return.location_id` 의 inventory level 을 양품 수량만큼 올린다(`manage_inventory=false`
   variant 는 건너뜀, 불량은 안 올림). `location_id` 가 비어 있고 재고 관리 variant 가 있으면 예외다. 그래서 반품의 `location_id` 는
   하나뿐인 stock location 으로 둔다. Medusa 재고는 channel-adapter 가 core 값으로 절대값 덮어쓰기를 하므로
   (`medusa.client.ts:1565-1614`), 그 사이 잠깐 많게 보일 수 있다 — 정산 직후 해당 variant 재동기화를 부를지는 빌더 몫.

**CS 의 두 문 (D10).** 같은 정산 라우트에 모드 둘을 더한다.

- **보류 정산**: `held` 반품을 CS 가 끝낸다. 입력은 줄별 수령 결과(검수가 준 것)와 «차감액 + 메모». 차감액은 0 이상, 이번 환불액
  이하. 택배비 차감(2) 위에 더해진다. 차감을 주문에 남기는 방식은 택배비 차감과 같은 방식을 쓴다.
- **선환불**: 물건이 도착하기 전에 CS 가 환불을 먼저 낸다. Medusa 수령은 하지 않고 환불만 낸다 — 금액은 «요청 품목의 환불 예정액
  − 택배비 차감»을 기본으로 CS 가 고칠 수 있다. 나중에 도착·검수로 정산할 때는 **이미 선환불한 금액을 빼고** 낸다(부분취소의
  `alreadyRefunded` 상계, ADR-0043 과 같은 생각). 선환불액의 정본은 반품 기록이 아니라 Medusa 환불 행이다(아래 PR 6b 결과).
- 운영 규칙: Medusa 주문의 반품 환불을 wallet 관리자 화면에서 직접 내지 않는다. 이 작업은 그것을 기술적으로 막지는 않는다
  (wallet 직접 환불 차단은 #1070 축과 함께 본다) — 개통 안내에 적는다.

**함정 — 반품 배송 방법이 부분취소를 깬다.** `toShippingMethodView`(`partial-cancel-order.ts:426-451`)는 `return_id` 가 있는 배송
방법을 거르지 않는다. 반품 배송 방법에는 `policySnapshot` 이 없어서, 반품이 한 번이라도 붙은 주문은 그 뒤 부분취소가 전부
`NO_SNAPSHOT`(배송비 조정 안 함)이 된다. 반품 배송 방법을 거르게 고친다.

**PR 6 에서 확정한 결과.**
- (N13) 택배비 식(위 2 를 이 식으로 읽는다). 부담 주체 `seller` 면 차감 0, `customer` 면 세 몫이다. ① 반품 택배비 — 이번 반품이 닿은 배송 그룹마다 한 번(`free` 0, 그 밖은 `flat` 으로 바꾼 정책의 baseFee + 지역 추가비, `per_quantity` 도 한 번). ② 무료배송 깨짐 — 남는 수량(주문 수량 − 이전 반품 수령·폐기 − 이번 반품)이 있는 그룹에서 `planShipping` 이 «올라감»으로 계산한 값. ③ 왕복 — 남는 수량이 0 인 그룹은 `conditional_free` 일 때만 `max(0, flatFee − currentFee)`. 줄어드는 배송비는 돌려주지 않는다(물건은 이미 배송됐다). 합은 돌려줄 돈을 넘지 않고, 넘치면 ①→②→③ 순으로 채운다. 스냅샷이 없거나 그룹이 안 맞거나 배송비 할인이 붙은 주문은 차감 0 + `feeNotAdjusted` — CS 가 PR 6b 보류 정산으로 다룬다.
- (N14) 정산 단계는 `return.metadata.almondReturnSettlement`(요청 기록 `almondReturn` 과 다른 키): `received`(수령 확정) → `charged`(택배비 확정) → `refunded`. 택배비는 수령 «뒤»의 order edit 에 «반품 택배비» 배송 방법(`custom_amount`)으로 차감한다 — 수령 전에 넣으면 차액이 잠깐 양수가 돼 NOT_PAID 결제 컬렉션이 생긴다. 이 방법은 부분취소의 배송비 판정에서 «원래 방법»으로 읽히지 않는다(정산 청구 이름 둘을 거른다).
- (N10) 수령까지 끝난 반품도 전체취소를 계속 막는다 — Medusa 전체취소는 «캡처 − 환불» 을 다 돌려줘 반품 정산이 뺀 택배비까지 돌려주기 때문이다. 반품이 있는 주문은 배송완료가 있어 core 가 운영자 전체취소를 부분취소로 바꾸므로 이 막음에 걸리는 정상 호출은 없고, 동작은 그대로 두고 테스트로 못 박았다. PR 3 숙제의 답이다.
- (a) 반품 뒤 부분취소의 배송비 판정은 돌아온 수량(수령+폐기)을 남는 수량에서 뺀다 — 안 빼면 반품이 뺀 무료배송 깨짐을 부분취소가 되돌려 준다.
- (a-1) 반품 뒤 부분취소는 배송비를 «돌아온 물건이 아직 있는 것처럼» 계산한 값 아래로 돌려주지 않는다 — 돌아온 물건의 출고 배송비는 이미 쓴 것이다. 청구는 돌아온 수량을 뺀 계산 그대로(`planShipping` 의 `refundFloorLines`).
- (a-2) 알려진 잔여: 무료배송 기준을 반품분만으로 넘는 주문은 «반품 먼저·취소 나중»일 때 왕복 몫을 덜 뺀다(고객 유리, 순서에 따라 갈림) — PR 6b 에서 다시 봤고 그대로 둔다(위 PR 6b 결과의 N13).
- (b) 부분취소의 «지금 그룹 요금»은 택배비 청구가 붙은(`charged`·`refunded`) 반품 기록만 겹친다.
- (c) 한 주문에 택배비 청구 전(`received`)에 멈춘 반품 기록이 있으면 그 주문의 부분취소와 다른 반품 정산은 500(일시)으로 기다린다 — 두 번 빠지는 것을 막는다. 멈춘 기록은 사람이 풀어야 한다(운영 안내 — PR 6b 부터는 다시 시도).
- (d) 택배비 청구의 배송 옵션은 수령 때 기록에 남긴다. 기록에 정산 requestId 를 싣는다.
- (e) channel-adapter 는 Medusa 의 모르는 400 을 일시 실패로 다시 시도한다(부분취소와 다르다 — 반품은 PR 6b 전까지 사람의 길이 없었다. 6b 부터는 `stalled` 뒤 다시 시도가 사람 길이다). 정해진 거절(`return_settle_rejected`)만 영구다.

**PR 6b 에서 확정한 결과.**
- (N2·N3) 보류 정산은 `held → inspected` + 명령의 `holdDeduction { amount, memo }` 다. 0 은 «차감 없이 정산»이다. Medusa 는 차감을 택배비와 **같은 order edit** 에 «반품 차감» 배송 방법(`custom_amount`)으로 남기고, 부분취소가 원래 방법으로 읽지 않게 정산 청구 이름에 더한다. 차감은 수령 «뒤» `owed` 를 알아야 판정되는데 수령 뒤 거절은 반품을 `received` 에 가둔다 — 그래서 **넘치면 깎는다**(거절하지 않는다). 채우는 순서는 선환불·외부 상계 → 택배비(① ② ③) → 보류 차감이고, 기록은 요청액과 적용액을 둘 다 남긴다. 청구를 붙일 배송 옵션은 수령 «전»에 정한다(배송 방법은 수령으로 바뀌지 않는다) — 반품이 닿은 그룹의 원래 방법, 없으면(스냅샷 없음·그룹 불일치 — 택배비 0 에 보류 차감만) 옵션이 있는 첫 원래 방법. 그것도 없는데 보류 차감이 있으면 수령 전에 `no_charge_shipping_option`(정해진 거절)이다 — 수령 뒤에 못 찾으면 확정된 수령에 기록이 없어 이어 가기가 영영 멈춘다. PR 7: 그 거절은 «보류 차감 빼고 다시 시도»(`dropHoldDeduction`, N7)로 푼다.
- (N4·N5) 선환불은 정산과 같은 라우트의 모드가 아니라 **새 명령 `PrepayChannelReturn` 과 새 워크플로 `prepayOrderReturn`** 이다 — 수령·택배비가 없고 반품 하나에 정산과 따로 한 번 있어 진행 기록·실패 사실이 갈린다. 요청 키는 core `customer_returns.id`, 환불 메모는 `return-prepay:<id>`(정산은 `return-settle:<id>`). 금액은 Medusa 가 센다: 품목 값 `V`(반품 품목 전부, 할인 몫 제외) 와 택배비 예상 `F` 로 기본 `V − F`, CS 가 주면 `1 ≤ amount ≤ V`. 상한이 `V` 라 정산의 `owed ≥ P` 가 늘 성립한다.
- (N6) **선환불액의 정본은 Medusa 환불 행**(메모 `return-prepay:<id>` 의 합 `P`)이고 반품 기록은 진행만 든다. 정산은 `P` 와 CS 가 적은 외부 환불 `E` 만큼 덜 낸다. 상계 크레딧 라인이 필요한지는 실측이 정했다 — 반품 요청이 열려 있는 동안 `refundPaymentWorkflow` 가 읽는 저장된 주문 summary 는 반품 품목 값을 «돌려줄 돈»으로 센다. 그래서 선환불은 **크레딧 라인이 붙지 않고** `loadOrderView` 차액이 +P 로 남았다가 수령 때 산술로 상쇄된다. 상계 크레딧 라인(reference `'return-offset'`)은 **크레딧이 붙은 환불**(외부 환불 등)의 몫에만 쓴다: `min(room, clamp(P + E − B, 0, P + E))`, 원 단위 내림, `B` = 수령 전 `loadOrderView` 차액. 이 식은 그 주문에 끝나지 않은 다른 돈 기록(부분취소·다른 반품 정산)이 없을 때만 맞아서, `P + E > 0` 인데 있으면 500(일시)으로 기다린다. 내림이나 `room` 상한이 라인을 묶으면 원 미만의 모자람이 음수 차액으로 남는다(부분취소는 그 몫을 환불이 떠안지만 여기서는 상계 적용액을 줄이지 않는다). 다른 반품의 열린 선환불이 `B` 를 부풀리면 이 반품의 상계 라인이 모자랄 수 있으나, 환불액은 맞고 그 반품이 정산되면 스스로 풀린다 — 막으면 선환불 둘이 서로 기다린다. 실측은 `apps/medusa/integration-tests/http/return-prepay-premises.spec.ts`.
- (선환불 재시도·취소) 정산이 끝난 뒤 온 선환불 재시도는 환불 원장을 따른다: 원장에 선환불 합이 있으면 200(원장 합계), 없으면 `return_already_settled`. core 의 `recordPrepaid` 는 반품이 어느 상태든 사실을 받는다(`superseded`·`in_progress`·`refused` → `done` + 결과) — 응답을 잃은 선환불이 정산 뒤 도착할 수 있어서다. 반품 취소의 막음은 **실제로 나간 선환불**(환불 행이 `refunded` 이거나 원장 합이 0 초과)에만 건다 — 거절돼 돈이 안 나간 요청 기록이 반품을 가두지 않는다.
- (Medusa 2.13.4 결함) `cancelBeginOrderEditWorkflow` 는 `SHIPPING_ADD` 액션의 id 로 삭제를 걸어, 추가한 배송 방법이 아니라 엉뚱한 행을 지운다. 취소한 order edit 의 배송 방법이 다음 확정된 edit 에 되살아난다. 우리가 연 edit 를 취소하는 길은 `cancelOpenOrderEdit`(`settlement/order-edit-charge.ts`)로 배송 방법을 직접 지우며, 부분취소의 취소 경로도 같은 함수를 쓴다(반품 없는 주문의 정상 경로는 그대로). 이 함수는 열린 «주문 수정»(change_type `edit`)의 배송 방법만 지우고, 열린 주문 수정이 없으면 아무것도 하지 않는다 — `cancelBeginOrderEditWorkflow` 는 change_type 을 보지 않고 열린 변경 하나(열린 반품 요청이어도)를 지운다.
- (CS 칸 이름) Medusa 정산 라우트는 CS 칸을 **snake_case**(`hold_deduction`·`already_refunded_amount`·`closes_missing`)로만 받고 camelCase 는 400 `invalid_data` 로 거절한다 — 조용히 버리면 보류 차감이 빠져 과환불한다. channel-adapter 가 명령의 키를 옮기고 값은 그대로 둔다(본문은 테스트가 못 박는다). core 의 해시는 새 칸이 있을 때만 그 칸을 포함해, PR 6 모양 요청의 해시는 그대로다.
- (N9) 읽기 하나: `GET /admin/orders/:id/returns/:return_id/settlement-preview` → 품목 값·택배비 예상·선환불 기본값·이미 선환불한 합. 쓰기 없음이고 core 는 부르지 않는다(화면 PR 7 용). 반품이 없으면 404.
- (N12·사람 길) 모르는 400 은 계속 일시 실패다. 12번 뒤 `stalled` 면 **다시 시도(PR 6b)** 가 사람 길이다 — 부분취소처럼 영구로 바꾸면 사람이 볼 기회 없이 `refused` 가 된다. 위 PR 6 의 (c)·(e) 는 이 길로 풀린다: 같은 requestId 로 이어 가므로 `received` 에 멈춘 정산도 풀린다.
- (N16 → 결과) 외부 환불이 미해결이면 정산은 400 `return_settle_rejected:external_refund_unresolved`(미해결 금액 동봉)이고, 다시 시도에 «이미 환불한 금액» 을 실어 그 몫을 상계한다(위 N6 의 `E`). 이 칸은 마지막 실패가 외부 환불 거절(`external_refund_unresolved`·`exceeds`·`absent`)일 때만 받고, `null` 은 저장된 값을 지운다 — `absent`(외부 환불이 없는데 적었다)의 유일한 출구다. 셋 다 Medusa 가 수령·기록 «전»에 거절해 요청 해시가 아직 없으므로 바꾼 값으로 다시 낼 수 있다. 선환불한 반품을 미도착으로 닫는 정산은 `prepaid_closes_missing`(400)으로 정해진 거절이다(N15).
- (N13 재확인) (a-2)의 «반품 먼저·취소 나중» 잔여는 6b 에서 다시 보고 **고치지 않는다** — 고객 유리이고, 고치려면 부분취소 환불 하한 (a-1)을 순서 무관하게 다시 짜야 한다. 라이브 반품 0건이고 6b 의 문들과 독립이다.

### 4.5 Medusa 부분취소에 사유 규칙 (D4)

`planShipping` 에는 사유 입력이 없다. 라이브 부분취소 13건 중 8건이 `OUT_OF_STOCK`(우리 품절)이었다 — 그때는 스냅샷이 없어
실제로 빼지 않았지만, 10-07 이후 주문부터는 뺀다. 부분취소 입력에 부담 주체를 싣고(`CancelChannelOrder` 의 사유에서 정한다),
`seller` 면 배송비를 다시 매기지 않는다(줄어드는 쪽 환불은 그대로).

사유 → 부담 주체(설계자 판단): `CUSTOMER_REQUEST`·고객 자기 취소 → `customer`, 그 밖(`OUT_OF_STOCK` 등) → `seller`.
**값이 없는 옛 호출자는 `seller`** — 고객에게 불리하지 않은 쪽으로 기운다. 지금 동작(늘 매김)과 달라지는 점이라 배포 노트에 적는다.

### 4.6 원장 — «반품» 상태 (core inventory)

- `stock_state` 에 `RETURNED` 를 더한다. `transition_type` 에 셋을 더한다:
  `RETURN_RECEIVE`(null → RETURNED), `RETURN_ACCEPT`(RETURNED → ON_HAND), `RETURN_REJECT`(RETURNED → DEFECTIVE).
  같은 위치 안의 상태 전이는 `ck_events_states_diff` 가 이미 허용한다.
- 원장에 전이 검증 맵이 없으므로, 이 세 전이의 from/to 는 `InventoryCommandService` 의 새 메서드 셋이 고정한다
  (`receive`·`moveInternal` 이 상태를 하드코딩하는 것과 같은 방식). 쓰기는 `StockEventStore.createEvent` 만 한다(`inventory-write-boundary.arch.spec.ts`).
- 위치는 그 창고의 `return_default` 시스템 위치(설계자 판단). 검수 합격분을 적치 위치로 옮기는 것은 그다음의 평범한 `MOVE` 다.
- 가용재고는 `ON_HAND − reserved` 라 `RETURNED` 는 저절로 판매 불가다. 다만 상태를 가리지 않고 합치거나 상태 목록을 박아 둔 곳이
  있다 — 빌더가 하나씩 정한다:
  - `stock_summary_view` (상태별 LEFT JOIN 3개 하드코딩 → 뷰 재정의 마이그레이션)
  - `warehouse.reader.ts` 의 `totalAvailable`(전 상태 합 — 기존 버그성), `stock-projection.reader.ts` 의 `currentQuantity`
  - `stock-valuation.reader.ts`·DTO, event-contracts `inventory.stream.ts`, admin-web 상태 라벨·통계, warehouse-app `movement/types.ts`
- 죽은 `MARK_DEFECT`·`REWORK_GOOD` 는 건드리지 않는다(현황판 작업 8b 의 몫).
- **PR 4 에서 확정한 결과.**
  - 메서드 `InventoryCommandService.returnReceive`·`returnAccept`·`returnReject`. 위치를 받지 않는다 — 언제나 그 창고의 `return_default`
    (RETURNED 를 옮기는 경로가 없으므로 합격·불합격도 같은 위치에서 상태만 바꾼다). `idempotencyKey` 필수(호출자는 재시도로 다시 들어온다).
  - 역분개 타입: `RETURN_RECEIVE → ADJUST_DOWN`, `RETURN_ACCEPT`·`RETURN_REJECT → MOVE`(같은 위치 상태 전이는 `MOVE` 가 이미 담는다 —
    `transferShip` 의 ON_HAND → IN_TRANSFER). 합격의 역분개는 ON_HAND 를 줄이므로 예약 불변식 가드를 탄다.
  - «실재고»(물리 합계)는 RETURNED 를 더하고 가용은 더하지 않는다(`physicalQuantity`). 창고 요약 `totalAvailable` 은 전 상태 합이던 것을
    ON_HAND 합으로 고쳤다.

### 4.7 한진 회수 접수 (뒤 PR, DEV 스모크 선행)

- 같은 `insert-order` 에 `svcCatCd = 'R'`. 송하인 = 고객, 수하인 = 창고. `wblNo` 는 «확인 가능하면 원운송장번호».
- 도착 전 반품 취소는 `cancel-order` (R 예약은 한진이 운송장을 출력하기 전까지 취소 가능, `docs/hanjin-api-integration-reference.md` §4.3).
- 지금 게이트웨이는 `svcCatCd: 'S'` 하드코딩(`hanjin-carrier.gateway.ts:191`), `canCancel: false`. HMAC 클라이언트는 그대로 쓴다.
- **스모크로 먼저 확인할 것 셋:** R 에서 허용되는 `payTypCd`, 우리 계약번호로 R 이 열려 있는지, 회수 운송장번호를 어떻게 받는지
  (주문번호로 추적 조회가 되는지). 결과에 따라 이 절을 고친다.
- 회수 접수 실패는 반품을 막지 않는다 — 반품 예정 기록에 «회수 미접수»로 남고 CS 가 처리한다.

### 4.8 화면 (뒤 PR — 문만 적는다)

- **admin-web `/cs/return-exchange`**: 새 API 로 다시 짓는다 — 반품 목록(Medusa 반품 + core 반품 예정 상태, 환불 기한 정렬), CS 대리
  접수(기한 넘김 사유, 기타 사유의 부담 주체), 도착 전 취소, 환불 보류 정산(차감액·메모), 선환불, 미도착으로 닫기, 정산 실패 재시도. 옛 훅의 권한(`order.claim.read`/`write`, `payment.refund.execute`)은 그대로 쓴다.
- **창고 반품 입고·검수 화면**: 지금 없다(warehouse-app `domains/returns/*` 는 피킹 «되돌림 바구니»라 무관). 2026-10-28 결정: **warehouse-app 스테이션**(F7)에 둔다 — PR 7b.
  문은 core 의 «도착»과 «검수» 명령 둘이다.
- **스토어프론트 신청 화면**(#933·#934): 우리 store 라우트를 부른다. 지금 화면은 옛 core API 를 부르므로 같이 바뀐다.
- admin-web `/inventory/returns`(inventory ReturnService 화면)는 지운다.

**PR 7 에서 확정한 결과.** admin-web CS 화면과 core 읽기·목록만 PR 7 이다(마이그 없음, core 먼저).
- (N1) 출처가 둘이다: 목록·상세·CS 문은 core, 접수·도착 전 취소·정산 미리보기는 Medusa. 접수·취소 뒤 core 목록에는 channel-adapter 폴링(≤ 5분) 뒤에 나타난다.
- (N2) 목록 `GET /admin/customer-returns` — `bucket`(`open`/`attention`/`closed`), `q`, `limit`, `offset`; 응답 `{ items, total, attentionCount }`. 페이지 넘김은 **세 bucket 모두**에 둔다(계획은 closed 만이었으나 진행 중·확인 필요도 100건을 넘길 수 있다).
- (N3) 고객명은 목록 행에만 싣고 `@PiiResponse` 로 가린다. 상세와 쓰기 라우트 응답은 개인정보가 없다.
- (N4) 환불 기한 = 도착한 KST 날짜의 «다음 날»부터 센 3번째 평일 23:59:59.999 KST. 초일 불산입, 공휴일은 무시, +9시간 고정 산술.
- (N5) 확인 필요 다섯: 보류 판단 · 정산 실패 · 선환불 실패 · 부분 도착 · 환불 기한 지남. 선환불 뒤 미도착(Q1)은 누를 문이 없어 넣지 않는다.
- (N7) 보류 차감 빼고 다시 시도 — `retry` 의 `dropHoldDeduction`. 실패 코드가 `no_charge_shipping_option` 일 때만 받는다.
- (N8) 접수는 주문 목록 자사몰 행의 [반품 접수] 에서 연다. `request_id` 는 대화상자를 열 때 한 번 만든다.
- (N10) 교환 탭은 그대로다. 옛 반품 표·훅·돈 계산은 지웠고, 옛 core 반품 라우트와 `/inventory/returns` 는 PR 10 이 걷는다.
- (N11) 대시보드·통계의 «반품» 칸은 새 목록(진행 중 total, 확인 필요 attentionCount)으로 바꿨다. 일별 반품 수는 옛 표를 세므로 PR 10 에서 다시 잇는다.
- (창고 화면) warehouse-app 스테이션(F7)에 둔다. 소포는 한진 회수(PR 9) 전까지 «도착 대기 목록 + 검색»으로 찾는다. 이 작업과 검수자 id 칸이 **PR 7b** 다.

**PR 7b 에서 확정한 결과.** 창고 반품 화면(스테이션)과 core 읽기 라우트·검수자 칸이다. 마이그 하나(expand).
- (N1) 자리는 스테이션 7번째 탭 F7 «반품»(경로 `/customer-returns`). F1 검수 중 «수량»도 F7 이다 — 레지스트리가 안쪽을 이기므로 검수 중 F7 = 수량, 그 밖에선 반품 탭이다. 기능키 바는 id 가 `tab-` 로 시작하는 셸 탭 액션만 뺀다. 핸드헬드엔 탭이 없다.
- (N2) 창고 읽기 라우트는 `GET admin/customer-return-receiving`(목록)·`/:id`(상세) — 권한 `inventory.stock.operate`(+ `ScopeGuard`), 새 권한 키 없음. GET 인데 쓰기와 같은 문이라 `route-classification.spec.ts` 의 `NON_READ_GET` 에 근거와 함께 올렸다.
- (N3) 도착 대기 목록은 `expected`·`arrived` 만, 그 창고 것만(`expected` 는 그 창고가 배송완료한 주문). 단계 `ready`(검수 대기) → `partial`(덜 옴) → `awaiting`(도착 전) 순, 그다음 요청 이른 순.
- (N4) 고객명은 가려서(`customerMasked`) 싣는다 — 원문이 아니라 `@PiiResponse` 대상이 아니다. 검색은 원문 부분 일치다.
- (N5) 항목에 `barcodes` 를 싣는다. 소포 세기에서 스캔은 그 바코드를 가진 항목 중 남은 수량이 있는 첫 줄에 +1 하고 그 줄을 고른다 — 같은 SKU 가 두 줄이면 앞줄부터 찬다. 포장단위는 무시(낱개).
- (N6) 소포 키는 화면을 열 때 한 번 만든다. 결과를 모르면 수량을 잠그고 같은 키로 다시 보낸다. 이미 도착이 있는 반품은 F10 을 두 번 눌러야 보낸다(같은 소포를 두 번 세는 일을 막는 유일한 장치).
- (N7) 검수는 불량·보류만 입력하고 양품은 도착 − 불량 − 보류(파생)다. 되돌릴 수 없어 F10 은 두 번 누른다.
- (N9) `customer_returns.inspected_by` nullable — 처음 검수 때만 `actorId` 를 쓰고 같은 결과 재요청은 건드리지 않는다. 화면엔 안 보인다. `migrate → deploy`, core 먼저 → 앱 릴리스.
- (검색칸) 명령 바코드는 셸로 보낸다(스테이션 §5.3). 숫자만 친 값이 주문 검색으로 0건이면 같은 값을 상품 바코드로 한 번 더 찾는다(주문번호도 숫자라 앞에서 못 가른다). Esc 는 열린 칸이면 칸만 닫고, 닫힌 칸이면 검색을 지운다.
- (검수 스캔·Esc) 검수 화면도 상품 스캔으로 그 줄을 고른다(없는 상품은 오류음). 소포 세기·검수 둘 다 입력이 있거나 결과를 모르면 Esc 를 두 번 눌러야 버린다.
- (명령 시트) «반품» 절은 키당 바코드 한 장(F10 «도착 확정 · 검수 확정», Esc «목록»). 탭 절의 F7(반품)과 출고 검수 절의 F7(수량)이 함께 있어, 검수 중에 탭 F7 바코드를 찍으면 수량이 열린다(N1 의 그림자).
- (N11) dev 시드 반품 시나리오 셋(`DEV-RETURN-0001…3`, `docs/local-dev.md`).

**PR 8 에서 확정한 결과.** 스토어프론트 반품 신청 폼과 주문 상세 «반품» 칸이다. 마이그 없음, Medusa 에는 store 읽기 라우트 하나.
- (N1) 수거지는 주문 배송지로 고정한다(10-28 결정). 폼에 주소 칸이 없고 배송지 한 줄 + «다른 곳에서 회수해야 하면 고객센터로». Medusa 요청에 주소 칸을 더하지 않는다. 한진 회수(PR 9)가 주문 배송지를 송하인으로 읽고, 그 전엔 CS 가 손으로 접수한다.
- (N2) 반품 상태는 주문 상세 «반품» 칸에서 본다. `GET /store/orders/:id/returns`(POST 와 같은 라우트 파일, 기존 고객 인증 미들웨어 매처가 덮는다) → `{ returns: [{ return_id, stage, requested_at, reason, fee_bearer, items, can_cancel }] }`, 늦은 요청 순, 우리 기록이 있는 반품만(`open` 제외). 단계 넷 `requested`·`processing`·`refunded`·`canceled` 이고 `can_cancel` 은 `requested` + Medusa `requested` 일 때만 — core 를 묻지 않아 창고 도착은 취소 POST 의 `return_arrived` 거절로 안다.
- (N3) 금액은 보이지 않고 사유를 고르면 택배비 규칙 한 줄만 보인다(고객 부담: 환불금에서 차감·무료배송 기준 아래면 처음 배송비도 / 판매자 부담: 저희가 낸다). 금액은 정산 때 Medusa 가 센다.
- (N4) 폼 줄은 Medusa 주문 품목에 `returnable` 을 붙인다(없으면 0). `blocked` 는 `nothing_left`(수량 0)·`window_closed`(기한 지남, 수량이 있어도). 막힌 줄은 못 고르고 이유 한 줄. 스테퍼 1~`returnable`. 고를 줄이 없으면 빈 상태. URL `itemId` 가 고를 수 있는 줄이면 수량 1 로 미리 고른다.
- (N5) `request_id` 는 폼을 열 때 한 번 만든다. 200 `requested` = 완료, 200 `canceled`(같은 id 재생인데 그 사이 취소) = `canceled_replay` 로 완료가 아니고 새 id. 400 `return_rejected`·502 `core_unavailable`·404 는 만들기 전의 확정 답이라 새 id 로 폼을 푼다. 그 밖(네트워크·5xx·코드 없는 400)은 `unknown` — 본문을 잠그고 같은 id·같은 본문으로 «다시 보내기». 401 은 던져 `error.tsx` 토큰 복구.
- (N6) `request_id_conflict` 는 끝 상태다 — «이미 접수된 신청이에요» + 주문 상세 링크, 다시 보내기·새 id 없음(새 id 는 두 번째 반품).
- (N7) 교환은 그대로다. `exchange-client.tsx` 는 교환 전용으로 옛 core 교환 API 를 계속 부른다(PR 11). `/mypage/exchange` 는 `type=exchange` 일 때만 교환 폼을 열고, `type` 이 없거나 모르는 값이면 반품 폼을 연다(옛 기본 유지). 반품 폼 페이지는 주문·`returnable` 이 null(404)이면 «신청할 수 없는 주문이에요», `returnable` 읽기의 다른 실패는 재시도 상태, 인증 오류는 던진다.
- (N7a) 주문 상세 칸의 취소 거절은 신청 거절 문구가 아니라 취소 전용 문구(`mypage.order.returns.cancelReject.*`)를 쓴다.
- (N8) 사유·거절 코드 표는 Medusa 가 정본이다. `return-reasons.ts` 의 고객 사유 다섯은 `RETURN_REASONS` 의 `customerSelectable` 행과 같은 집합, 이름 키는 여섯 전부(`other` 포함), 거절 문구 키는 `ReturnRejectReason` 전부를 덮는다. 루트 jest `scripts/storefront/medusa-return-parity.spec.ts` 가 소스 텍스트로 대조한다. 모르는 거절 코드는 일반 문구.

### 4.9 교환·클레임 (뒤 PR — 문만 적는다)

- Medusa `OrderExchange` 는 «돌려받기(Return) + 새 품목 + 차액(`difference_due`)», `OrderClaim` 은 하자·오배송용(`refund`/`replace`)이다.
  돌려받는 쪽은 이 설계의 반품 길을 그대로 탄다.
- 새 품목 출고: Medusa 가 확정한 교환·클레임의 새 품목을 channel-adapter 가 관측해 core 가 FO 를 만든다. 지금 그 경로가 없다 —
  `OrderModified` 스냅샷 줄은 수량·취소만 싣는다. 이 PR 을 시작할 때 설계한다.
- `confirmExchangeRequest` 는 Medusa 재고 예약(`reserveInventoryStep`)을 한다 — core 가 재고 정본이라 영향은 그때 확인한다.

## 5. 걷어낼 것 (D8)

- **판매주문 쪽**: `store-return-exchange.service.ts`, 두 컨트롤러, 반품 전용 헬퍼(`return-refund-cap.ts`, `return-refund-classification.ts`,
  `claim-quantities.reader.ts`), DTO, 테이블 5개(`return_requests`·`return_request_items`·`return_refund_attempts`·`exchange_requests`·
  `exchange_request_items`)와 enum.
  - ⚠️ `admin-return-exchange.controller.ts` 에는 **취소·환불 라우트 넷**(`POST admin/sales-orders/:id/cancel|retry-refund|manual-refund-complete|refund-waive`,
    :99-153)이 섞여 있고 admin-web `sales-orders.client.ts:143-196` 가 부른다. 파일째 지우지 말고 넷을 다른 컨트롤러로 옮긴다.
  - `WalletRefundClient`·`line-sales-units.ts`·`channel-refund-status.ts` 는 취소도 쓰므로 남긴다.
- **inventory 쪽**: `return.service.ts`·`return.controller.ts`·DTO·매퍼·`returnStatusValues`, 테이블 `returns`·`return_items`, 죽은
  `StockEventService.processReturn`.
- **다시 잇는 곳**: order-progress `return_exchange` 판정(`order-progress.judge-sql.ts:173-185,220,381-382`), 일별 통계
  (`sales-orders.service.ts:1031-1042` → admin-web `DailyBoards.tsx`), 스토어 actions(`store-sales-orders.service.ts:557-591`),
  admin-web 이력 라벨(`return_lifecycle_event` 링크).
- **가드·목록**: `wallet-refund-callers.guard.spec.ts`(허용 목록에서 반품 서비스가 빠진다), `line-quantity-read.guard.spec.ts`,
  `scripts/security/pii-routes.ts`, `idor-reviewed.spec.ts`, `role-name-checks.baseline.ts`, `pii-response.decorator.ts` 의 subject,
  admin-web `pii-access-format.ts`·`screen-access.ts`·`menu.ts`·breadcrumb·quick-actions.
- **범위 밖(이름이 비슷할 뿐)**: return_bins·warehouse-app `/returns/putaway`(피킹 되돌림), 입고 «회송»(공급사), 채널 클레임 API,
  출고 후 취소의 `postShipmentHandoff type 'return'`(개념이 겹치므로 정리 여부는 빌더가 검토).

## 6. 빌더에게 맡기는 것

- 새 테이블·라우트·명령·이벤트·워크플로 이름.
- 택배비 차감을 Medusa 주문에 남기는 방식(4.4-2의 조건 안에서).
- 반품 옵션을 0원으로 두는 방식, 정산 직후 Medusa 재고 재동기화 여부.
- Medusa 가 배송완료일·소포를 아는지 확인하고, 모르면 core 내부 API 로 자격을 받는 모양.
- 창고 반품 화면을 어느 앱에 둘지는 열린 질문이다(4.8) — 정하지 말고 질문으로 남긴다.

## 7. 배포 순서 제약

- **expand 먼저, `migrate → deploy`**: core 원장 enum 추가, 반품 예정 테이블, 뷰 재정의.
  `ALTER TYPE … ADD VALUE` 한 값은 그 트랜잭션이 커밋되기 전에 쓰면 PG 가 거절한다(`unsafe use of new value`). drizzle migrate 는
  **대기 마이그레이션 전부를 한 트랜잭션**으로 돌리므로 값 추가와 사용을 다른 파일로 나눠도 같은 실행에 실리면 소용없다(빈 DB
  부트스트랩은 늘 그렇다). 그래서 마이그레이션 안에서 새 값을 쓰는 SQL(뷰 등)은 `stock_state::text = 'RETURNED'` 처럼 text 로 비교한다
  (PR 4, 빈 DB 부트스트랩으로 확인).
- **이벤트 계약에 타입·enum 을 더하면 소비자 선배포**(이벤트 계약 zod 검증은 소비자가 throw 한다).
- **Medusa 미들웨어(기본 반품 라우트 거절)는 우리 라우트와 같은 배포 또는 먼저.** 막지 않은 채 반품 옵션을 시드하면 그 순간
  `POST /store/returns` 가 실제로 반품을 만들 수 있게 된다 — 옵션 시드보다 미들웨어가 먼저다.
- **옛 core 반품 테이블 drop 은 맨 마지막 contract PR, `deploy → migrate`.** 그 전 PR 에서 코드가 테이블을 안 읽게 만든다.
- 배포는 배치 방침(`npm run deploy:preflight -- --stage live`)을 따른다.

## 8. PR 나누기

| PR | 무엇 | 사는 곳 | 비고 |
| --- | --- | --- | --- |
| 1 | settlement 꺼내기(`refund()`·`loadOrder()`) + 부분취소 사유 규칙(4.5) + 반품 배송 방법 거르기(4.4 함정) | medusa · channel-adapter · core(명령에 사유) | 반품 없이도 값이 있다 |
| 2 | 기본 반품·교환·클레임 쓰기 라우트 거절 미들웨어 + `createReturnFulfillment` + 반품 옵션·사유 보장(`provisionShippingGroup`·시드) | medusa | 미들웨어가 시드보다 먼저(7) |
| 3 | 우리 반품 요청·취소 워크플로와 라우트(store·admin) | medusa · core(내부 API) · infra | 자격은 core 내부 API(6) |
| 4 | 원장 `RETURNED` + 전이 셋 + 뷰 재정의 + 상태 목록 반영 | core · event-contracts · admin-web · warehouse-app | expand, 휴면 |
| 5 | 반품 예정 기록 + Medusa 반품 관측(channel-adapter) + 고객 이벤트를 새 기록에서 + K6 다시 잇기 | core · channel-adapter · event-contracts | expand(`migrate → deploy`), 배포 순서 제약 없음 — N1·N2 |
| 6 | 도착·검수 명령 + 수령 알림 명령 + Medusa 정산(수령·택배비·환불) + 정산 관측·고객 이벤트 | core · channel-adapter · medusa | 여기서 반품이 끝까지 돈다(보류 없는 정상 흐름) |
| 6b | CS 문 셋: 환불 보류 정산·선환불·미도착 닫기, 영구 거절 정산의 다시 시도·계좌 송금 | core · medusa · channel-adapter | 6 이 라이브인 뒤. 결과는 4.3·4.4 의 «PR 6b 에서 확정한 결과» |
| 7 | core 읽기·목록 + admin-web CS 화면 다시 짓기 | core · admin-web | 결과는 4.8 의 «PR 7 에서 확정한 결과» |
| 7b | 창고 반품 도착·검수 화면 + 검수자 id | warehouse-app · core | 스테이션(F7), 도착 대기 목록 + 검색. 마이그 하나(`migrate → deploy`), core 먼저 → 앱 릴리스. 결과는 4.8 의 «PR 7b 에서 확정한 결과» |
| 8 | 스토어프론트 신청 화면(#933·#934) | storefront · medusa(store 읽기 라우트 하나) | 마이그 없음, 결과는 4.8 의 «PR 8 에서 확정한 결과» |
| 9 | 한진 회수 접수(R)·취소 | core | DEV 스모크 선행(4.7) |
| 10 | 옛 core 반품·교환·inventory 반품 코드와 테이블 걷기 | core · admin-web · storefront | contract, `deploy → migrate` |
| 11 | 교환·클레임 재출고 | medusa · channel-adapter · core | 착수 때 설계(4.9) |

개통(고객에게 반품 버튼을 여는 것)은 **core 출고 개통 뒤**(D9, 4.0)이고 PR 6·7·8 이 라이브인 뒤다. 한진 회수(9) 전에는 CS 가 회수를
손으로 접수한다. PR 6b 가 보류 정산·선환불 모드(4.4 «CS 의 두 문»)와 미도착 닫기를 연다.
