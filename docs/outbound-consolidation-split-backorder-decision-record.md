# 합배송·송장분할·백오더·피킹 의사결정 기록

## 문서 상태

- 상태: **제품·도메인 결정 합의 완료, 구현 전 설계 기준선**
- 작성일: 2026-07-14
- 범위: Core 앱의 FO, shipment, invoice, 재고예약, 출고 batch, 피킹, 재고원장
- 목적: 이 문서만 읽어도 의사결정 대화 전체에 참여한 것과 같은 수준으로 배경, 결정, 이유와 기각된 대안을 이해할 수 있게 한다.

이 문서는 현재 구현을 설명하는 운영 매뉴얼이 아니다. 현재 구현과 앞으로 만들 목표 모델을 구분하며, 차이는 [현재 구현과의 차이](#현재-구현과의-차이)에 정리한다.

이 문서는 다음 기존 결정을 **폐기하지 않고 확장**한다.

- [ADR-0027: 출고는 shipment 단위로 재고원장을 소진한다](./adr/0027-outbound-shipment-consumes-stock-ledger.md)

다만 [기존 출고 RFC](./outbound-shipment-ledger-rfc.md)의 다음 내용은 이번 결정으로 대체된다.

- 송장을 FO에 먼저 발급하고 스캔할 때 shipment를 지연 생성하는 흐름
- 한 shipment가 사실상 한 FO만 다루는 구현 전제
- 합배송·토탈피킹·피킹 로케이션을 당장 구현하지 않는다는 기존 비범위
- 출고 시점에 현재고를 FIFO로 찾아 차감하는 방식

정확한 테이블명, enum 값과 API 이름은 구현 설계에서 조정할 수 있다. 이 문서에서 “고정”한 것은 도메인 의미, 불변식과 상태 전이이다.

## 한눈에 보는 결론

1. SO와 FO의 직접 관계는 **0..1 : 0..1**을 유지한다. FO는 박스가 아니라 출고해야 할 SKU 수요의 스냅샷이다.
2. shipment는 실제 한 박스의 계획과 실행 단위이다. FO와 shipment는 `shipment_line`을 통해 **M:N**이다.
3. FO가 만들어지면 재고 확보 여부와 관계없이 FO 전체를 담은 최초 Draft shipment 하나를 만든다. 자동 분할은 하지 않는다.
4. 한 FO 또는 한 FOI 수량을 여러 shipment로 나눌 수 있고, 여러 FO의 라인을 한 shipment로 합칠 수 있다.
5. 실제 배송지와 수취인 정보는 shipment가 소유한다. 주문의 원본 정보는 SO/FO에 보존한다.
6. invoice는 회계 송장이 아니라 **택배 운송장/라벨 발급 이력**이다. 한 shipment에 활성 invoice는 하나이고, 변경 시 void 후 재발급한다.
7. 백오더와 부분예약을 지원한다. 예약은 창고·SKU·shipment line 수준이며 로케이션에는 고정하지 않는다.
8. batch는 FO가 아니라 shipment를 작업 대상으로 삼는다. 한 batch는 하나의 피킹 전략을 사용한다.
9. 개별출고, 토탈피킹 후 분류, shipment별 바구니 피킹은 동등한 전략이다. 공통 불변식은 orchestration 계층이 지키고 전략은 작업 계획과 스캔 의미만 결정한다.
10. 마지막 상품 검수가 끝나면 별도 완료 버튼 없이 shipment가 자동 출고된다. 이때 shipment분은 **즉시 재고원장에 반영**한다.
11. batch 내부의 카트·바구니·작업자 간 이동은 원장 이벤트가 아니라 영속적인 Batch Inventory Session 상태로 관리한다.
12. 숏피킹은 해당 shipment만 기존 batch에서 제외하고 Draft로 되돌린다. 정상 재고 예약은 유지하고 실제 부족분만 해제 또는 재시도 상태로 둔다.
13. 출고한 박스를 물리적으로 회수할 수 있으므로 보상 명령을 제공한다. 원장 출고를 역분개하고 재고는 `OUTBOUND_REWORK` 특수 로케이션으로 복귀시킨다.
14. FO의 `completed`는 배송완료가 아니라 모든 주문 수량이 `shippedQty + canceledQty`로 정산되어 창고 작업이 끝났다는 뜻이다.

## 문제와 운영 배경

### 왜 shipment가 FO와 분리되어야 하는가

FO는 판매상품을 실제 재고 SKU로 해석한 출고 수요이다. 현실의 박스 구성은 이 수요와 일치하지 않는다.

- 같은 FO의 서로 다른 상품을 여러 박스에 나눌 수 있다.
- 같은 FOI의 수량 10개를 6개와 4개로 나눌 수 있다.
- 재고가 있는 상품만 먼저 보내고 나머지를 백오더로 기다릴 수 있다.
- 여러 주문의 상품을 고객 요청에 따라 한 박스에 합칠 수 있다.

따라서 FO를 박스로 취급하거나 FO 자체를 분할하면 주문 수요와 물리 배송의 이력이 섞인다. FO는 원래 수요를 보존하고, 박스 구성의 변경은 shipment에서 표현한다.

### 왜 batch와 shipment도 분리되어야 하는가

batch는 여러 출고 작업을 묶어 실행하기 위한 작업 세션이다. 같은 batch 안에서도 각 shipment는 독립적으로 피킹·포장·출고될 수 있다. 한 shipment의 송장 발급 실패나 숏피킹이 다른 shipment의 출고를 막아서는 안 된다.

### 왜 피킹 이동을 매번 재고원장에 쓰지 않는가

물류 작업 중에는 상품이 선반, 작업자 바구니, 벌크 카트, 분류 바구니와 포장대를 빠르게 이동한다. 이를 모두 재고 이동 이벤트로 남기면 원장이 지나치게 길어지고 처리 부하도 커진다.

기존에 의도한 방식대로 batch 시작 시 해당 재고의 작업 통제권을 Batch Inventory Session으로 넘긴다. 세션 내부 이동은 mutable 작업 상태로 관리하고, 경제적·재고적 사실이 확정되는 shipment 출고와 잔여 재고 복귀만 메인 원장에 반영한다.

단, **shipment가 출고되었는데 batch가 끝날 때까지 원장 반영을 미루면 안 된다.** 각 shipment 출고 트랜잭션에서 그 shipment에 해당하는 수량을 즉시 원장에 반영하고, 아직 작업 중인 나머지만 세션에 남긴다.

## 용어와 현실의 의미

| 용어 | 시스템에서의 의미 | 현실에서의 의미 |
|---|---|---|
| SO, Sales Order | 고객과 맺은 상거래 주문 원본 | 고객이 결제하고 요청한 주문 |
| FO, Fulfillment Order | SO 상품을 실제 출고 SKU와 수량으로 변환한 스냅샷 | 창고가 충족해야 할 전체 수요 |
| FOI | FO의 SKU별 원래 수요 라인 | 특정 SKU 몇 개를 보내야 한다는 요구 |
| Shipment | 수취 정보와 구성품을 가진 물리 박스 계획 및 이력 | 택배 상자 한 개 |
| Shipment Line | FOI 수량 중 해당 박스에 할당한 양 | 그 상자에 들어갈 특정 SKU 수량 |
| Invoice | 택배사 운송장/라벨의 발급 이력 | 박스에 붙이는 송장 번호와 라벨 |
| Reservation | 특정 출고 수요에 재고를 약속한 상태 | 다른 주문이 가져가지 못하게 확보한 수량 |
| Backorder | 아직 재고가 없어 대기 중인 미충족 수요 | 입고된 뒤 나중에 보내야 하는 상품 |
| Batch | 여러 shipment를 한 번에 작업하기 위한 실행 세션 | 출고 작업 묶음 |
| Picking Strategy | batch 안에서 상품을 모으고 귀속시키는 방식 | 개별 장보기, 토탈피킹 후 분류, 바구니별 피킹 |
| Dispatch | 포장 상자를 외부 적치 장소에 내놓는 행위 | 현재 운영에서 말하는 출고완료 |
| Delivery | 택배 추적상 고객에게 전달된 상태 | 배송완료 |
| Recall | 이미 출고 처리한 상자를 물리적으로 다시 가져오는 보상 작업 | CS 등으로 상자를 열거나 다시 작업하는 행위 |

`Invoice`라는 이름은 오해하기 쉽지만 이 문서에서는 회계 세금계산서가 아니라 택배 운송장을 뜻한다.

## 목표 관계 모델

```text
SalesOrder 0..1 ───── 0..1 FulfillmentOrder
                              │
                              │ 1:N
                              ▼
                    FulfillmentOrderItem
                              │
                              │ 1:N, qty 일부 할당
                              ▼
                         ShipmentLine
                              │
                              │ N:1
                              ▼
                           Shipment ───── 1:N Invoice history
                              │                  └ active 최대 1
                              │ N:1
                              ▼
                            Batch
```

결과적으로 FO와 shipment는 M:N이다.

- FO 하나가 여러 shipment에 걸치면 송장분할 또는 백오더 출고이다.
- shipment 하나에 여러 FO의 line이 들어가면 합배송이다.
- 같은 FOI도 여러 shipment line으로 수량을 나눌 수 있다.

SO와 FO가 0..1 : 0..1인 이유는 다음과 같다.

- 디지털 상품만 있는 SO에는 FO가 없을 수 있다.
- 보상출고·교환 등으로 SO 없이 FO가 생길 수 있다.
- 하나의 상거래 주문을 여러 FO로 쪼개는 대신, 물리 분할은 shipment가 담당한다.

교환 등 독립 FO의 합배송은 모델상 허용할 수 있지만 첫 구현 범위에서는 다루지 않는다.

## 목표 흐름

```text
SO 확정
  → FO/FOI 생성
  → FO 전체를 담은 Draft shipment 자동 생성
  → 부분 재고예약, 필요하면 작업자 split/consolidate
  → 완전예약된 shipment를 Planned로 확정
  → batch에 편입하고 shipment 기준 invoice 발급·출력
  → 피킹 전략에 따라 작업
  → 포장 및 라인별 최종 검수
  → 마지막 검수와 동시에 shipment 자동 출고
  → 해당 shipment분 원장 즉시 SHIP 반영 및 예약 소진
  → 추적 이벤트로 in-transit/delivered 갱신
```

이 흐름은 현재의 “FO에 invoice 발급 → 송장 스캔 → shipment 지연 생성” 순서를 뒤집는다. 목표 모델에서는 shipment가 먼저 존재하고 invoice가 그 물리 박스의 확정된 표기를 나타낸다.

## 확정한 결정

### 1. 최초 shipment와 백오더

FO를 생성할 때 FO 전체 수량을 담은 Draft shipment 하나를 만든다.

- 재고예약 성공 여부와 관계없이 만든다.
- 자동으로 여러 상자로 나누지 않는다.
- Draft는 아직 물리적으로 포장된 상자가 아니라 변경 가능한 출고 계획이다.
- 완전히 예약된 shipment만 Planned가 되어 batch에 들어갈 수 있다.

예를 들어 A와 B를 주문했는데 A만 재고가 있다면 최초 shipment에는 A와 B가 모두 있다. 작업자가 A와 B를 두 shipment로 나누고, A shipment만 완전예약해 먼저 batch에 넣는다. B shipment는 백오더로 기다렸다가 입고와 예약에 성공하면 작업 가능해진다.

자동 분할을 하지 않는 이유는 포장 가능성, 고객 의사, 상품 특성과 입고 예상일을 시스템이 안전하게 판단하기 어렵기 때문이다.

### 2. 송장분할

분할은 다음 두 경우를 모두 지원한다.

- 서로 다른 FOI를 박스별로 나누기
- 같은 FOI의 수량을 여러 박스로 나누기

UI는 일반적으로 원 shipment 각 line에서 새 shipment로 옮길 수량을 받는다. 데이터 모델과 명령은 UI 형태에 종속되지 않아야 한다.

예약 이전의 기본 규칙은 다음과 같다.

- line을 분할할 때 예약되지 않은 수량부터 새 shipment로 옮긴다.
- 필요하면 작업자가 예약 수량도 원하는 shipment로 옮길 수 있다.
- 이미 피킹한 재고의 예약은 먼저 unpick하지 않고 이동할 수 없다.
- source와 target 변경, 수량 보존과 예약 이동은 한 트랜잭션에서 잠금과 함께 처리한다.

예: FOI 수량이 10, 예약이 6일 때 4를 새 shipment로 옮기면 기본적으로 미예약 4가 이동한다. 작업자가 명시하면 예약 2를 포함해 다른 배분도 할 수 있다.

Planned shipment는 바로 수정하지 않는다. Draft로 되돌리고, invoice가 있으면 먼저 void하며, batch에 있으면 제외하고, 피킹을 시작했으면 회수 절차를 거친다. 이미 출고된 shipment는 일반 수정이 아니라 recall 또는 반품 흐름을 사용한다.

### 3. 합배송

합배송의 대표 업무는 같은 고객·같은 주소의 여러 SO를 고객에게 확인한 뒤 한 박스로 보내는 것이다. 그러나 동일 고객 판정은 현실에서 신뢰하기 어렵고 CS 요청으로 주문과 다른 배송지에 보낼 수도 있으므로 두 층으로 나눈다.

- **후보 추천**은 보수적으로 같은 정규화 고객, 수취인과 주소일 때만 한다.
- **실제 합배송 명령**은 권한 있는 작업자가 명시적으로 실행한다.

명시적 합배송은 서로 다른 고객명이나 주소의 shipment도 허용한다. 이때 새 shipment의 수취인·연락처·배송지를 다음 중 하나로 확정한다.

- source shipment 중 하나의 값을 선택
- 완전히 새 값 입력

SO와 FO에는 원래 주문 정보가 남고, shipment 정보가 실제 배송 라벨의 진실이 된다. 주문 정보와 배송 실행 정보가 다를 수 있다는 사실 자체를 감사 가능한 이력으로 보존한다.

합배송은 전체 shipment끼리만 수행한다. 일부 line만 합치려면 먼저 해당 부분을 별도 shipment로 분할한 다음 합친다. 이 규칙은 부분 병합이라는 복잡한 명령 하나에 분할·예약·송장 처리를 중첩하지 않기 위한 것이다.

합배송 결과는 기존 shipment 하나를 재사용하지 않고 새 Draft shipment로 만든다.

- source shipment는 삭제하지 않고 `superseded`에 해당하는 상태로 남긴다.
- source가 새 shipment를 가리키도록 이력을 보존한다.
- source의 활성 invoice는 먼저 void한다.
- reason, operatorId, 선택적인 csCaseId와 note를 기록한다.

고객 동의를 별도 정형 엔티티로 만드는 것은 초기 범위가 아니다. 우선 감사 로그와 CS 참조를 남긴다.

### 4. 합배송 호환 조건과 Shipping Profile

같은 판매채널인지는 합배송 필수 조건이 아니다. 서로 다른 채널에서 판매했어도 FO 단계에서 같은 SKU로 매칭되고 실제 출고 주체와 조건이 같으면 합칠 수 있다.

초기 합배송의 강제 조건은 다음과 같다.

- 같은 창고
- 같은 Shipping Profile
- 모두 자사 통제 재고이며 자사가 실제 발송
- drop-ship이 아님

Shipping Profile은 최소한 다음 배송 실행 조건을 묶는다.

- 보내는 사람 이름과 연락처
- 출발지와 반송지
- 택배사 계약 또는 계정
- 지원하는 fulfillment mode와 취급 조건

구현 시 기존 `delivery_profiles`가 이 의미를 수용할 수 있는지 먼저 확인하고 중복 엔티티를 만들지 않는다.

재고 소유권이 다르다는 이유만으로 모든 합배송을 막지는 않는다. 재고와 발송을 우리가 통제한다면 가능해야 한다. 소유도 발송도 외부에 있는 drop-ship은 별도 도메인으로 분리하고 합배송하지 않는다.

SO의 배송비는 고객에게 원래 청구한 상거래 정보로 유지한다. shipment에는 실제 운송 비용을 기록할 수 있다. 합배송했다고 자동 환불하거나 배송비를 자동 배분하지 않으며, 필요한 환불은 CS/주문 변경 흐름이 담당한다.

### 5. Invoice, 운송장과 구성 잠금

invoice는 shipment에 발급한다.

- 발급 명령의 기준은 FO가 아니라 shipment이다.
- 라벨의 상품 정보는 여러 FO에 걸친 shipment line에서 만든다.
- shipment 하나에는 활성 invoice가 최대 하나이다.
- void/reissue 이력은 모두 보존한다.
- invoice 발급 시점부터 shipment 구성, 수취인과 배송지는 잠긴다.

구성이나 라벨 표기 사실이 바뀌면 기존 invoice를 사용할 수 없다. 반드시 void한 뒤 shipment를 Draft로 되돌리고 새 invoice를 발급한다.

batch 준비 중 여러 shipment의 invoice를 발급할 때 하나가 실패해도 이미 정상 발급된 invoice를 모두 void하지 않는다. 실패한 shipment만 재시도하거나 batch에서 제거하고 나머지는 진행한다. 외부 void가 실패한 shipment는 Draft로 되돌리지 않고 복구가 필요한 차단 상태에 둔다.

숏피킹으로 다음 작업에 넘기는 경우 표기 내용이 우연히 같더라도 invoice를 void한다. 다음 batch에서 새로 출력한다는 운영 규칙과 상태 일관성을 우선한다. recall 후 재출고도 항상 새 invoice를 사용한다.

### 6. FO와 shipment 상태의 의미

배송 관련 맥락은 FO가 아니라 shipment가 가진다. FO 상태는 전체 수요의 창고 이행 진척을 요약한다.

shipment의 개념적 정상 흐름은 다음과 같다. 정확한 enum을 이대로 만들라는 뜻은 아니며, 구성 가능·작업 확정·실제 반출·배송 추적의 의미를 섞지 않는 것이 핵심이다.

```text
Draft → Planned → Batch 작업 중 → Shipped → In transit → Delivered
  │         │            │
  ├─ Canceled
  ├─ Superseded
  └← 변경/숏피킹/recall 복구(필요한 invoice void와 재고 보상 선행)
```

invoice 발급 여부는 shipment 구성 잠금과 연결되지만 배송 자체의 생명주기와 완전히 같은 상태축으로 취급할 필요는 없다.

- 작업이 남아 있으면서 일부만 출고되었으면 부분출고 상태가 필요하다.
- `completed`는 모든 FOI의 원래 수량이 출고 또는 취소로 정산되어 창고 작업이 남지 않은 상태이다.
- 배송완료 여부는 shipment 추적 상태로 계산한다.

FOI별 핵심 식은 다음과 같다.

```text
originalQty = shippedQty + canceledQty + outstandingActiveShipmentQty
```

종결 시점에는 다음이 성립한다.

```text
originalQty = shippedQty + canceledQty
```

일부를 출고하고 나머지를 취소한 FO도 `completed`가 된다. 결과의 성격은 `shippedQty`와 `canceledQty`로 알 수 있다. 전량 취소에는 별도 `canceled` 상태를 유지할 수 있다.

`delivered`를 FO 완료 조건으로 쓰지 않는다. 반대로 shipped shipment를 recall하면 `shippedQty`가 줄고 작업이 다시 생기므로 이미 completed였던 FO도 재개될 수 있다.

### 7. 취소와 주문 변경

아직 출고하지 않은 수량은 축소하거나 취소할 수 있다.

- Draft: line을 줄이거나 제거하고 예약을 환원한다.
- Planned: Draft로 되돌린 뒤 변경한다.
- Invoiced: invoice void 성공 후 변경한다.
- Batch/picking 중: batch에서 제외하고 이미 집은 재고를 복귀시킨 뒤 변경한다.
- Shipped: 원 shipment를 고치지 않고 반품·환불 또는 recall 조건에 맞는 보상 흐름을 사용한다.

합배송 shipment 안에서 한 source SO가 취소되면 해당 shipment를 그대로 출고하지 않는다. invoice를 void하고 Draft로 되돌린 후 관련 line을 제거하고 남은 내용으로 재발급한다.

향후 반품은 최소한 `shipmentLineId`, `dispatchAttemptId`, FOI와 수량을 식별할 수 있어야 한다. split, merge와 recall이 있으면 shipment header만으로 어떤 출고분을 반품하는지 모호하기 때문이다. 전체 반품 도메인 재설계는 이번 범위가 아니지만 이 연결점은 막지 않는다.

### 8. 부분예약과 예약 우선순위

예약은 같은 FOI에서도 일부 수량만 성공할 수 있어야 한다. 예를 들어 10개 중 6개 예약을 표현한다.

기본 우선순위는 먼저 들어온 line이 먼저 재고를 선점하는 것이다. split/merge로 컨테이너가 바뀌어도 원래 요청 시각을 보존한다. 필요하면 작업자가 재고를 특정 주문으로 몰아주도록 예약을 이동하거나 우선순위를 바꿀 수 있다.

예약 이동의 조건은 다음과 같다.

- 같은 SKU와 창고
- source에 피킹되지 않은 예약 수량이 충분함
- target에 미충족 수량이 충분함
- 창고 전체 예약 합계는 변하지 않음
- operator, 사유와 선택적인 CS 근거 기록

예약을 장기적으로 로케이션까지 고정하지 않는다. 로케이션 이동 때마다 예약 위치를 같이 변경해야 하고, 정상적인 창고 내 이동과 예약 도메인이 강하게 결합되기 때문이다.

대신 다음을 분리한다.

- **Reservation**: 어떤 shipment line이 어느 창고의 SKU 몇 개를 확보했는가
- **Picking Source Allocation**: 이번 batch 실행에서 어느 로케이션의 재고를 집을 것인가

batch에 넘겨진 source 수량은 일반 이동에서 제외하거나 계획을 무효화하고 재계획해야 한다. 일련번호, lot, 유통기한, 재고 상태 또는 handling unit을 예약해야 하는 요구가 생기면 location/identity-specific reservation을 별도로 재검토한다.

### 9. Batch의 작업 단위

batch는 FO 대신 shipment를 포함한다.

- 하나의 batch에는 여러 shipment가 있다.
- 한 shipment는 동시에 하나의 활성 batch에만 속한다.
- 완전예약되고 Planned인 shipment만 batch에 들어간다.
- FO와 batch의 관계는 FOI → shipment line → shipment → batch를 통해 유도한다.
- batch 시작 후 피킹 전략은 바꾸지 않는다.
- 각 shipment는 다른 shipment와 독립적으로 출고될 수 있다.

batch는 모든 member가 다음 중 하나가 되면 끝난다.

- 정상 완료
- 명시적으로 제외
- 숏피킹 복구 흐름으로 인계

batch 전체에 작업자 한 명을 할당하지 않는다. 특히 개별출고 방식에서는 여러 작업자가 같은 batch의 shipment를 하나씩 claim한다.

### 10. 세 가지 피킹 전략

세 방식은 모두 동등하며 시스템 기본 전략을 두지 않는다.

#### 개별출고, discrete

여러 작업자가 쌓여 있는 invoice 중 하나를 스캔해 shipment를 claim한다. 각자 바코드 없는 개인 바구니로 상품을 피킹해 포장대로 가져오고, 포장 인계 후 다음 shipment를 claim할 수 있다.

- claim 단위는 shipment
- 한 picker의 활성 picking claim은 한 번에 하나
- 개인 바구니는 엔티티로 만들거나 가짜 바코드를 요구하지 않음
- invoice가 물리적 식별자 역할을 함
- picker와 packer가 다를 수 있음

#### 토탈피킹 후 분류, aggregate then sort

batch 전체 SKU 수량을 큰 카트에 모은 뒤, 분류 단계에서 바코드가 있는 shipment별 tote에 나눈다.

- 수집 중에는 batch 전체 `collectedQty`를 기록
- 분류될 때 shipment별 `assignedQty`를 기록
- 한 SKU의 실제 source location bucket은 세션 안에서 보존

#### shipment별 바구니 피킹, pick to tote

바코드가 있는 여러 바구니가 카트에 달려 있고 각 바구니가 shipment에 배정된다. 창고를 한 바퀴 돌며 바로 맞는 바구니에 담으므로 별도 분류 단계가 없다.

- destination tote를 피킹 전에 배정
- 하나의 shipment가 여러 tote를 쓰는 모델을 허용
- tote는 shipment와 같지 않으며 포장 전 운반 용기일 뿐임

에어캡 처리 등으로 피킹 즉시 실제 박스에 넣지 못하므로 “tote = shipment 박스”로 모델링하지 않는다.

### 11. 피킹 전략 아키텍처

전략별로 별도 클래스/provider를 두되 재고와 상태 전이 로직을 복제하지 않는다.

권장 구조는 다음과 같다.

```text
PickingOrchestrator
  ├─ PickingStrategyRegistry
  ├─ DiscretePickingStrategy
  ├─ AggregateThenSortStrategy
  └─ PickToToteStrategy

공통 서비스
  ├─ claim/lease와 동시성 제어
  ├─ Batch Inventory Session
  ├─ reservation과 shipment 불변식
  ├─ packing/inspection
  ├─ invoice 상태 전이
  └─ dispatch/ledger settlement
```

상속 기반의 큰 base class보다 작은 공통 인터페이스와 조합을 선호한다. 전략은 다음만 결정한다.

- 작업 계획 생성
- claim의 단위와 스캔 의미
- cart/tote 요구 여부
- 수집량을 shipment에 귀속시키는 시점
- shortage가 현재 계획에 미치는 영향

전략이 재고원장 기록, 예약 소진, FO 완료 계산, invoice void 규칙을 직접 구현해서는 안 된다.

Picking Plan은 shipment 구성, 예약과 source allocation의 버전을 스냅샷으로 가진다. 이 중 하나가 바뀌면 기존 plan을 무효화한다. route optimization은 별도 관심사이다.

### 12. 작업 claim, 바구니와 인계

batch-shipment 참여를 나타내는 work item이 필요하다. 정확한 enum 이름은 구현에서 정하되 다음 의미를 표현해야 한다.

```text
queued → claimed/picking → ready_to_pack → packing → completed
                    └────→ short_pick_recovery
                    └────→ excluded
```

- picker claim과 packer claim을 분리한다.
- packer는 포장대에서 invoice를 스캔해 인수할 수 있다.
- 작업자, claim 시각, 인계 시각을 기록한다.
- abandoned claim을 시간만 보고 자동 재할당하지 않는다. 상품이 작업자의 물리적 바구니에 있을 수 있으므로 확인 절차가 필요하다.
- 스캔 명령은 멱등하고 row lock 또는 동등한 동시성 보호를 사용한다.
- 여러 작업자와 여러 카트를 데이터 모델상 허용한다.

`assignedQty`는 shipment 또는 tote에 실제 귀속된 수량이다. 개별출고와 pick-to-tote에서는 피킹할 때 증가하고, aggregate에서는 분류할 때 증가한다. `inspectedQty`는 최종 박스 검수 수량으로 전략과 무관하다.

### 13. 포장, 검수와 자동 출고

포장과 최종 검수는 피킹 전략 밖의 공통 흐름이다. 현재 운영에서는 마지막 상품 검수가 끝났을 때 곧바로 출고완료로 처리한다. 별도 완료 버튼은 누락 위험이 커서 두지 않는다.

여기서 `shipped`는 택배사 인수 스캔이 아니라 포장한 상자를 외부 출고 장소에 내놓은 상태이다. 택배사가 실제 가져간 시점은 안정적으로 관찰할 수 없으므로 재고 소진 트리거로 사용하지 않는다. 관찰 가능한 경우 carrier acceptance를 nullable 추적 이벤트로 기록할 수 있다.

마지막 검수의 자동 출고 트랜잭션은 적어도 다음을 원자적으로 처리한다.

- 모든 shipment line 검수 완료 확인
- 활성 invoice와 구성 버전 확인
- Batch Inventory Session에 해당 수량 존재 확인
- dispatch attempt 생성
- source location별 SHIP 원장 반영
- 예약 소진
- shipment, FOI와 FO 진행 상태 갱신
- outbox 이벤트 기록

강제출고가 필요하면 권한과 감사를 요구하고, 남은 검수 수량을 채운 뒤 동일한 자동 출고 경로를 사용한다. 별도 우회 원장 경로를 만들지 않는다.

### 14. Batch Inventory Session과 재고원장

batch가 시작되면 포함된 재고의 작업 통제권을 영속적인 Batch Inventory Session으로 넘긴다. 메인 원장상 source location을 매 피킹마다 바꾸지 않는다.

세션은 source location과 SKU별 수량 보존을 유지하면서 다음 같은 운영 상태를 표현할 수 있다.

```text
AT_SOURCE
IN_WORKER_CUSTODY
IN_BULK_CART
IN_TOTE
AT_SORTING
AT_PACKING
PACKED
RETURN_PENDING
SETTLED
```

개인 바구니에는 tote ID를 요구하지 않고 worker와 shipment 귀속으로 표현한다. 세션은 메모리에만 두지 않으며 DB에 영속화하고 version, 멱등키와 복구 가능한 변경 이력을 가져야 한다.

메인 원장과 운영 조회의 관계는 다음과 같다.

- 메인 원장은 작업 중 재고를 원래 source location에 둔다.
- 조회는 그중 batch가 통제하는 수량을 overlay하여 일반 이동 가능 수량에서 제외한다.
- cart, tote, 작업자 바구니와 포장대는 메인 원장의 location이 아니다.
- batch-controlled 수량을 일반 이동이 사용할 수 없어야 한다.

가장 중요한 정산 규칙은 다음과 같다.

#### shipment가 출고될 때

해당 shipment에 귀속된 수량만 source location bucket별로 즉시 SHIP 처리한다. reservation을 소진하고 세션 수량을 `SETTLED`로 표시한다. 같은 batch의 다른 shipment 재고는 계속 세션 통제 상태로 남는다.

aggregate 방식처럼 물리 개체를 구별하지 않는 SKU는 세션이 가진 source bucket에서 결정적인 규칙으로 수량을 배분한다. fungible SKU의 개별 물건 ID를 인위적으로 만들 필요는 없다.

#### batch가 종료될 때

종료는 이미 출고된 shipment를 다시 정산하는 시점이 아니다. 남은 수량만 처리한다.

- 같은 source location으로 복귀: 재고 사실이 바뀌지 않았으므로 MOVE 이벤트 없음
- 다른 일반 또는 rework location으로 복귀: 집계된 MOVE
- 실제 부족 또는 파손: 사유에 맞는 조정 이벤트

항상 다음 보존식이 성립해야 한다.

```text
session에 인계된 수량
= 아직 session에 남은 수량
 + shipment 출고로 정산된 수량
 + source/다른 location으로 반환된 수량
 + 승인된 shortage/defect 조정 수량
```

“batch가 끝날 때 모든 출고를 한 번에 원장에 쓴다”는 안은 폐기했다. shipment가 독립 출고된 사실이 원장에 늦게 나타나고 batch가 장시간 열려 있을 수 있기 때문이다.

### 15. 숏피킹

숏피킹이 발생해도 다른 shipment는 계속 진행한다. 해당 shipment만 다음과 같이 처리한다.

1. 현재 work item을 short-pick recovery로 보낸다.
2. 기존 batch에서 즉시 제외한다.
3. 활성 invoice를 void한다.
4. 이미 피킹한 상품을 세션에서 source 또는 반환 예정 상태로 복귀시킨다.
5. shipment를 Draft로 돌리고 이후 새 batch에 편입한다.

예약은 전부 해제하지 않는다.

- 실제로 존재가 확인된 정상 재고의 예약은 유지한다.
- 실제 부족한 수량만 예약을 해제, 무효 또는 재시도 상태로 둔다.
- 이미 다른 shipment로 예약 이동이 필요하면 명시적인 예약 이전 명령을 사용한다.

invoice void 실패나 물리 수량 불일치는 정상 Draft가 아니라 복구가 필요한 차단 상태로 남긴다.

### 16. 출고 회수, Recall

마지막 검수 직후 자동 출고하기 때문에, 외부에 내놓은 상자를 CS 사유 등으로 다시 가져오는 기능이 필요하다. 이를 단순한 status rollback이 아니라 보상 명령으로 구현한다.

Recall 조건과 결과는 다음과 같다.

- 실제로 상자를 물리 회수할 수 있는 shipped 상태에서만 수행
- 이미 delivered이면 반품 흐름 사용
- reason, operatorId, 선택적인 csCaseId와 note 필수
- 기존 invoice는 항상 void
- 기존 SHIP 원장을 역분개
- FOI `shippedQty`와 FO 상태 재계산 및 필요하면 reopen
- shipment는 안전한 재검수와 새 batch, 새 invoice를 거쳐야 함

복귀 재고는 일반 판매 로케이션에 바로 넣지 않고 `OUTBOUND_REWORK` 특수 로케이션으로 넣는다. 예약을 복원하므로 수학적으로 `on_hand`와 `reserved`가 함께 증가하고 available은 변하지 않는다.

- 원 shipment의 복원 예약은 유지한다.
- 다른 주문이 사용하려면 명시적인 예약 이전이 필요하다.
- 예약이 없는 정상 rework 재고는 이후 allocation 대상이 될 수 있다.
- 급하면 다음 피킹 계획이 `OUTBOUND_REWORK`에서 직접 집도록 할 수 있다. 예를 들어 같은 SKU 8개를 정상 로케이션에서 5개, `OUTBOUND_REWORK`에서 3개 집도록 source allocation을 만들 수 있다.
- 여유가 생기면 이동작업으로 본래 또는 일반 로케이션에 돌려놓는다.
- 품질이 의심되면 rework가 아니라 별도 quarantine 흐름을 사용한다.

같은 shipment가 출고, recall, 재출고될 수 있으므로 dispatch attempt 이력이 필요하다. attempt마다 번호, 출고·회수 시각, 원장 journal과 reversal journal을 연결하고 멱등성을 attempt 단위로 보장한다.

외부 판매채널이 출고취소를 지원하지 않더라도 Core의 사실은 정확히 보상한다. adapter에서 수동 조정 필요 상태를 만들고 재출고 시 새 tracking 정보를 보낸다.

### 17. 특수 로케이션

이름 문자열인 “xx기본존”에 로직을 의존하지 않고 창고별 semantic system role을 사용한다. 현재 시스템의 `isSystem`과 `systemRole` 개념은 방향은 맞지만 다음 보강이 필요하다.

- `outbound_rework` role 추가
- 창고별 필수 role 존재 보장
- 필수 system location 비활성화 방지 또는 안전한 전환 절차
- 이동 명령에서 active 및 batch-controlled 수량 검증

`OUTBOUND_REWORK`는 batch 사이에도 재고가 실제로 머물 수 있으므로 메인 원장의 진짜 location이다. 반면 worker/cart/tote/packing/staging은 batch 세션 내부 상태이므로 전역 원장 location으로 만들지 않는다.

### 18. 이벤트 의미

이벤트 이름은 구현에서 조정할 수 있지만 의미는 분리한다.

- shipment dispatch attempt마다 `ShipmentShipped` 성격 이벤트 한 번
- 영향을 받은 FO마다 partial/full 진행 이벤트
- FO 전체가 출고로 충족된 경우에만 기존 `FulfillmentShipped` 성격 이벤트를 발행
- 모든 관련 shipment가 delivered된 시점의 배송완료 이벤트는 별도
- recall 시 `ShipmentDispatchRecalled`, `FulfillmentReopened` 성격의 보상 이벤트

FO 일부만 출고했는데 기존 consumer가 FO 전체 출고로 오인하지 않게 해야 한다. 상태, 원장과 outbox는 같은 트랜잭션에서 커밋한다.

### 19. 권한과 감사

일반 창고 작업자가 수행할 수 있는 일:

- shipment 분할과 계획
- 피킹, 포장과 검수
- 정상 자동 출고 흐름

높은 권한 또는 CS 권한을 요구할 일:

- 서로 다른 주문의 합배송
- shipment 수취인과 주소 override
- 예약 이전과 우선순위 override
- 강제출고
- recall
- 잠긴 shipment 구성 재개방

위험 명령에는 operatorId와 reason을 필수로 하고 csCaseId와 note를 수용한다. 변경 전후 값, source/target shipment와 영향을 받은 FO를 감사 로그로 연결한다.

## 핵심 불변식

구현과 테스트는 다음을 직접 검증해야 한다.

### 수요와 구성

1. FOI의 원래 수량은 직접 덮어쓰지 않는다.
2. `originalQty = shippedQty + canceledQty + outstandingActiveShipmentQty`가 항상 성립한다.
3. active shipment line 수량은 음수가 아니며 source FOI 잔여 수량을 넘지 않는다.
4. superseded/canceled shipment line은 outstanding 합계에 중복 포함하지 않는다.

### 예약

5. shipment line 예약 수량은 그 line의 미출고·미취소 수량을 넘지 않는다.
6. 한 창고·SKU의 예약 합은 가용한 예약 가능 수량을 넘지 않는다.
7. 예약 이전 전후 창고·SKU 총예약량은 같다.
8. 피킹된 예약은 unpick 없이 이동하지 않는다.

### Shipment와 invoice

9. shipment에는 활성 invoice가 최대 하나이다.
10. invoice 발급 이후 구성·수취 정보 변경은 void 성공 없이는 불가능하다.
11. 출고된 dispatch attempt는 같은 멱등키로 두 번 원장 소진되지 않는다.
12. shipped shipment는 recall/return 외의 일반 수정이 불가능하다.

### Batch와 세션

13. shipment는 한 번에 하나의 활성 batch에만 속한다.
14. 완전예약되고 Planned인 shipment만 batch 작업을 시작한다.
15. batch-controlled 수량은 일반 이동 또는 다른 batch가 사용할 수 없다.
16. Batch Inventory Session 보존식이 항상 성립한다.
17. shipment 출고 시 그 shipment 수량은 batch 종료를 기다리지 않고 즉시 원장에 반영된다.
18. 이미 shipment에서 정산된 세션 수량을 batch 종료 시 다시 정산하지 않는다.

### 출고와 회수

19. 마지막 라인 검수와 dispatch 원장 반영은 하나의 원자적 흐름이다.
20. 정상 출고에서 `on_hand`와 `reserved`가 같은 수량만큼 줄어 available은 변하지 않는다.
21. recall에서 `on_hand`와 `reserved`가 같은 수량만큼 복원되어 available은 변하지 않는다.
22. recall 복원 재고는 `OUTBOUND_REWORK`에 들어간다.

## 대안과 기각 이유

| 대안 | 채택하지 않은 이유 |
|---|---|
| FO를 분할해서 여러 박스를 표현 | 주문 수요 스냅샷과 물리 포장 이력이 섞이고 합배송을 표현하기 어려움 |
| 재고가 확보된 line만 자동 shipment 분할 | 입고 예상, 포장 조건과 고객 의사를 시스템이 안전하게 판단할 수 없음 |
| 같은 고객·주소만 DB 제약으로 합배송 | 고객 동일성 판정이 불완전하고 CS가 주문과 다른 배송을 요청할 수 있음 |
| 합배송 시 source shipment 하나를 수정 | 원래 박스 계획과 송장 이력이 사라지고 감사·복구가 어려움 |
| 부분 line을 merge 명령에서 직접 선택 | split, 예약 이동, invoice void를 한 명령에 중첩해 복잡성과 실패 표면이 커짐 |
| 한 invoice 발급 실패 시 batch 전체 invoice void | 서로 독립적으로 출고 가능한 정상 shipment까지 불필요하게 되돌림 |
| reservation에 locationId를 영구 저장 | 창고 내 이동 때 예약도 함께 이동해야 하고 이동/예약 도메인이 과도하게 결합됨 |
| 출고 시점에 그때 보이는 FIFO location을 조회 | batch가 실제 집은 위치와 원장 차감 위치가 달라질 수 있음 |
| 모든 피킹 이동을 메인 stock ledger에 기록 | 이벤트 폭증과 성능 부담, 작업 중 임시 상태가 경제적 재고 사실과 뒤섞임 |
| batch 종료 시 모든 shipment를 일괄 원장 정산 | 독립 출고 사실이 지연되고 장시간 열린 batch에서 재고 진실이 틀림 |
| cart/tote/worker를 전역 system location으로 표현 | 짧은 작업 상태가 원장 구조를 오염시키고 모든 스캔이 MOVE가 됨 |
| 모든 피킹 전략을 조건문 하나로 구현 | claim, 분류, 귀속 시점과 shortage 처리 차이가 커 변경 시 결합도가 높음 |
| 개인 바구니에 필수 바코드 부여 | 실제 운영에 바코드가 없고 불필요한 가상 엔티티를 강요함 |
| 택배사 인수 시점에 shipped 처리 | 인수 시점을 안정적으로 관찰할 수 없고 현재 운영의 출고완료와 맞지 않음 |
| 명시적 완료 버튼으로 dispatch | 작업자가 누락할 위험이 현재 자동완료의 위험보다 큼 |
| 숏피킹 때 정상 예약까지 전부 해제 | 이미 확인된 재고를 다른 주문이 가져가 백오더가 더 악화될 수 있음 |
| recall을 status rollback으로 처리 | 원장, 예약, invoice, 외부 이벤트와 반복 출고 이력을 정확히 보상할 수 없음 |

## 현재 구현과의 차이

이 항목은 문서 작성 시점의 Core 코드에 대한 감사 결과이다. 구현 전 다시 확인해야 한다.

| 영역 | 현재 구현 | 목표 결정 |
|---|---|---|
| SO↔FO | 부분 unique로 사실상 0..1:0..1이나 일부 relation 선언은 다수처럼 보일 수 있음 | 의미와 ORM relation 모두 0..1:0..1로 정렬 |
| shipment 생성 | invoice 스캔 시 lazy 생성하고 FO 잔여 전체를 복제 | FO 생성 시 전체 Draft shipment 선생성 |
| FO↔shipment | 테이블은 M:N 가능성이 있으나 서비스는 한 shipment/한 FO를 전제 | split과 consolidation을 실제 M:N 흐름으로 지원 |
| invoice | FO 기준 발급, nullable shipment 연결 | shipment 기준 발급, active 하나와 이력 |
| 출고 소진 | 한 FO 전체 예약 소진과 FO shipped 갱신을 전제 | shipment line별 부분 소진과 여러 FO 진행 갱신 |
| 예약 | FO target, 창고·SKU 단위, 사실상 전량 성공 중심 | shipment line target의 부분예약과 예약 이전 |
| 위치 차감 | 출고 시 FIFO로 현재 위치 조회 | batch source allocation과 세션 bucket에 따라 차감 |
| batch | FO 중심 연결과 FOI counter 중심 | shipment work item과 전략별 plan 중심 |
| 피킹 전략 | 목표 세 전략을 위한 공통 abstraction 부족 | orchestrator + strategy providers + 공통 invariant 서비스 |
| FO completed | delivered와 가까운 의미 | shipped+canceled로 창고 작업이 끝난 의미 |
| 합배송 추천 | 실제 업무 판정이 아닌 stub/임시 로직 존재 가능 | 보수적 후보 추천 + 명시적 권한 명령 |
| system location | `inbound_default`, `return_default` 중심 | `outbound_rework` 추가와 보호 규칙 강화 |
| dispatch 반복 | shipment 한 번 출고 중심 | dispatch attempt와 recall/re-dispatch 이력 |

특히 현재 `openBoxByScan`, FO 기준 `issueInvoice`, FO 전체 예약을 소진하는 outbound consumption, FO를 직접 batch에 연결하는 구조는 목표 모델과 충돌할 가능성이 높다. 구현은 스키마만 보고 가능하다고 판단하지 말고 서비스의 암묵적 1:1 전제를 함께 제거해야 한다.

## 후속 기술 설계 확정 상태

제품 결정 이후 남아 있던 다음 기술 항목은 [V2 기술 설계](./superpowers/specs/2026-07-14-outbound-consolidation-split-backorder-technical-design.md)에서 확정했다.

1. 현재 `delivery_profiles`를 Shipping Profile로 확장할지 별도 모델이 필요한지
2. shipment, work item, Batch Inventory Session과 dispatch attempt의 정확한 테이블 구조와 enum 이름
3. 기존 fulfillment 트랜잭션과 FO target reservation을 명시적으로 정리하고 shipment line 부분예약으로 hard cutover하는 migration
4. FO/FOI 기존 상태와 consumer를 부분출고·정산 완료 의미로 전환하는 호환 계획
5. 택배사 invoice 발급/void 외부 호출과 DB 상태 전이의 saga 및 복구 상태
6. aggregate source bucket의 결정적 소비 순서와 동시성 잠금
7. system location 비활성화와 batch-controlled stock 이동을 막는 구체적 constraint/service guard
8. 기존 채널 이벤트 consumer가 부분출고를 전체출고로 해석하지 않게 하는 버전 전환
9. 기존 shipment/invoice/reservation을 이관하지 않고 SKU/SO/stock ledger를 보존하는 explicit cleanup과 expand-contract 전략

role의 정의·부여는 user-service를 SoT로 하고 Core는 `logistics_worker`/`logistics_manager`를 fulfillment scope에 매핑한다. mixed Shipping Profile은 Draft까지만 허용하며 Planned 전 profile별 shipment 분할을 강제한다. 정확한 table/column/enum 문자열은 위 의미와 불변식을 바꾸지 않는 범위에서 implementation plan에 위임한다.

## 초기 구현 비범위

- 외부 업체가 재고를 소유하고 직접 발송하는 drop-ship 통합
- 교환·보상 등 SO 없는 FO의 합배송 UI와 운영 흐름
- serial, lot, 유통기한, 개별 handling unit 예약
- 시스템의 자동 shipment 분할 또는 박스 크기 추천
- 실제 택배사 인수 시점의 필수 관찰
- 합배송에 따른 배송비 자동 배분·환불
- 모든 판매채널의 출고취소 API 자동화
- 고객 합배송 동의의 별도 정형 엔티티
- 전체 반품 도메인의 재설계
- 고급 운송 제약 최적화와 피킹 경로 최적화

비범위라는 뜻은 데이터 모델이 이를 영구히 막아도 된다는 뜻이 아니다. 특히 return은 shipment line과 dispatch attempt를 참조할 수 있게 하고, picking strategy는 추후 추가할 수 있는 registry 구조를 둔다.

## 반드시 통과해야 할 대표 시나리오

1. A/B 주문에서 A만 예약되고, 작업자가 A shipment와 B backorder shipment로 나눠 A만 먼저 출고한다.
2. 동일 FOI 10개를 6/4로 나눠 두 invoice로 독립 출고한다.
3. 서로 다른 두 FO의 전체 shipment를 새 수취 정보로 합치고 source 이력과 void invoice를 보존한다.
4. 합배송 shipment의 한 source 주문이 취소되어 invoice void, Draft 재계획, 남은 line 재발급이 이루어진다.
5. 서로 다른 판매채널이지만 같은 창고와 Shipping Profile인 두 shipment를 합친다.
6. invoice 하나의 발급 실패가 같은 batch의 다른 shipment 출고를 막지 않는다.
7. discrete batch에서 여러 작업자가 shipment를 경쟁 없이 하나씩 claim하고 picker→packer 인계한다.
8. aggregate 방식에서 batch 수집량, 분류 후 shipment 귀속량과 source bucket 보존이 맞는다.
9. pick-to-tote에서 여러 바코드 tote와 하나의 shipment 다중 tote를 처리한다.
10. 숏피킹 shipment만 제외·void·Draft가 되고 다른 shipment는 출고되며 정상 예약은 유지된다.
11. 마지막 검수 시 shipment가 자동 출고되고 batch가 열려 있어도 그 수량이 원장에 즉시 반영된다.
12. 같은 batch의 두 shipment가 시간차로 출고되어 각각 한 번만 원장 정산되고 batch 종료 때 중복 차감되지 않는다.
13. 출고한 shipment를 recall하여 SHIP 역분개, 예약 복원, `OUTBOUND_REWORK` 복귀와 FO reopen이 이루어진다.
14. recall한 같은 shipment가 새 dispatch attempt와 invoice로 다시 출고된다.
15. 일부 출고 후 나머지 취소된 FO가 completed가 되고 수량 결과가 정확하다.
16. batch-controlled source 수량을 일반 재고 이동이 가져가지 못한다.
17. crash 후 Batch Inventory Session을 복구해 수량 보존식과 멱등 dispatch를 유지한다.

## 결정의 최종 기준

이 설계의 중심은 세 가지 진실을 분리하는 것이다.

- **주문 진실**: SO와 FO가 고객 주문과 원래 SKU 수요를 보존한다.
- **배송 진실**: shipment와 invoice가 실제 어느 수취인에게 어떤 박스를 보냈는지 보존한다.
- **재고 진실**: reservation, Batch Inventory Session과 stock ledger가 약속된 수량, 작업 중 수량과 실제 반출을 서로 다른 시간축으로 정확히 보존한다.

split, consolidation, backorder, 다양한 picking strategy와 recall은 이 세 진실을 섞지 않을 때 같은 모델 위에서 일관되게 동작한다.
