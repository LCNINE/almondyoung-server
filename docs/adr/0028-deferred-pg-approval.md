# 지연 PG 승인 (deferred approval) — 고아결제 원천 차단

## Status
Accepted (2026-07-31).

## Context

"결제는 됐는데 주문이 없는" 고아결제가 반복 발생했다. 발생 경로는 다음과 같다.

1. 카드/토스 결제에서 **돈이 빠지는 시점은 wallet 의 Toss 승인 API 호출**
   (`TossApproveService.approve` → `tossApi.confirmPayment`)이다. 결제창을 닫자마자
   wallet-web 이 이 승인까지 끝낸다. (capture 는 토스에선 no-op 상태 전이일 뿐이다 —
   즉 auto-capture 를 꺼도 돈은 이미 빠진 뒤다.)
2. 그 뒤에야 스토어프론트가 `cart.complete` 를 부른다. Medusa `completeCartWorkflow` 의
   단계 순서는 `create-order → reserveInventory → authorizePayment` 이고,
   `reserveInventoryStep` 은 `manage_inventory=true && allow_backorder=false && 가용재고 < 필요수량`
   이면 throw 한다.
3. 이때 주문은 롤백되지만 wallet 은 이미 승인/캡처 상태다. core-flows 의
   `compensatePaymentIfNeededStep` 은 **Medusa payment 행의 `captured_at` 만** 보는데,
   주문 생성 실패 경로에서는 Medusa payment 행 자체가 없다 → 보상 환불도 안 탄다 → 고아 확정.

담기 시점 검증(Medusa 가 "수량 > 가용재고" 를 거부)은 예약이 아니라 조회라, 담은 뒤 결제 완료
사이의 경쟁(같은 재고를 두 고객이 각각 담고 둘 다 결제)과 드리프트(담은 뒤 재고 감소)를 막지 못한다.
과거 임시조치였던 `allow_backorder=true` 대량 적용은 오버셀을 유발해 폐기됐다.

## Decision

**PG 승인을 주문 생성 이후로 미룬다.** Medusa 체크아웃에서 생성한 intent 에는
`metadata.approvalMode='DEFERRED'` 표식을 달고, wallet 은 그 표식이 있는 intent 에 한해
결제창 완료 시 승인 API 를 호출하지 않고 승인 파라미터(paymentKey/orderId/amount)만
charge 에 적재(stage)한다. intent 는 `REQUIRES_ACTION` 에 머문다(= almond-payment 가
`pending` 으로 매핑 → `validateCartPaymentsStep` 통과).

실제 승인은 `completeCartWorkflow` 의 **마지막 단계**인 `authorizePaymentSessionStep`
→ `almond-payment.authorizePayment` → wallet `POST /v1/payment-intents/:id/finalize-approval`
에서 일어난다. 즉 주문 생성과 재고예약이 모두 성공한 뒤에만 고객 돈이 움직인다.
재고부족이면 워크플로가 승인 전에 실패하고, 적재된 승인은 미승인 상태로 만료된다(돈 안 빠짐).

부수 결정:

- **적재 만료**: 적재 시 `actionExpiresAt` 을 다시 찍는다(기본 10분,
  `WALLET_STAGED_APPROVAL_TTL_MINUTES`). 지나면 기존 `TossActionExpirationJob` 이 회수하고
  PG 미승인 결제는 자동 만료된다 — fail-closed.
- **미승인 토큰 격리**: 적재 단계에서는 `providerTransactionId` 를 채우지 않는다.
  미승인 paymentKey 로 취소/환불이 시도되는 것을 막기 위함이다.
- **캡처 결정성**: 승인 직후 wallet 이 자동 캡처하며 `payment.intent.captured` 를 발행하는데,
  이 웹훅이 워크플로가 payment 행을 만들기 전에 도착할 수 있다. 그래서 (a) `cart.complete`
  라우트가 완료 직후 캡처를 명시 실행하고, (b) 캡처 훅은 "카트는 완료됐는데 payment 행이 없음"
  을 조용히 넘기지 않고 throw 해 재배달로 재시도한다.
- **카트 식별 실패 폴백 교체**: 예전에는 콜백이 checkout cart 를 특정 못 하면
  "capture 웹훅이 주문을 만든다" 에 맡겼다. 지연 승인에서는 카트를 완료해야 승인이 일어나므로
  이 폴백이 성립하지 않는다. `POST /store/payment-intents/:intentId/complete` 가
  intent → session → cart 로 역추적해 서버사이드에서 완료한다.
- **백스톱**: `orphan-payment-reconcile` 잡(매시 17분)이 잔여 케이스를 정리한다.
  주문 없음 + CAPTURED → 주문 복구 시도 후 실패 시 자동 환불, 주문 없음 + AUTHORIZED → 취소,
  주문 있음 + 미캡처 → 캡처. `ORPHAN_RECONCILE_AUTO_REFUND=false` 로 탐지 전용 전환 가능.
- **결제 전 게이트 강화**: 스토어프론트 체크아웃이 품절뿐 아니라 "담은 수량 > 가용재고" 도 막는다.
  (근본 차단은 지연 승인이지만, 결제창까지 갔다 실패하는 UX 를 줄인다.)

## Consequences

- 오버셀/품절 정책은 그대로다 — `allow_backorder` 를 건드리지 않는다.
- 무통장(BANK_TRANSFER)은 영향 없다. `offline-wait` 승인 경로라 toss-approve 를 타지 않고,
  캡처는 관리자 입금확인 시점 그대로다. 멤버십/정기결제(INVOICE·CMS)도 Medusa 세션이 없어
  `approvalMode` 표식이 붙지 않으므로 기존 경로를 그대로 탄다.
- 배포 순서: **wallet 먼저, Medusa 나중**. wallet 은 표식이 있는 intent 만 지연 처리하므로,
  구버전 Medusa(표식 없음) + 신버전 wallet 조합은 기존 동작 그대로다. 반대 순서면 Medusa 가
  표식을 다는데 wallet 이 finalize 엔드포인트를 모른다.
- 롤백: Medusa 쪽 `ALMOND_DEFERRED_APPROVAL=false` 로 표식 부여를 끄면 즉시 기존 동작.
  이미 적재된 intent 는 finalize 로 마무리되거나 만료 회수된다.
- 남는 창: 승인(=워크플로 마지막 단계) 이후 링크/트랜잭션 기록 단계에서 실패하면 주문은
  롤백되는데 돈은 빠진 상태가 된다. `compensatePaymentIfNeededStep` 은 Medusa 캡처 기준이라
  이때도 안 돈다 → 리컨실 잡의 자동 환불이 유일한 회수 경로다(1시간 내).
- 브라우저가 콜백 도달 전에 죽으면 승인이 아예 안 일어난다. 고객은 과금되지 않고 주문도 없다
  (이전에는 돈만 빠졌다). 결제 실패로 재시도하면 된다.
