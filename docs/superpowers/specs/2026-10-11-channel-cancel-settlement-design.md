# 채널 주문 취소 — 취소는 그 자리에서 확정하고, 환불은 따로 정산한다 (#1016 36번 행 재설계)

> 대체: `docs/superpowers/specs/2026-10-10-channel-cancel-refund-refusal-design.md`(36번 첫 설계, PR #1044·#1045·#1046 — 닫는다).
> 고침: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md`(35번 스펙) §5.3·§5.4·§5.5·§6.3·§7.2·§7.5,
> ADR-0042 원칙 2. 유지: ADR-0042 원칙 1·3·4, ADR-0043.
> 사용자 결정 2026-10-11. 조사 지시문: `docs/superpowers/briefs/2026-10-11-channel-cancel-refund-redesign-research.md`.
> 기준 커밋 develop `85fd1d2ae`. Medusa 2.13.4.

## 1. 문제

채널(Medusa) 주문의 취소는 지금 «core 가 출고를 보류하고 명령 → channel-adapter → Medusa 가 환불하고 취소 → 수집으로 확정»이다
(35번 스펙). 환불이 막히면 이 구조에는 끝이 없다.

- **관리자 막다른 길.** 36번 설계는 wallet 영구 거절을 «환불 불가 / 장부 불일치»로 보이고 요청을 연 채 보류한다. 끝내는 출구가 없어
  남는 선택은 «영원히 보류» 또는 [요청 접기] = **취소한 고객에게 출고**다. 부분취소 거절은 접기도 409 라 안내끼리 모순된다.
  운영자는 Medusa 대시보드 기본 취소를 비공식 출구로 쓰게 될 위험이 있다(§2.2 — 그 버튼은 장부를 거짓으로 만든다).
- **고객 무응답.** 스토어프론트는 «취소 처리 중»을 30초만 다시 읽고 멈춘다. 거절·접기 통지가 없다.
- **PG 영구 거절이 일시 장애와 구분되지 않는다.** wallet 은 PG 거절을 200 + FAILED 행으로 주고 토스 오류 코드는 환불 행에 남기지
  않는다(`payment_state_transitions` 에만). 재시도 → DLQ → 사유 없는 정체.
- **문구가 개발자 말이다.** «장부 불일치 · wallet 환불 내역 대조» — 운영자가 어디서 무엇을 확인하는지 모른다.

뿌리는 하나다: **«취소가 성립했는가»를 «환불이 끝났는가»에 묶었다.** 환불이 막히는 순간 취소 의사까지 공중에 뜬다.

## 2. 조사로 확인한 사실

### 2.1 업계와 법 — 취소와 환불은 별개 수명주기다

- **Shopify** 관리자 취소는 환불 방식으로 «원결제수단 / 적립금 / 취소할 때 환불하지 않음»을 고른다. `orderCancel` 의 `refundMethod` 는
  선택 인자이고, 환불 안 한 몫은 남은 환불 가능액으로 남아 나중에 처리한다. 재무 상태(`displayFinancialStatus`)는 주문 상태와 다른 축이다
  (help.shopify.com/en/manual/fulfillment/managing-orders/canceling-orders, shopify.dev `orderCancel`).
- **Magento** 는 환불을 주문과 별개 문서(credit memo)로 두고 [Refund]와 [Refund Offline](게이트웨이 없이 «이미 지급함»을 기록)을 나눈다.
  **Saleor** 는 «환불 승인»(갚을 의무) 엔티티 아래 실제 시도가 여러 번 붙는다.
- **Stripe·Adyen** 은 환불 실패 시 «고객에게 연락해 다른 수단으로 지급하라»고 안내한다. 취소를 되돌리는 곳은 없다.
- **토스페이먼츠**도 가상계좌 환불을 결제 취소와 별도의 `refundStatus`(`PENDING`·`FAILED`·`COMPLETED` …)로 추적한다. 영구 오류 코드가
  분명하다: `EXCEED_MAX_REFUND_DUE`(환불 기간 경과), `REFUND_REJECTED`, `NOT_CANCELABLE_AMOUNT`, `NOT_CANCELABLE_PAYMENT`,
  `ALREADY_CANCELED_PAYMENT`, `FORBIDDEN_BANK_REFUND_REQUEST` 등. `PROVIDER_ERROR` 는 일시.
- **전자상거래법 제18조 2항:** 청약철회 시 «3영업일 이내에 이미 지급받은 재화등의 대금을 환급», 늦으면 지연이자. 환급 의무는 취소와
  동시에 성립하는 기한 있는 채무다.

### 2.2 Medusa 2.13.4 — 기본 취소는 환불 실패를 삼키고 장부를 거짓으로 만든다

- `cancelOrderWorkflow` → `refundCapturedPaymentsWorkflow` → `refundPaymentsWorkflow` 의 `refundPaymentsStep` 은 결제마다
  `.catch(logger.error)` 로 오류를 삼킨다(36번 실측). **그 뒤 `addOrderTransactionStep` 은 성공분(`refundedPayments`)이 아니라 입력 전체
  (`input`)로 환불 거래를 적는다**(`@medusajs/core-flows/dist/payment/workflows/refund-payments.js`, 2026-10-11 소스 확인). 결과: Refund
  행은 없는데 −X 환불 거래가 있다 — `refunded_total` 이 거짓이 되고 `pending_difference` 는 +X(«고객이 더 낼 돈»)로 반대 방향이 된다.
  36번 통합 테스트의 «`pending_difference` = 결제액»이 이 결과다. `cancelPaymentStep`(미캡처 결제 취소)도 같은 `.catch` 다.
- **취소된 주문에 나중에 환불하면 돈이 나간 «뒤» 실패한다.** `refundPaymentWorkflow` 는 환불액이 «돌려줄 돈»(음수 `pending_difference`)을
  넘는 몫에 크레딧 라인을 붙이는데, 그 단계(`createOrderRefundCreditLinesWorkflow`)가 `throwIfOrderIsCancelled` 로 던진다. 환불 단계에는
  보상이 없다(«We don't want to compensate a refund»). 취소된 주문은 `pending_difference` 가 0 이하가 아니므로(위) 늘 이 경로다.
  → **Medusa 주문의 `canceled` 는 돈이 정리된 뒤에만 와야 한다.**
- 주문 수정 확정은 환불하지 않는다 — «돌려줄 돈»은 음수 `pending_difference` 로 장부에 남고 운영자가 따로 환불한다(문서 Order Edit,
  `confirm-order-edit-request.js`). **부분취소는 의무를 장부가 스스로 들고 있다.**
- `Refund` 모델엔 상태 칸이 없고 provider 실패 시 행을 지운다(`payment-module.js` `refundPayment`) — «실패한 환불 행»은 Medusa 에 없다.
  «기록만 하는 환불»(mark as refunded)도 없다.
- 공식 훅: `cancelOrderWorkflow` 는 취소 «뒤»의 `orderCanceled` 하나, 환불·주문 수정 워크플로는 0개. 환불 실패로 취소를 막는 지원 경로는
  없다 → 문서가 권하는 «라우트 복제»(36번의 `channel-cancel` 이 그 모양).

### 2.3 wallet

- **🔴 포인트 환불이 코드상 전부 실패한다.** 확정(capture) 때 포인트 원장 키로 승인(AUTHORIZE) 결제분 id 를 넘기고
  (`apps/wallet/src/payment-intents/capture.service.ts:171` → `points.provider.ts` `legId: params.chargeId`), 환불은 확정(CAPTURE) 결제분을
  고른 뒤(`charges.service.ts` `findRefundableByIntent` 1순위) 그 id 로 원장을 읽는다(`points-ledger.service.ts` `readPointLegTotals`) →
  `NO_CAPTURED_REDEEM` → 200 + FAILED. 모든 provider 가 자동 확정이라 포인트가 낀 주문 전부 해당한다.
  - 지금 라이브의 채널 전체취소는 기본 `/cancel` 이라 **카드만 환불되고 포인트는 안 돌아간 채 취소된다**(§2.2 의 삼킴).
  - 2026-06 일부 환불 4건(Medusa #14·#40·#321·#459, 각 wallet FAILED 환불 1건)이 이 결함일 가능성이 높다 — 라이브 확인 대기(§11).
  - 부분취소 재시도에서는 카드분이 나간 뒤 Medusa 가 환불 행을 지우고, 재시도가 남은 금액 비례로 카드분을 또 환불할 수 있다(코드 추론,
    라이브 부분취소 기록 0).
- 영구·일시 분류는 wallet 어디에도 없다. 토스 오류 코드는 `payment_state_transitions.reasonCode` 에만 남고 환불 행엔 토스 메시지만 남는다.
- 무통장 환불은 계좌를 모르면 PG 를 부르지 않고 PENDING 행을 만들고(`bank-transfer.provider.ts` `refund`), 관리자가 송금 뒤
  `confirmManual`(`refunds.service.ts`)로 SUCCEEDED 로 바꾼다. 지금은 무통장 전용이다. Medusa almond-payment 는 PENDING 을 성공으로 받는다.
- 환불 «목록» API 는 없다(`GET /v1/payment-intents/:id/refundability` 는 남은 금액만).

### 2.4 이미 있는 분리 모델

core 직접 주문은 «취소 성립 + 환불 따로 추적»이다 — `POST /sales-orders/:id/retry-refund`·`manual-refund-complete`
(`admin-return-exchange.controller.ts`), 스토어프론트 환불 배지(`pending`·`manual_pending`·`succeeded`·`failed`). 채널 주문만 반대 모델이었다.

## 3. 목표와 성공 기준

1. **고객이 취소한 물건은 나가지 않는다.** 출고 전이면 취소는 요청 순간 확정되고 되돌리는 길이 없다
2. **돌려줄 돈은 장부에서 사라지지 않는다.** 자동 환불이 막혀도 의무는 Medusa 장부 또는 wallet 송금 대기 행에 남는다
3. **운영자는 모든 막힘에서 끝내기까지 갈 수 있다.** 출구는 «돈을 어떻게 돌려줄까»뿐이고 «출고할까»는 없다
4. **고객은 상태를 안다.** «취소 완료» + «환불 진행 중 / 지연 / 완료»
5. **장부 불일치는 운영자 일이 아니다.** 정산 직전 자동으로 맞춘다
6. 롤링 중 어떤 버전 조합도 지금보다 나빠지지 않는다(§9)
7. `npm run type-check` 0 · `npx jest` 0 · admin-web `tsc --noEmit` 0 · Medusa 통합 스펙 초록 · 로컬 스모크 넷(§10)

## 4. 결정 (사용자 결정 2026-10-11)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| S1 | 환불이 막히면 취소는 성립하나 | **성립한다.** 출고 전이면 core 가 그 자리에서 확정, 환불은 뒤따르는 정산 | 성립 안 함(36번): 고객 의사가 운영자 판단에 묶이고 «접기 = 출고» 출구가 남는다. 업계·법과 반대(§2.1) |
| S2 | 물리 취소를 언제 적용하나 | **요청 순간, 같은 트랜잭션에서**(박스·출고지시·예약). 보류·[요청 접기]는 새 요청에서 사라진다 | 보류 후 수집 때 적용(35번): 부분취소 정산이 며칠 막히면 남은 품목까지 멈춘다. ADR-0042 원칙 2 를 고친다(§12) |
| S3 | 환불 의무의 정본 | **돈이 있는 곳.** 자동 환불 몫은 Medusa 장부(«캡처 − 환불», 부분취소는 음수 차액), 수동 몫은 wallet 송금 대기 행. core 는 정산 상태와 사유만 | core 범용 `refund_obligations` 엔티티: 세 번째 장부라 어긋날 자리가 늘고, 반품·금액 조정 경로가 아직 없어 지금 필요보다 크다 |
| S4 | 수동 환불 수단 | **고객 계좌 송금.** wallet 이 PG 없이 «송금 대기» 행을 만들고 운영자가 송금 뒤 [송금 완료]. 포인트 몫은 자동으로 되돌린다 | 포인트 대신 지급: 고객 동의 절차·ADR-0043 «주문 밖 보상» 경계 — 이번 범위 밖. 토스 상점관리자 직접 취소: 금지 절차로 문서화(wallet·Medusa 둘 다 모르는 환불이 생긴다) |
| S5 | 장부 불일치 | **정산 직전 Medusa 가 wallet 환불 목록을 받아 빠진 것을 장부에 넣고** 남은 몫만 환불. 운영자 상태가 아니다 | 운영자에게 «장부 불일치» 표시(36번): 할 수 있는 일이 없는 경고. 수동 «장부 맞추기» 버튼(36번 E6): 기계가 할 일을 사람에게 |
| S6 | 영구·일시 분류의 정본 | **wallet.** 거절 본문과 FAILED 환불 행에 `failureCode`·`retryable`. almond-payment 는 번역만 | almond-payment 분류(36번 E1): PG 코드를 모른다 — PG 거절이 전부 «일시»가 됐다 |
| S7 | 다시 부르는 장치 | **core 리컨실러 한 곳**(#1016 12번 틀). channel-adapter 는 Medusa 실패를 사실로 내고 명령을 ack | Kafka 재시도·DLQ: 창이 짧아 긴 장애 뒤 사람이 필요하고, core 가 «재시도 중인지 죽었는지» 모른다. 절충(네트워크 순단만 Kafka): 재시도 장치가 둘 |
| S8 | 고객 통지 | **v1 은 자동 알림 없음.** 화면 배지가 즉시 바뀌고, 영구 거절이면 운영자가 계좌를 받으러 연락하는 것으로 갈음 | 알림톡·SMS: 범위 밖, 필요해지면 정산 상태 전이에 붙인다 |
| S9 | 대시보드 기본 취소·환불 | **미들웨어로 막는다** — 환불할 몫이 남은 주문의 기본 `/cancel`, 취소된 주문의 기본 `/payments/:id/refund` | 놔둠(36번 E10): 장부를 거짓으로 만드는 버튼이 남는다(§2.2). 코어 라우트 override: CLAUDE.md 가 지양 |
| S10 | PR #1044·#1045·#1046 | **셋 다 닫고** 쓸 코드는 새 PR 로 옮긴다(§9.1) | 머지 후 수정: «REFUND_FAILED 면 요청 열고 보류»라는 반대 의미의 계약이 라이브에 나간 뒤 다시 걷어내야 한다 |
| S11 | 포인트 환불 결함 | **wallet 단독 PR 로 먼저**, 재설계와 독립 | 재설계에 묶음: 그동안 라이브 취소가 포인트를 빼먹는다 |

## 5. 상태 모델

### 5.1 흐름

```
[요청] ─ core 판정 ─┬─ 출고 못 막음 → 즉시 거절 (요청 행 없음 — 지금과 같다)
                    └─ 통과 → 확정 = 물리 취소 적용 + 요청 행 settling + 명령 ─→ 정산 중 ──→ 정산 완료(applied)
                                                                                 │
                                                       일시 실패가 30분 넘게 이어짐 → 환불 지연 ─┐
                                                       영구 거절 ───────────────→ 환불 거절 ─┤
                                                                                              ├→ [다시 시도] → 정산 중
                                                                                              └→ [계좌 송금으로 환불] → 정산 중(수동) → 정산 완료 + wallet 송금 대기 → [송금 완료]
```

- **확정**은 core 의 동기 응답이다. 고객·운영자에게 즉시 «취소 완료»다.
- **정산 중**: 명령을 보냈고 Medusa 가 처리 중. 일시 실패는 리컨실러가 다시 부른다(§7.3).
- **환불 지연**: 확정 후 30분이 지났는데 아직 정산 중(일시 실패가 이어짐). 리컨실러는 계속 다시 부른다.
- **환불 거절**: wallet·PG 의 영구 거절(`retryable: false`). 리컨실러는 다시 부르지 않는다.
- **정산 완료**: 수집으로 Medusa 취소(전체) 또는 부분취소 `stage: refunded` 가 돌아옴.
- **채널의 업무 거절은 없다.** 출고 가능 여부는 core 가 이미 판정했다. 주문 없음 같은 이상은 «환불 거절»과 같은 칸에 `failureCode` 로
  남기고(«정산 실패 · 개발 확인») 재시도하지 않는다.

### 5.2 각 상태에서 보이는 것

| 상태 | 고객 화면 | 운영자 화면 | 운영자 조치 |
| --- | --- | --- | --- |
| 정산 중 (30분 이내) | 취소 완료 · 환불 처리 중 | 보이지 않음 | 없음 |
| 환불 지연 | 취소 완료 · 환불 지연, 영업일 3일 안에 처리 안내 | 정체 보드 «환불 지연», 확정 후 경과, 3영업일 기한, 마지막 사유 | [다시 시도] [계좌 송금으로 환불] |
| 환불 거절 | (위와 같음) | 정체 보드 «환불 거절», 사유(토스 한국어 메시지) | [다시 시도] [계좌 송금으로 환불] |
| 송금 대기 (수동) | 취소 완료 · 환불 진행 중(계좌 송금 예정) | wallet 송금 대기 목록 | 송금 뒤 [송금 완료] |
| 정산 완료 | 취소 완료 · 환불 완료(금액) | 없음 | 없음 |

**고객에게는 지연과 거절을 구분하지 않는다.** 고객이 할 일이 없고, «거절»은 «환불을 안 해 준다»로 읽힌다.

## 6. Medusa · wallet — 정산

### 6.1 정산 라우트 둘, 같은 순서

- 전체취소: `POST /admin/orders/:id/channel-cancel` (#1045 에서 옮겨 고친다)
- 부분취소: 기존 `POST /admin/orders/:id/partial-cancel`

```
주문 잠금 → 검증 → ① 장부 맞추기(§6.2) → ② 남은 몫 환불(자동 또는 수동, §6.3) → ③ Medusa 취소 / 주문 수정
```

- 본문에 `refundMode: 'auto' | 'manual'`(없으면 `auto`).
- **전체취소는 «환불 → 취소» 순서다**(§2.2 — 취소된 주문엔 환불할 수 없다). 환불할 몫이 0 이 된 뒤 기본 `cancelOrderWorkflow` 를 부르면
  그 안의 환불 단계가 아무것도 하지 않는다(36번 실측: 크레딧 라인 1번, `pending_difference` 0).
- **부분취소는 «수정 확정 → 환불» 순서를 유지한다.** 수정 뒤 «돌려줄 돈»이 음수 차액으로 장부에 남아 의무가 사라지지 않는다.
- 검증(환불 «전»): 주문 없음(404 `not_found`) · 이미 취소됨(코어와 같은 문장 — 전체취소에선 성공으로 읽는다) · 취소 안 된 이행 · 진행 중인
  주문 변경(환불 워크플로가 환불 «뒤» 크레딧 라인 단계에서 실패하는 원인, 36번 Task 12b). #1045 의 `assertCancelable` 을 옮긴다.
- 응답:
  - 200 — 정산 완료 (`{ orderId, status, refund: { mode, amount } }`)
  - 400 + 표지 `code = 'wallet_refund_refused:<failureCode>'` — 영구 거절. 전체취소는 주문을 취소하지 않는다. 부분취소는 수정이 확정된
    채(`stage: edited`) 환불만 안 됐다
  - 500 — 일시 실패. 환불 뒤 단계의 실패도 전부 500(재시도 시 남은 몫만 환불하고 이어 간다 — 36번 §4.6 3a)
  - 부분취소의 기존 400 `partial_cancel_rejected`·`external_refund_*`(37번)는 그대로 — core 판정과 Medusa 판정이 어긋난 이상이라
    `retryable: false` 로 받는다

### 6.2 장부 맞추기

환불 직전, 결제마다 결제 잠금(`paymentRefundLockKey`) 안에서:

1. wallet `GET /v1/payment-intents/:intentId/refunds`(새 API, §6.5)로 그 결제의 SUCCEEDED·PENDING 환불 목록을 받는다.
2. Medusa 장부에 없는 wallet 환불(결제 `data.walletRefundIds` 에도, 투영 기록에도 없는 id)을 지금의 투영 경로
   (`api/hooks/payment-events/route.ts` `handleRefundProjection` 의 표식 + `refundPaymentWorkflow`)로 넣는다. **`reasonCode = MEDUSA_REFUND`
   인데 `walletRefundIds` 에 없는 것(응답 유실)도 넣는다** — 지금 투영은 이걸 건너뛰고 로그만 남긴다.
3. «캡처 − 환불»을 다시 읽어 남은 몫을 정한다.

맞춘 뒤에도 wallet 이 금액 초과(`REFUND_AMOUNT_EXCEEDS_*`)로 거절하면 동시 환불 같은 경합이다 — 일시 실패(500)로 내고 다음 시도가
다시 맞춘다. 투영 로직은 웹훅 경로와 이 단계가 함께 쓰도록 함수로 뽑는다.

### 6.3 환불 — 자동과 수동

- **자동**: 지금과 같다 — 결제마다 `refundPaymentWorkflow`(note `channel-cancel:<orderId>` / `partial-cancel:<requestId>`) → almond-payment →
  wallet `POST /v1/payment-intents/:id/refund`.
- **수동**: 결제 잠금 안에서 결제 `data` 에 `manualRefund: { requestId, amount }` 표식을 붙이고 `refundPaymentWorkflow` 를 돌린다.
  almond-payment 는 표식(금액이 같을 때)을 보고 wallet 에 `execution: 'MANUAL'` 로 요청하고 표식을 `null` 로 지운다(JSON 병합 함정 —
  35번 스펙 §6.2). `externalRefund` 표식과 같은 패턴이다. 워크플로가 실패하면 표식을 지우고 다시 던진다.
- wallet 의 수동 실행: 계획(남은 금액 비례, 외부 결제 먼저·포인트 마지막)은 자동과 같다. **포인트 몫은 자동으로 되돌리고**, 외부 결제 몫은
  PG 를 부르지 않고 `status = PENDING`, `execution = MANUAL` 행으로 만든다. PENDING 은 남은 금액 계산에서 이미 빠지므로 같은 돈이 두 번
  나가지 않는다. almond-payment 는 PENDING 을 성공으로 받는다(지금 무통장과 같다) → Medusa Refund 행 → 취소·수정 진행.

### 6.4 almond-payment — wallet 오류 번역

- `walletFetch` 가 `WalletHttpError { status, walletCode, walletMessage, retryable? }` 를 던진다(#1045 에서 옮김). 속성을 `code` 로 두지 않는다
  (Medusa `formatException` 이 `err.code` 를 Postgres 코드로 읽는다).
- `refundPayment`:
  - 4xx 본문의 `retryable === false` → `MedusaError(NOT_ALLOWED, <wallet 메시지>, 'wallet_refund_refused:<walletCode>')`
  - 200 응답의 FAILED 행 중 `retryable === false` 가 있으면 → 같은 표지(`<failureCode>`)와 토스 메시지
  - 그 밖(5xx·네트워크·`retryable` 없음·`true`) → 지금처럼 일반 오류(일시)
  - 결제분 여럿 중 앞이 나가고 뒤가 실패한 경우: 지금처럼 나간 id 를 error 로그에 남긴다. 다음 시도의 장부 맞추기(§6.2)가 그 환불을
    장부에 넣으므로 다시 나가지 않는다
- 전파: `refundPaymentWorkflow` 를 직접 부를 때만 표지가 응답 `code` 에 실린다(36번 §4.3 실증). 정산 라우트는 직접 부른다.

### 6.5 wallet 변경

| 변경 | 내용 |
| --- | --- |
| 환불 목록 API | `GET /v1/payment-intents/:id/refunds` (API 키) — `{ id, chargeId, status, amount, reasonCode, execution, createdAt }[]` |
| 실패 분류 | 거절 본문 `{ error, message, retryable }`. wallet 자체 코드는 표로(`REFUND_NOT_AUTOMATABLE`·`MEMBERSHIP_REFUND_NOT_ALLOWED` = false, 금액 초과류 = true — §6.2), FAILED 환불 행엔 `failure_code`·`failure_retryable` 칸(토스 코드표를 토스 provider 옆에 둔다). 모르는 토스 코드는 `true`(재시도 쪽이 안전 — 사람이 «지연»으로 본다) |
| 수동 실행 | `RefundByIntentDto.execution?: 'AUTO' \| 'MANUAL'`, 환불 행 `execution` 칸(기본 `AUTO`) |
| 송금 완료 일반화 | `confirmManual` 이 `execution = MANUAL` 행이면 결제수단과 무관하게 허용(무통장 PENDING 은 지금처럼) |

마이그레이션: `refunds` 에 `execution`(기본 `AUTO`)·`failure_code`·`failure_retryable` — additive, **`migrate → deploy`**.

### 6.6 대시보드 함정 막기 — 미들웨어

`apps/medusa/src/api/middlewares.ts` 에 커스텀 미들웨어(문서 확장 순서 3번째, 라우트 override 아님):

- `POST /admin/orders/:id/cancel` — 주문에 «캡처 − 환불» > 0 인 결제가 있으면 400 «admin-web 에서 취소하세요»
- `POST /admin/payments/:id/refund` — 결제의 주문이 취소됐으면 400

우리 정산 라우트는 HTTP 가 아니라 워크플로를 직접 부르므로 영향이 없다. **channel-adapter 가 `channel-cancel` 로 옮긴 뒤에만 배포한다**
(지금 라이브 channel-adapter 는 기본 `/cancel` 을 HTTP 로 부른다 — §9.2).

## 7. 계약 · channel-adapter · core

### 7.1 계약 (`packages/event-contracts`)

- `CancelChannelOrder` 명령에 optional `refundMode: 'auto' | 'manual'`. 옛 channel-adapter 는 모르는 칸이라 `auto` 로 처리 — 결과는 «또 거절»뿐
- 새 사실 **`ChannelOrderSettlementFailed { requestId, salesOrderId, scope, retryable, failureCode, message, at }`** (`orders.events.v1`).
  `REFUND_FAILED` 를 고쳐 쓰지 않는다 — 옛 core 는 그걸 받으면 요청을 닫는데, 새 이벤트 타입은 옛 소비자가 경고 후 버린다(35번 PR-B 실측)
- `ChannelOrderCancelStalled`·`ChannelOrderCancelRejected` 의 `REFUND_FAILED` 는 생산을 멈춘다. 계약에서 지우는 것은 정리 PR(§9.2 의 6)

### 7.2 channel-adapter

`ChannelOrderCancelManager`:

| Medusa 응답 | 하는 일 |
| --- | --- |
| 200 | 재수집(`syncOrder` force) — 지금과 같다. 성공 사실은 내지 않는다 |
| 400 «이미 취소됨» 문장 | 성공 — 재수집 |
| 400 표지 `wallet_refund_refused:*` | `SettlementFailed { retryable: false }` |
| 400 그 밖·404 본문 `type: not_found` | `SettlementFailed { retryable: false, failureCode: <Medusa type/code> }` |
| 500·502·네트워크·본문 없는 404(옛 Medusa 에 라우트 없음) | `SettlementFailed { retryable: true }` |

**사실을 낸 뒤 명령을 ack 한다 — Kafka 재시도·DLQ 에 기대지 않는다.** channel-adapter 자신이 사실을 못 낸 경우(아웃박스 쓰기 실패)만
던져 재배달을 탄다. 멱등 키 `settlement-failed:${requestId}:${envelope.messageId}`(명령 전달 단위 — 35번 PR-B 와 같은 이유).
결과 종류 누락은 `never` 검사로 컴파일에서 막는다(#1046 에서 옮김). 전체취소 경로는 `POST /admin/orders/:id/channel-cancel`.

### 7.3 core

**요청 행** (`sales_order_amendments`, `reason_code = 'CHANNEL_CANCEL_REQUEST'`):

- `status` 에 **`settling`** 을 더한다 — `sales_order_amendments_status_check` 변경, additive, **`migrate → deploy`**.
- **확정 트랜잭션**(`channel-cancel-request.manager.ts` 생성 경로): 판매주문·박스 잠금 → 계획(`planCancellation`) → **적용**(지금 수집 때 하던
  물리 취소, 35번 §5.2 의 «적용») → 행 `settling` + `metadata.request.appliedAt` → `CancelChannelOrder` outbox. 전체취소면 판매주문도 취소한다.
- `settling` 은 보류가 아니다 — 보류 관문(`cancel-request-hold.ts`)은 `requested` 만 본다. 새 요청은 `requested` 를 거치지 않는다.
- `metadata.settlement = { state: 'in_progress' | 'delayed' | 'refused', mode: 'auto' | 'manual', lastFailure?: { code, message, retryable, at } }`.
  **시도 횟수·마지막 시도 시각은 리컨실러 상태(`order_reconcile_state`)가 갖는다** — 요청 행에 중복으로 두지 않는다.
- **정산 중인 요청이 한 주문에 여럿이어도 된다.** 부분취소 A 가 막힌 채 남은 몫의 전체취소가 오면, 전체취소 정산이 «캡처 − 환불»을 다 돌려주고
  A 는 지금처럼 `superseded`(`CHANNEL_FULL_CANCEL`)로 닫힌다. 한 주문의 열린 요청 유니크 인덱스(`WHERE status = 'requested'`)는 옛 행용으로 남는다.

**사실 받기:**

- `OrderCancelled`(전체) / `OrderModified` 의 `snapshot.cancelRequests` 에 `stage: refunded`(부분) → `applied` + `outcome`. 물리 적용은 이미
  `appliedAt` 이 있어 다시 하지 않는다(35번 settler 의 기존 분기). 전체취소 수집의 판매주문 취소(`handleOrderCancelled`)는 이미 취소된
  판매주문이면 아무것도 하지 않아야 한다 — 계획 단계에서 지금 동작을 확인하고 아니면 고친다.
- `ChannelOrderSettlementFailed` → `lastFailure` 기록. `retryable: false` 면 `state = refused`. `retryable: true` 면 `in_progress` 유지
  (30분 경과 판정은 §7.4 의 보드·리컨실러가 한다).
- 옛 사실(`ChannelOrderCancelStalled`, `REFUND_FAILED`)이 `settling` 행에 오면 `retryable: true` 로 읽는다 — 롤링 중 옛 channel-adapter 대비.

**리컨실러 규칙 «정산 재시도»** (`fulfillment/order-reconcile/rules/`, 12번 틀):

- 상황: 정체 보드 취소 단계의 `settle_in_progress`·`settle_delayed`.
- 검사: 요청이 `settling`, `state ≠ refused`, 마지막 시도가 백오프(1분 → 5분 → 15분 → 이후 1시간)보다 오래됨. 지문 = 요청 id + `state` + `mode`.
- 실행: 같은 `requestId`·`refundMode` 로 `CancelChannelOrder` 를 다시 낸다(멱등 — §6.1·§10).
- 명령·사실 유실, channel-adapter 결함도 이 규칙이 잡는다. 관찰 모드로 배포해 거짓 양성을 본 뒤 실행 모드로 바꾼다(12번 관례).
- 백오프·포기를 틀이 지원하는지 계획 단계에서 확인하고, 없으면 틀에 «다음 시도 시각»을 더한다(규칙마다 따로 두지 않는다).

**운영자 조치** (`sales-orders.controller.ts`, `cancel-request` 아래):

- `POST …/cancel-request/:requestId/retry` — `refused`·`delayed` → `in_progress`, 명령 재발행
- `POST …/cancel-request/:requestId/manual-refund` — `mode = manual`, `in_progress`, `refundMode: 'manual'` 명령 재발행
- 새 흐름의 요청엔 [요청 접기]가 없다(`withdraw` 는 `requested` 행만).

### 7.4 정체 보드 (`fulfillment/order-progress`)

- 판정 SQL(`order-progress.judge-sql.ts` creq): `settling` 행을 `settle_in_progress` / `settle_delayed`(확정 후 30분 초과) / `settle_refused`
  로 낸다. `state` 는 `varchar(64)` 라 마이그레이션 없다.
- 체류 시계의 기준은 **확정 시각**. 3영업일 기한을 함께 낸다(v1 은 주말만 빼고 공휴일은 범위 밖). 기준 상수는 `order-progress.thresholds.ts`.

## 8. 화면

### 8.1 admin-web (판정은 순수함수 + 스펙 — 컴포넌트 테스트 불가)

- 보드: `stateLabel` — `settle_delayed` «환불 지연», `settle_refused` «환불 거절». `settle_in_progress` 는 갇힘 기준 밖이라 숨는다.
- 주문 상세 취소 영역: 정산 상태, 확정 후 경과·기한, 사유(wallet 이 싣는 토스 한국어 메시지 그대로), [다시 시도] [계좌 송금으로 환불].
  [계좌 송금으로 환불] 확인 창: «고객에게 계좌를 받아 직접 송금한 뒤, wallet 송금 대기에서 [송금 완료]를 눌러 주세요.»
- wallet 송금 대기 화면은 수동 실행 행도 보이도록 필터를 넓힌다(지금은 무통장 PENDING).

### 8.2 스토어프론트

- 취소 응답이 곧 «취소 완료»다 — core 가 동기로 확정한다. 2초×30초 다시 읽기(`src/lib/orders/cancel-outcome.ts`)는 정리 PR 에서 지운다.
- 환불 배지(core actions API 의 `refundStatus`):

| core 정산 | `refundStatus` | 문구 |
| --- | --- | --- |
| 정산 중 | `pending` (기존) | 환불 처리 중 |
| 지연·거절 | **`delayed`** (새 값) | 환불이 늦어지고 있어요 · 영업일 3일 안에 처리해 드릴게요 |
| 수동, wallet 송금 대기 | **`transfer_pending`** (새 값) | 환불 진행 중 · 계좌로 송금해 드릴 예정이에요 |
| 정산 완료(수동은 wallet SUCCEEDED) | `succeeded` (기존) | 환불 완료 |

- 수동 모드 주문의 송금 여부는 core 가 actions API 를 만들 때 wallet 목록 API(§6.5)로 확인한다 — 수동 모드 주문만, core 의 기존
  wallet HTTP 클라이언트 옆에.
- **옛 스토어프론트는 새 값을 모른다** — 모르는 값을 «환불 처리 중»으로 보이게 먼저 고쳐 배포한다(§9.2 의 4).

## 9. 이행

### 9.1 PR #1044·#1045·#1046 — 닫고 옮긴다

| 출처 | 옮김 | 버림 |
| --- | --- | --- |
| #1045 Medusa | `channel-cancel` 라우트 뼈대(잠금·`assertCancelable`·환불 뒤 오류 500), `WalletHttpError`, FakeWallet 통합 테스트 틀, 기본 취소 특성 테스트(유령 환불 거래 단언 추가) | `classifyWalletRefundRefusal` 두 갈래, 부분취소 502 `refundFailure` 본문 |
| #1046 channel-adapter | `channel-cancel` 경로 전환, 결과 종류 `never` 검사 | `REFUND_FAILED` 생산, 정체 사실 멱등 키의 `walletCode` |
| #1044 계약·core·admin-web | 판정 SQL 상태 분기 모양, shape 순수함수 스펙 모양 | `refundFailure` 계약 필드, `markRefundFailed`, 보류 유지, 두 갈래 문구 |

36번 스펙·계획은 지우지 않고 머리에 «대체됨 → 이 스펙»을 붙인다(ADR-0040 의 역사 기록 방식). 로컬 develop 의 미push 문서 커밋
(`56f04cdea..85fd1d2ae`)이 그 문서들이다.

### 9.2 머지·배포 순서 — 한 스택이라 각 PR 이 혼자 안전하게

| # | PR | 혼자 나갔을 때 |
| --- | --- | --- |
| 0 | **wallet 포인트 환불 결함** — 확정분 환불 때 원장 키를 승인 결제분 id 로 풀어 읽는다(라이브 원장이 그 키로 쌓여 있어 «읽는 쪽»을 고친다) | 포인트 환불이 된다. 재설계와 독립 |
| 1 | wallet: 목록 API, `retryable`·`failure_*`, 수동 실행·송금 완료 일반화 (마이그, `migrate → deploy`) | 아무도 안 쓴다 |
| 2 | Medusa: 정산 라우트 둘(장부 맞추기·수동·분류 번역) | 부르는 쪽 없음. 부분취소 응답 모양은 옛 channel-adapter 가 읽던 그대로 유지 |
| 3 | 계약 + channel-adapter: `channel-cancel` 호출, `SettlementFailed`, ack | 옛 core 는 새 사실을 버린다 → 오늘의 «사유 없는 정체»와 같다. 대신 환불 없는 취소(§2.2)는 사라진다 |
| 4 | 스토어프론트: 모르는 배지 값 대비 + 새 문구 | core 가 새 값을 안 낸다 |
| 5 | core + admin-web: `settling`(마이그, `migrate → deploy`), 확정 즉시 적용, 사실 받기, 리컨실러 규칙(관찰), 조치 API, 보드·상세 | 새 흐름이 켜진다 |
| 6 | 정리: 미들웨어(§6.6), 리컨실러 실행 모드, 스토어프론트 다시 읽기 삭제, 옛 사실 생산·`REFUND_FAILED` 계약 정리 | — |

- 2 와 3 사이, 3 과 5 사이에 배포 한 번씩. 6 의 미들웨어는 3 이 라이브인 뒤.
- **5 배포 전:** 라이브의 열린 `requested` 취소 요청 행 수를 센다(읽기 전용). 옛 행은 옛 규칙([다시 보내기]·[요청 접기])으로 끝까지 돈다.
- 배포 전 대기 마이그레이션 대조는 평소대로(남이 머지한 마이그도 함께 실린다).

### 9.3 롤링 중 섞이는 조합

| 조합 | 결과 |
| --- | --- |
| 새 channel-adapter + 옛 Medusa | `channel-cancel` 이 없어 본문 없는 404 → `retryable: true` 로 냄. 2 를 먼저 배포하면 생기지 않는다 |
| 새 channel-adapter + 옛 core | `SettlementFailed` 를 버린다 → 열린 `requested` 행이 보류된 채 정체(오늘과 같다) |
| 새 core + 옛 channel-adapter | 옛 adapter 가 기본 `/cancel` 을 부른다(오늘과 같다). 옛 사실은 `retryable: true` 로 읽는다. 3 이 먼저면 생기지 않는다 |
| 옛 스토어프론트 + 새 core | 모르는 배지 값 — 4 가 먼저면 생기지 않는다 |

## 10. 테스트

**wallet**
- 포인트: provider 를 mock 하지 않는 경로로 «승인 → 자동 확정 → 환불»이 성공(지금 스펙은 mock 이라 결함을 못 잡았다), 카드+포인트 복합
- 토스 코드 분류표 전수, 모르는 코드 = `retryable: true`
- 수동 실행: 외부 결제 몫 PENDING·`MANUAL`, 포인트 몫 자동, 남은 금액에서 빠짐. `confirmManual` 이 카드 결제분의 수동 행을 받음
- 목록 API

**Medusa 통합** (`scripts/local/run-medusa-integration.sh`)
- `channel-cancel`: 정상(취소·환불 1건·`pending_difference` 0) / 영구 거절(400 표지, 주문 미취소, Refund 행 없음) / 일시(500, 미취소) /
  수동(wallet PENDING, 주문 취소, 차액 0)
- 장부 맞추기: wallet 에 투영 안 된 SUCCEEDED 환불 → 장부에 들어가고 남은 몫만 환불 / `MEDUSA_REFUND` 응답 유실 재현 → 다시 나가지 않음
- **같은 요청 두 번 → 환불 한 번**(전체·부분·수동 각각 — 리컨실러 재발행의 전제)
- 부분취소: 수정 뒤 영구 거절 → 400 표지 + 장부 음수 차액 유지 → 원인 해소 뒤 재호출로 `refunded`
- 특성: 기본 `/cancel` 이 wallet 거절에도 200 + `canceled` + Refund 0 + **환불 거래 −X**(업그레이드 경보)
- 미들웨어: 결제 있는 주문의 기본 `/cancel` 400, 취소된 주문의 기본 환불 400, 정산 라우트는 통과

**channel-adapter** — 응답 → 사실 표 전수, ack, 멱등 키, `refundMode` 전달

**core**
- 확정 트랜잭션: 물리 적용 + `settling` + 명령이 한 트랜잭션, 판정 실패면 아무것도 안 씀
- 사실 받기: `applied`·`refused`·옛 사실, `superseded`, 정산 중 요청 여럿
- 리컨실러: 백오프, `refused` 미재시도, 지문 변화 시 리셋, 관찰 모드
- 조치 API, 옛 `requested` 행 공존(보류·접기 그대로)
- 판정 SQL 세 상태(통합, `describeIfDb`)

**admin-web·스토어프론트** — 상태 라벨·배지 순수함수

**로컬 스모크** (`bootstrap:e2e:local` → `start:all:local` → `preflight:e2e:local`, 브라우저 로그인은 사람)

| # | 준비 | 동작 | 기대 |
| --- | --- | --- | --- |
| S1 영구 거절 | 결제수단 `type = CMS_BATCH` | 고객 취소 | 즉시 «취소 완료 · 환불 처리 중» → 보드 «환불 거절», 출고 대상 아님, Medusa 미취소 |
| S2 수동 환불 | S1 상태 | [계좌 송금으로 환불] → wallet [송금 완료] | Medusa 취소, 고객 «계좌 송금 예정» → «환불 완료» |
| S3 장부 맞추기 | wallet `refunds` 에 SUCCEEDED 행 주입 | 운영자 전체취소 | 남은 몫만 환불, 보드에 아무것도 안 뜸 |
| S4 일시 장애 | wallet 을 내림 | 취소 → 40분 뒤 wallet 올림 | «환불 지연» → 리컨실러가 스스로 정산 완료 |

## 11. 라이브 확인 (읽기 전용, 사용자 실행)

- **포인트 결함 실재·6월 4건 원인:** 포인트 결제분 환불 결과 분포, REDEEM 원장 키가 승인/확정 중 어느 결제분인지, 2026-06 FAILED 환불 사유,
  FAILED 사유 분포 — 스크립트는 세션 스크래치패드 `live-point-refund-check.js`(PR 0 계획에 옮긴다)
- PR 5 전: 열린 `requested` 취소 요청 행 수
- 35번 운영 작업의 «core cancelled × Medusa 미취소 대조»에 **유령 환불 거래**(Refund 행 없는 `reference = 'refund'` 거래)를 함께 센다

## 12. 문서 · 트래커

- **새 ADR**(0044): «채널 주문 취소의 물리 확정은 core 가 요청 순간에, 돈의 정산은 채널이» — ADR-0042 원칙 2 대체, 원칙 1·3·4 유지.
  §2.2 의 Medusa 제약(취소는 돈 정리 뒤)과 S3(의무의 정본은 돈이 있는 곳)를 근거로 적는다
- 35번 스펙 머리에 «§5.3·§5.4·§5.5·§6.3·§7.2·§7.5 는 이 스펙이 고친다» 한 줄, §1·§7.2 의 «Medusa 취소가 환불 단계에서 롤백» 정정
- 36번 스펙·계획 머리에 «대체됨»
- #1016(사용자 확인 뒤 본문 수정, 코멘트 금지): 36번 행 문제 칸 재작성·문서 칸에 이 스펙. 새 행 후보 — 포인트 환불 결함 / 2026-06 일부 환불
  4건 / 대시보드 기본 취소의 유령 환불 거래(§6.6 이 닫는다) / 정산 재시도 리컨실러 규칙(재판정 묶음)
- 메모리 `channel-cancel-refund-refusal-36` 정정, 아티팩트 재게시

## 13. 하지 않는 것

- 포인트 대신 지급, 고객 자동 알림(S4·S8)
- core 범용 환불 의무 엔티티(S3) — 반품·금액 조정 경로(#1016 34·38번)를 만들 때 «정산 단계» 모양을 그쪽에 적용한다
- 네이버·쿠팡 — 자동 취소 능력이 없어 명령을 보내지 않는다(35번 그대로)
- 공휴일 반영 영업일 계산
- 고객의 환불 계좌 입력 화면 — v1 은 운영자가 연락해 받는다
- Medusa 업그레이드(`cancelOrderWorkflow` 의 환불 삼킴·유령 거래가 고쳐진 버전으로 오르면 §6.1 의 순서·§6.6 미들웨어를 재검토)
