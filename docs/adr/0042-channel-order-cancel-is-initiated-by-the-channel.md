# 채널 주문의 취소·환불은 채널이 시작한다 — core 는 문지기

## Status
Accepted (2026-10-07). ADR-0040 §5.5 를 부분 대체한다 — **대체:** 채널 주문의 취소·환불을 누가 시작하는가, core → Medusa
취소 역투영. **유지:** 주문 성립은 Medusa, 이행·취소 가능 «판정»은 core sales-order, 돈 이동의 실행은 wallet,
배송 상태 역투영(`updateOrderShippingProjection`). 트래킹 #1016 35번·31번 행.
설계: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md`.

## Context
ADR-0040 §5.5 는 «취소 판정은 Core, 돈 이동은 wallet, Core → Medusa 취소 역투영 유지»라고 이름만 붙였다. 그 모양대로
core 가 판매주문을 취소하고 wallet 에 직접 환불한 뒤 Medusa 에 취소를 보내면, Medusa 2.13.4 `cancelOrderWorkflow` 가
캡처된 결제를 스스로 다시 환불한다(`refundCapturedPaymentsWorkflow` → `almond-payment.refundPayment`). Medusa 는 core 가 한
환불을 모른다 — wallet 환불 사실은 Medusa 결제 metadata 만 고친다. 돈은 wallet 의 환불가능액 검사가 막아 두 번 나가지
않지만, core 환불이 `PENDING` 인 무통장이면 Medusa 취소가 실패해 core 와 Medusa 가 갈리고, core 환불이 실패하면 Medusa 가
대신 환불해 기록이 어긋난다. 부분취소는 Medusa 에 아예 가지 않고, core 는 할인·배송비·포인트 배분을 계산하지 못해
환불을 «추정 + 수동»으로 남긴다.

#1016 판단 10(2026-10-05)은 «채널 주문의 정본은 그 채널, 운영자의 취소·수정은 채널에 먼저 요청하고 다시 끌어와 반영»으로
정했다. §5.5 의 «돈 이동은 wallet» 은 «wallet 을 누가 부르는가»를 정하지 않았고, 그 빈칸을 core 와 Medusa 가 둘 다 채웠다.

## Decision

원칙 넷.

1. **환불을 시작하는 쪽은 주문마다 하나다.** 채널 주문은 그 채널이 시작한다 — Medusa 주문은 Medusa 가 almond-payment →
   wallet 으로, 네이버·쿠팡은 그 채널이 스스로. core 는 core 직접 주문에만 wallet 을 부른다. 환불액 계산(할인 배분·배송비·
   포인트)은 커머스 엔진의 일이고, Medusa 가 그 엔진이다(ADR-0040 §1).
2. **core 는 문지기다.** 물리적으로 멈출 수 있는지를 판정하고, 요청을 기록하며 출고를 보류한 뒤 명령
   (`channel-orders.commands.v1` `CancelChannelOrder`)을 낸다. 확정은 수집(`OrderCancelled`·`OrderModified`)으로 받는다.
   채널에 먼저 요청하면 «채널이 환불한 뒤 창고가 출고»하는 경합이 생기는데, 보류가 그 틈을 닫는다.
3. **Medusa 장부에는 모든 환불이 남는다.** Medusa 밖에서 시작된 wallet 환불(관리자 환불·무통장 환불 승인)도 Medusa refund
   레코드로 투영한다 — 캡처 투영과 같은 패턴(결제 data 표식 + provider 가 wallet 호출을 건너뜀). 그래야 Medusa 의
   «캡처 − 환불»이 맞고, 누가 먼저 환불했든 Medusa 취소가 다시 환불하지 않는다.
4. **실패는 사실로 돌아오고, 무응답은 정체 보드가 잡는다.** channel-adapter 는 정해진 실패를 `ChannelOrderCancelRejected`
   로 낸다. 성공은 따로 내지 않는다 — 재수집된 주문이 곧 사실이다.

이 원칙을 채널 주문의 취소·부분취소에 적용한 결과:

- core → Medusa 취소 역투영(`SalesOrderCancelled` → `CoreOrderCancelled` → `cancelOrder`)을 없앤다. 수집된 취소가 채널로
  되돌아갈 길이 없어진다.
- 자동 취소 능력이 없는 채널(`automatedCancellation: false`)에는 명령을 보내지 않는다. core 가 요청을 거절하고, 그 채널의
  취소는 수집으로만 받는다.
- Medusa 부분취소는 주문 수정(Order Edit) + 차액 환불 한 번을 하나의 커스텀 워크플로로 한다. 할인은 구매 시점 배분을
  유지하고(`carry_over_promotions` 재계산은 «지금» 유효한 프로모션만 다시 붙여 기각), 배송비는 주문 시점 정책으로 다시
  계산하며, 돌려준 배송비는 크레딧 라인으로 장부를 맞춘다(Medusa `cancelOrderWorkflow` 와 같은 패턴).

## Why
- 돈이 오가는 계산을 한 곳(커머스 엔진)에 두면 core 가 Medusa 의 할인·배송비 규칙을 복제하지 않는다.
- wallet 의 금액 검사는 «넘치지 않게»만 막는다. 시작하는 쪽이 둘이면 «누가 했는가»와 «실패를 누가 아는가»가 매번
  타이밍에 달린다. 하나로 줄이면 그 질문이 사라진다.
- core 가 판정을 쥐는 이유는 출고 상태를 아는 곳이 core 뿐이기 때문이다. Medusa 가 core 를 불러 묻게 하면 ADR-0040 §5.4
  (Medusa → 우리 앱 역방향 경로를 새로 만들지 않는다)를 깬다.

기각:
- **core 가 먼저 환불하고 Medusa 는 «환불 없는 취소»만 투영:** core 가 할인·배송비 배분을 다시 구현해야 하고, Medusa 장부가
  계속 늦게 따라가며, 코어 취소 라우트를 피하는 커스텀 취소가 따로 필요하다.
- **운영자가 Medusa 에서 직접 취소:** 출고 판정이 빠져 경합이 남고, ADR-0040 §5.6(대시보드는 진단 전용)에 어긋난다.

## Consequences
- 고객·운영자 취소가 비동기가 된다(«처리 중 → 완료»). 고객이 보는 «취소됨»은 Medusa 취소가 끝나는 순간 바뀐다 —
  주문 내역을 Medusa 에서 읽기 때문이다(ADR-0040 §7).
- core 에 «출고 보류»가 처음 생긴다. 송장 발급·배치 시작·발송 사전검사가 «열린 취소 요청»을 묻는다.
- Medusa 의 취소 후처리(쿠폰 복원 등)가 확실히 돈다 — 지금은 Medusa 취소가 실패하면 함께 빠진다.
- wallet 환불 승인 경로(`cancel-by-intent`)도 역투영 대신 같은 요청 경로를 탄다.
- 역투영 제거는 전환 PR 과 배포 한 번을 사이에 둔 별도 PR 이다(expand-contract). 그 전에 이미 어긋난 주문
  (`CoreOrderCancelled` 인박스 `failed`)을 라이브에서 세고 정리한다.
- Medusa 를 `SHIPPING_ADJUSTMENTS_REPLACE` 가 있는 버전으로 올리면 배송비 환불을 크레딧 라인 대신 그쪽으로 옮길 수 있다.
