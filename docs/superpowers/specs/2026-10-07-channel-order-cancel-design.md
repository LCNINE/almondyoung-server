# 채널 주문 취소·부분취소 — 채널이 환불하고 core 는 문지기 (#1016 35번·31번 행)

트래킹: #1016 35번 행(채널 먼저 취소·수정), 31번 행(일부 출고된 주문의 전체취소). 결정 기록: ADR-0042
(`docs/adr/0042-channel-order-cancel-is-initiated-by-the-channel.md`, ADR-0040 §5.5 부분 대체).
앞선 작업: 5번 행 스펙 `2026-10-05-channel-order-change-sync-design.md`(이하 «5번 스펙»), 6번 행 스펙
`2026-10-06-channel-change-close-design.md`(이하 «6번 스펙» — 명령 스트림을 놓았다).

## 1. 배경 — 같은 돈을 두 시스템이 환불하려 한다

운영자·고객의 Medusa 주문 취소는 지금 core 가 먼저다.

1. core `adminCancelRequest`(`store-sales-orders.service.ts`) 또는 고객 `processCancelRequest` 가 판매주문을 취소한다
2. **같은 요청 안에서** core 가 wallet 에 `so.totalAmount` 환불을 요청한다(`requestWalletRefundAfterCancel`)
3. `SalesOrderCancelled` → channel-adapter `CoreOrderCancelled` 인박스 → `medusaClient.cancelOrder`
   (`inbox-worker.service.ts` 의 `CoreOrderCancelled` 분기)
4. Medusa 2.13.4 `cancelOrderWorkflow` 가 `refundCapturedPaymentsWorkflow` 로 «캡처 − Medusa 가 아는 환불»을 다시
   환불한다 → `almond-payment.refundPayment` → wallet 에 **두 번째 환불 요청**

Medusa 는 core 가 한 환불을 모른다. wallet 환불 사실은 Medusa 에 **닿지도 않았다** — wallet 은 `gateway.refund.succeeded` 를
내고 channel-adapter 가 그대로 전달하지만 `payment-events` 의 `REFUND_EVENT_TYPES` 에 그 이름이 없어 «Unhandled» 로 버려졌다
(`api/hooks/payment-events/route.ts`). 닿았어도 `handleRefundProjection` 은 결제 metadata 만 고치고 Medusa refund 레코드를 만들지
않는다. almond-payment 는 Idempotency-Key 를 호출마다 새 UUID 로 만들었다(`modules/almond-payment/service.ts` `walletFetch`).
막는 것은 wallet 의 환불가능액 검사(`refunds.service.ts` `createByIntent` — charge 행 잠금 + `SUCCEEDED`·`PENDING` 환불 합 차감)
하나다.

**Medusa 가 시작한 환불은 금액이 null 로 나갔다**(코드 추론, 라이브 미실측). Medusa 결제 모듈은 provider 에 `refund.raw_amount`
(BigNumber `{value, precision}`)를 넘기는데 `refundPayment` 가 `Number(input.amount)` 로 NaN → wallet 에 `amount: null` →
`RefundByIntentDto`(`@IsInt @Min(1)`, 전역 ValidationPipe)가 400. 아래 표의 «Medusa 의 두 번째 요청» 은 이 결함 때문에 실제로는
400 이었을 가능성이 크다. PR-A 가 BigNumber 변환과 «양의 정수 아니면 wallet 호출 전 throw» 로 고쳤다 — **고친 뒤의 동작**이
아래 표다.

**돈은 두 번 나가지 않는다.** 결과는 core 환불의 상태에 따라 갈린다(2026-10-06 코드 추적, 위 결함이 없다고 보고):

| core 환불 | Medusa 의 두 번째 요청 | 결과 |
| --- | --- | --- |
| 즉시 성공(카드 등) | charge 가 `REFUNDED` → 기존 환불을 돌려준다(200). 금액 변환이 고쳐지기 전엔 400 → **Medusa 취소 실패** | 고친 뒤엔 겉으로 정상 |
| `PENDING`(무통장 — `bank-transfer.provider.ts`) | `REFUND_AMOUNT_EXCEEDS_AVAILABLE` → Medusa 가 일반 Error 로 던진다 | **Medusa 취소 실패**, 재시도 뒤 failed. core 취소·Medusa 결제완료로 갈린다. Medusa 의 취소 후처리(쿠폰 복원 등)도 안 돈다 |
| 실패(wallet 장애·PG 오류) | Medusa 가 전액 환불에 성공 | 돈은 맞고 core 기록은 «환불 실패» — 누가 환불했는지 기록이 어긋난다 |

부분취소는 Medusa 에 가지 않는다 — channel-adapter 가 `cancellationScope !== 'full'` 을 버린다
(`fulfillment-events.consumer.ts`). 환불은 core 의 비례 추정 + `manual_pending` 이다
(`partial-cancellation-refund-calculator.ts` — 쿠폰·포인트·배송비 배분을 못 해서 자동환불을 열지 않았다).

#1016 판단 10(채널 주문의 정본은 그 채널)과 ADR-0040 §5.5(«취소 판정은 Core, 돈 이동은 wallet, Core → Medusa
취소 역투영 유지»)가 이 지점에서 부딪친다. ADR-0042 가 §5.5 를 부분 대체한다.

## 2. 목표와 성공 기준

1. 채널 주문 하나의 취소·부분취소에 **환불 시도는 한 번**이다 — Medusa 안에서만 일어난다
2. 끝난 뒤 core 판매주문·Medusa 주문 장부(합계 − 거래 = 0)·wallet 환불 합이 **같은 금액**을 가리킨다
3. 취소 요청이 열려 있는 동안 그 주문은 **송장 발급·배치 시작·발송**이 되지 않는다
4. 거절·실패는 운영자에게 사유와 함께 보이고, 결과가 안 오면 5분 뒤 정체 보드에 뜬다
5. 부분취소 환불액은 **구매 시점 기준**이다 — 할인은 원래 배분, 배송비는 주문 시점 정책으로 다시 계산
6. core 는 채널 주문 취소에서 wallet 을 부르지 않고, channel-adapter 를 직접 부르지 않는다
7. `npm run type-check` 0 · `npx jest` 0 · admin-web `tsc --noEmit` 0 · Medusa 통합 스펙 초록

## 3. 결정 (사용자 결정 2026-10-06)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| D1 | 누가 환불을 시작하나 | **채널.** Medusa 주문은 Medusa 가 almond-payment → wallet 으로, 네이버·쿠팡은 그 채널이 스스로. core 는 core 직접 주문만 wallet 을 부른다 | core 가 환불하고 Medusa 는 «환불 없는 취소»만: 할인·배송비·포인트 배분 계산(커머스 엔진의 일)을 core 가 복제하고, Medusa 장부가 계속 늦게 따라간다 / 운영자가 Medusa 에서 직접: 출고 판정이 빠지고 ADR-0040 §5.6(대시보드는 진단 전용)에 어긋난다 |
| D2 | core 의 역할 | **문지기.** 판정 → 요청 기록 + 출고 보류 → 명령. 확정은 수집으로 받는다 | 채널 먼저 + 보류 없음: Medusa 가 환불한 뒤 창고가 출고하는 경합 |
| D3 | 고객 취소 | **같은 길로 옮긴다.** 화면은 «처리 중 → 완료» | 운영자만: 고객 경로의 이중 시도가 남는다 / 고객 부분취소 추가: 기능이 하나 더 붙는다 |
| D4 | 부분취소 범위 | **이번에 넣는다**(자주 일어난다) | 전체취소 먼저 |
| D5 | 부분취소의 할인 | **구매 시점 배분 유지.** 줄 통째 제거는 Medusa 가 그 줄 할인도 뺀다. 수량만 줄면 우리가 비례로 나눈다 | Medusa 재계산(`carry_over_promotions`): «지금» 유효한 프로모션만 다시 붙여, 만료·비활성 쿠폰은 사라지고(과소 환불) 그사이 켜진 자동 프로모션은 소급된다(과다 환불, `prevent_auto_promotions` 를 안 넘긴다). 짧은 프로모션을 자주 하므로 부적합 / 종류별 혼합: 규칙·테스트 두 배 |
| D6 | 부분취소의 배송비 | **주문 시점 정책으로 다시 계산해 차이를 반영.** 그룹 통째 취소 → 그 그룹 배송비 환불, 조건부 무료 미달 → 기본 배송비 차감, 수량당 → 차액 환불. 차감은 그 부분취소의 상품 환불액을 넘지 않는다(고객 추가 청구 없음) | 손대지 않음: 그룹이 통째로 비어도 배송비를 안 돌려준다 / 고객 유리한 쪽만: 무료배송 기준을 맞추려 담았다 빼는 손해를 회사가 진다 |
| D7 | 스냅샷 없는 주문 | **배송비 미조정 + 표시.** 배포 전 주문, 구매 뒤 상품의 배송 그룹이 바뀐 주문 | 지금 정책으로 계산: 그사이 정책을 바꾼 그룹이면 조용히 틀린다 |
| D8 | 31번 행 | **이 스펙이 닫는다.** 출고된 몫이 있는 전체취소 요청 → 출고 안 된 몫의 부분취소로 바꾼다 | 컷오버 준비 때 따로 |
| D9 | 배송비를 «돌려주는» 장부 처리 | **크레딧 라인.** 환불한 배송비만큼 `createOrderRefundCreditLinesWorkflow` — Medusa `cancelOrderWorkflow` 가 쓰는 같은 패턴 | 원래 배송 방법을 `SHIPPING_REMOVE` + `SHIPPING_ADD` 로 갈기: 동작 종류는 문서에 있지만 core-flows 어디에도 원래 배송 방법에 쓰는 워크플로가 없다. 업그레이드 때 우리만 깨진다. 최신 문서의 `SHIPPING_ADJUSTMENTS_REPLACE` 는 2.13.4 에 없다 |
| D10 | 자동 취소 불가 채널(네이버·쿠팡) | **명령을 보내지 않는다.** core 가 요청을 거절하고 admin-web 은 «○○ 판매자센터에서 취소»만 보인다. 채널의 취소는 지금처럼 수집으로만 받는다 | 명령을 보내 «수동 처리 필요»로 돌려받기: 받아들이기만 하는 채널에 왕복이 하나 더 생긴다 |
| D11 | 결과 통지 | **거절, 그리고 «수정됨 · 환불 미완» 진행만 사실로 낸다.** 성공은 재수집된 `OrderCancelled`/`OrderModified` 가 곧 사실이다 | 성공 사실도 발행: 같은 사실이 두 경로로 온다 / 진행 사실 없이: core 가 Medusa 안의 단계를 몰라 가장 급한 상태(주문은 줄고 돈은 안 돌아감)를 구분 못 한다 |
| D12 | ADR | **새 ADR-0042** 가 ADR-0040 §5.5 를 부분 대체 | §5.5 개정 |

## 4. 전체 흐름

```
운영자 / 고객 / wallet 환불 승인 ─요청→ core
  core: ① 판정(지금 취소가 받는 범위, 실행 없이)
        ② 요청 기록(sales_order_amendments) + 보류          ─ 한 트랜잭션
        ③ CancelChannelOrder (outbox → channel-orders.commands.v1)
  channel-adapter:
        ④ Medusa 호출 — 전체: POST /admin/orders/:id/cancel · 부분: POST /admin/orders/:id/partial-cancel
        ⑤ 성공 → syncOrder(force) 로 즉시 재수집 / 정해진 실패 → ChannelOrderCancelRejected
           / 부분취소가 수정 뒤 환불에서 실패 → ChannelOrderCancelStalled 후 재시도
  Medusa: 환불 1회(almond-payment → wallet) + 장부 정리
  core: ⑥ 수집으로 돌아온 OrderCancelled / OrderModified 를 열린 요청과 맞춰 확정 → 보류 해제
        ⑥' 거절 사실 → 요청 rejected + 보류 해제 + 사유
```

- 대상: `automatedCancellation` 능력이 켜진 채널(`channel-capabilities.ts` — 지금은 medusa 뿐)
- core 직접 주문(채널 매핑 없음): 지금 경로 그대로(core 취소 + core → wallet)

## 5. core

### 5.1 요청 기록 — `sales_order_amendments` 한 행

판단 6 의 «단일 변경 기록»이 이 자리다. 새 테이블을 만들지 않는다.

- `status` 에 두 값을 더한다: **`requested`**(채널에 요청함, 결과 대기) · **`rejected`**(채널이 거절·실패).
  성공은 기존 `applied`, 다른 취소에 덮이면 기존 `superseded`
- 행: `origin = 'operator'`, `amendment_kind = 'commercial'`, `deltas` = 취소할 판매주문 줄과 수량
- `metadata`:
  - `request: { kind: 'cancel', scope: 'full' | 'partial', requestedBy, convertedFromFull?, sourceKey }`
  - `requestedBy` = `admin:<actorId>` | `customer:<customerId>` | `wallet-refund-approval:<intentId>`
  - `rejection: { reasonCode, message, at }` (거절 때)
  - `outcome: { refundAmount?, shippingDelta?, shippingNotAdjusted? }` (확정 때 — 수집된 사실에서 채운다)
- **행 id = 명령의 `requestId`.** `sourceKey` 는 운영자 경로의 `Idempotency-Key`, 고객 경로의 명령 컨텍스트 키
- **한 주문에 열린 취소 요청은 하나:** `(sales_order_id) WHERE status = 'requested'` 부분 유니크 인덱스. 늦게 온
  요청(같은 키든 다른 키든)은 열린 요청을 돌려받는다
- 마이그레이션: `sales_order_amendments_status_check` 에 두 값 추가 + 부분 유니크 인덱스 — additive, **`migrate → deploy`**
- `status` 가 쓰이는 곳(대기 목록 필터 `status = pending`, `superseded` 처리)은 새 값을 만나도 바뀌지 않는다. 대기 목록·
  6번의 무시·다시 확인은 `origin = 'channel'` 행만 다룬다 — 요청 행이 섞이지 않는지 테스트로 지킨다

### 5.2 판정 — 취소 코드를 «계획»과 «적용»으로 가른다

`SalesOrdersService.cancelV2Outstanding` 은 지금 검증(남은 수량, 출고·취소분, 박스별 배분)과 실행을 한 함수에서 한다.
이를 둘로 나눈다:

- **계획 산출**(부작용 없음): 요청 줄 → 박스 줄 배분, 거절 사유. 요청 때 이것만 부른다
- **적용**: 계획을 받아 지금처럼 박스·출고지시·예약·취소 기록을 쓴다. 확정 때 부른다

판정 기준은 지금과 같다.

- 운영자: `draft`·`planned`·`recovery_required` 박스에서 뺄 수 있으면 통과
- 고객: 위 + 기존 가드(채널 주문 아님 → 이제 «자동 취소 불가 채널» 판정으로 대체, 출고 증거, 피킹 시작, 디지털 행사)
- 자동 취소 불가 채널: 거절(«○○ 판매자센터에서 취소해 주세요»). core 는 능력 벡터를 모르므로 판매채널 → 가능 여부
  표를 core 쪽에 하나 둔다(medusa 만 true). 채널 어휘가 아니라 «core 가 명령을 보낼 수 있는 채널» 목록이다
- **31번:** 운영자 전체취소 요청인데 출고된 몫이 있으면, 출고 안 된 몫을 줄·수량으로 계산해 `scope: 'partial'`,
  `convertedFromFull: true` 로 기록한다. 출고된 몫은 지금처럼 회수·반품 경로다. 남은 몫이 0 이면 지금처럼 거절

### 5.3 보류 — 주문 단위 판정 하나, 관문 셋

판정: «이 판매주문에 `status = 'requested'` 인 취소 요청이 있는가». 관문 셋이 자기 트랜잭션 안에서 묻고, 있으면
`CANCEL_REQUESTED` 사유로 거절한다.

| 관문 | 위치 |
| --- | --- |
| 송장 발급 | `waybill.manager.ts` `issueForShipment`·`issueBatch` |
| 배치 시작 | `picking/allocation/batch-start.ts` `startBatchPicking` |
| 발송 사전검사 | `waybill.manager.ts` `assertDispatchable`(모든 발송 경로가 거친다) |

- 요청을 만드는 트랜잭션은 지금 취소 코드와 같은 행 잠금(출고지시·박스)을 잡는다. 관문도 그 박스 행을 잠그므로 둘이
  직렬화된다 — «판정 통과 뒤 그사이 출고»가 없다
- 보류는 주문 단위다. 부분취소 요청이어도 그 주문 전체가 멈춘다(보통 몇 초)
- 배치 시작은 «전부 아니면 전무»(#986)라 보류된 주문이 든 배치는 그동안 시작되지 않는다. 사유 문구: «취소 처리 중인 주문이 있습니다»

### 5.4 확정 — 돌아온 변경을 열린 요청과 맞춘다

- **`OrderCancelled`**(Medusa 전체취소 수집): 기존 처리기(`order-events.consumer.ts` `handleOrderCancelled`)가 core 를
  취소한다. 열린 요청이 있으면 `applied` 로 닫는다. 열린 요청이 부분이면 `superseded`
- **`OrderModified`**(부분취소 수집 → 5번 diff): 수량 감소·줄 제거 델타가 열린 요청의 `deltas` 와 **정확히 같으면**
  5.2 의 «적용»(운영자 범위)으로 반영하고 요청 행을 `applied` 로 닫는다. 같은 변경으로 채널 행을 하나 더 만들지 않는다
- 요청과 맞지 않는 나머지 델타(그사이 바뀐 배송지 등)는 지금처럼 5번 규칙을 탄다
- 맞추기는 열린 요청이 하나뿐이라(5.1) 모호하지 않다
- 환불 기록: core 가 wallet 호출로 남기던 `cancellation_linked_wallet_refund` 대신 이미 있는 수집 경로
  `OrderRefundCreated` → `order_lifecycle_refund_collected` 로 들어온다. `outcome` 은 수집된 환불·Medusa 결과에서 채운다

### 5.5 거절·정체

- `ChannelOrderCancelRejected` → 요청 행 `rejected` + `metadata.rejection` + 보류 해제(행 상태가 곧 보류라 따로 할 일 없음)
- `requested` 가 **5분**을 넘기면 정체 보드(#1020) 항목 «취소 요청 미반영»
  - **다시 보내기**: 같은 `requestId` 로 명령 재발행(멱등)
  - **요청 접기**: `rejected`(`reasonCode: OPERATOR_WITHDRAWN`) + 보류 해제. 실제로는 채널이 취소했는데 수집만 늦었어도,
    수집이 오면 판단 10 대로 반영된다(§9-8)

### 5.6 요청자 셋

| 요청자 | 입구 | 바뀌는 것 |
| --- | --- | --- |
| 운영자 | `POST /sales-orders/:id/cancel` → `adminCancelRequest` | 채널 주문이면 요청 경로. 응답 `{ requestId, status: 'requested' }` |
| 고객 | 스토어프론트 `cancel-request` → `processCancelRequest` | 같음. 응답은 actions view(§7.3) |
| wallet 환불 승인 | `POST /sales-orders/cancel-by-intent` → `cancelByWalletIntentAfterRefund` | 지금은 core 취소 후 역투영으로 Medusa 를 취소한다. 역투영이 사라지므로 요청 경로를 탄다. 환불은 이미 wallet 에서 끝났고 §6.4 가 Medusa 장부에 넣어 두므로 Medusa 취소는 환불 없이 끝난다 |

### 5.7 지우는 것 (core)

- 채널 주문 취소에서 wallet 을 부르는 곳: `adminCancelRequest`·`processCancelRequest` 의 `requestWalletRefundOnce`/
  `requestWalletRefundAfterCancel` 호출, 채널 주문 부분취소의 `manual_pending` 기록
- core 직접 주문 경로, `partial-cancellation-refund-calculator`, 옛 기록을 위한 `retryWalletRefund`·수동 완료는 남긴다
- 가드 스펙: 채널 주문 취소 경로가 `WalletRefundClient` 를 부르지 않는다

## 6. Medusa

### 6.1 배송 정책 스냅샷

- `almond-fulfillment` `validateFulfillmentData` 가 `{ ...data, policySnapshot: { policy, shippingGroupCode, shippingProfileId } }`
  를 돌려준다. 이 값은 카트 배송 방법 `data` 가 되고 주문으로 복사된다(`complete-cart.js` 의 `shippingMethods` 매핑)
- 카트 줄 id 는 주문 줄 id 로 이어지지 않고, `completeCartWorkflow` 의 `orderCreated` 훅은 `@ignore`(비공개)라 쓰지 않는다.
  그래서 그룹 소속은 부분취소 때 «주문 줄의 상품이 지금 어느 배송 프로필인가»로 정하고, **모든 배송 대상 줄이 스냅샷
  프로필 중 정확히 하나에 맞을 때만** 배송비를 조정한다. 어긋나거나 스냅샷이 없으면 미조정(D7). 같은 배송 프로필에 원래
  배송 방법이 둘이면 그것도 미조정
- 정책 없는 배송 옵션(고정가 등)은 스냅샷 없이 통과한다 — 체크아웃을 막지 않는다(옛 코드도 그 단계에서 거절하지 않았다).
  스토어프론트의 `/store/carts/:id/shipping-methods/bulk` 도 `validateFulfillmentData` 를 거친다(확인됨)
- 우편번호는 Medusa 주문의 배송지(청구 당시 맥락)

### 6.2 부분취소 라우트와 오케스트레이터

라우트(새로 만듦, 코어 override 아님): `POST /admin/orders/:id/partial-cancel`
`{ requestId: string, items: [{ item_id: string, quantity: number }] }` — `quantity` 는 **취소할** 수량.
응답 `{ requestId, refundAmount, shippingDelta, shippingNotAdjusted, stage }`.

- 응답 구분: 본문 파싱 실패는 400 `type: 'invalid_data'`, 업무 거절은 400 `type: 'not_allowed'`, 수정은 됐는데 환불이 안
  끝났으면 502 `type: 'refund_pending'`(`stage: 'edited'`). **호출자(PR-B)는 status 가 아니라 `type` 으로 가른다.** 기존
  `medusaClient.cancelOrder` 는 400/404 를 성공으로 삼키는데 부분취소 클라이언트는 그걸 베끼면 안 된다(§7.3)
- 인증은 `/admin/*` POST 의 `authenticate('user', [... 'api-key'])` 라 channel-adapter 의 secret API key 로 부를 수 있다

오케스트레이터 `partialCancelOrder`(공식 워크플로를 차례로 부르는 함수 — `createWorkflow` 가 아니다). 주문 잠금
(`partial-cancel:<orderId>`, 120초) 안에서 돈다:

1. `metadata.partialCancels[requestId].stage` 를 읽어 끝났으면 그 결과를 돌려준다. 같은 `requestId` 에 다른 items 면 거절
2. 검증: 주문이 취소되지 않음, 수량 ≤ 현재 수량 → 위반은 `NOT_ALLOWED`. **확정됐는데 진행 기록이 없는 수정**(확정과 기록 사이에서
   죽음)은 계획 검증보다 먼저 막고 사람 확인을 요구한다(500) — 줄을 통째로 뺐다면 계획 검증이 «주문에 없는 줄»로 업무 거절을
   내서 호출자가 요청을 닫고 주문은 수정된 채 환불 0 으로 남기 때문이다
3. 주문 수정 시작 → `orderEditUpdateItemQuantityWorkflow`(남을 수량). `carry_over_promotions` 는 켜지 않는다
4. **할인 비례**(수량만 준 줄): `ITEM_ADJUSTMENTS_REPLACE` 로 남길 할인 = round(원래 할인 × 남은 수량 ÷ 원래 수량)
   (원 단위 반올림, half-up). 할인 줄이 여럿이면 줄마다 같은 식. 줄 통째 제거는 할 일 없음
5. **배송비**(6.1 이 «조정 가능»일 때): 그룹마다 `calculateShippingFee(스냅샷 정책, 남은 줄의 할인 전 소계·수량, 우편번호)`
   − 지금 그 그룹 배송비 = 차이
   - 차이 > 0: «부분취소 배송비» 배송 방법을 `createOrderEditShippingMethodWorkflow`(`custom_amount`, 그 그룹의 shipping option)
     로 추가. 금액 = min(차이 합, 이 부분취소의 상품 환불액)
   - 차이 < 0: «배송비 환불액»에 더한다
   - 그룹 요금 기록(다음 부분취소의 «지금 요금»)은 계산된 새 요금이 아니라 상한에 깎인 **실제 청구액**(`recordedFee`)이다.
     새 요금을 적으면 상한이 걸린 뒤 그 그룹이 비었을 때 받은 것보다 많이 돌려준다
6. 수정 확정(`confirmOrderEditRequestWorkflow`) — Medusa 재고 예약도 줄어든다. 확정 전 실패는 열린 수정을 버려 주문을 원래대로 둔다.
   `stage = edited`
7. 환불 한 번: **돌려줄 금액 = 수정 전후 `pending_difference` 의 차이**(원 단위 반올림) + 배송비 환불액 → 결제마다
   `refundPaymentWorkflow`(캡처 잔액 안에서 차례로) → almond-payment → wallet. 돌려줄 금액을 넘는 몫(= 배송비 환불)은
   `refundPaymentWorkflow` 가 크레딧 라인을 스스로 붙여 장부를 0 으로 맞춘다(`core-flows` `refund-payment.js` 의 `creditLineAmount`)
   — 크레딧 라인 단계는 따로 없다(§10-2). `stage = refunded`

단계는 `edited → refunded` 둘이다. 환불은 결제마다 **결제 잠금**(`almond-payment-refund:<paymentId>`, §6.4 의 투영과 같은 키)
안에서 결제를 다시 읽어 여유를 계산한다.

- 차이를 «확정 뒤 −pending» 이 아니라 수정 전후 차이로 쓰는 이유: 같은 주문의 앞선 부분취소가 `edited` 에 멈춰 있을 때 그 몫까지
  환불해 이중 환불이 된다. 수정 전부터 남은 차액은 그 요청의 재시도가 낸다
- 원 단위로 반올림한다 — 전체 금액에 걸친 할인이 소수로 나뉘어 ≤0.5원 잔차가 생길 수 있다
- 환불 멱등: refund note `partial-cancel:<requestId>` 인 환불을 이미 한 몫으로 센다(환불 뒤 기록 전에 죽어도 두 번 내지 않는다)
- 주문 읽기는 order 모듈로 한다 — `query.graph` 는 주문 수정 뒤 summary·items 가 버전이 섞여 나온다

**재실행은 끊긴 단계부터 이어 간다**(`stage` 기록). 확정된 주문 수정을 Medusa 가 환불 실패 때 되돌리는지 몰라도 안전하다.
7 의 금액은 `stage = edited` 때 metadata 에 함께 적어, 이어 갈 때 다시 계산하지 않는다.

**Medusa 는 JSON 컬럼을 병합 갱신한다**(repository `assign(..., { mergeObjectProperties: true })`) — 키를 빼고 저장해도 지워지지
않는다. 지울 땐 `null` 을 쓴다(§6.4 표식 해제가 이걸로 처음엔 안 됐다).

### 6.3 전체취소

코어 라우트 `POST /admin/orders/:id/cancel` 그대로. 「캡처 − 환불」만큼 환불하는데 §6.4 덕분에 이 계산이 맞다.
취소 후처리 구독자(`coupon-grant-restore`·`membership-benefit-order`·`welcome-membership-order`)가 함께 돈다.

### 6.4 원칙 3 — Medusa 장부에 모든 환불이 남는다

- Medusa 가 시작하지 않은 wallet 환불 사실이 오면 `handleRefundProjection` 이 metadata 기록에 더해 **Medusa 환불 레코드를 만든다**.
  이를 위해 `gateway.refund.succeeded` 를 `REFUND_EVENT_TYPES` 에 더해 연결했다(§1 — 그 전엔 버려졌다). **배포 즉시 이 투영이
  라이브에서 처음 돈다**
- 캡처 투영(`handleCaptureProjection` 의 `captured: true`)과 같은 패턴: 결제 `data` 에 단일 표식
  `externalRefund: { walletRefundId, amount }` 를 남기고 `refundPaymentWorkflow` 를 돌리면, `almond-payment.refundPayment` 가
  표식(금액이 같을 때)을 보고 wallet 호출을 건너뛰며 표식을 `null` 로 지운다(§6.2 의 JSON 병합 함정)
- 투영은 **결제 단위 잠금**(`paymentRefundLockKey(payment.id)`, `Modules.LOCKING`) 안에서 결제를 다시 읽어 판정 → 표식 →
  `refundPaymentWorkflow` 순으로 돈다. 워크플로가 실패하면 표식을 지우고 다시 던진다(재배달이 다시 쓴다). 환불을 내는 쪽(§6.2)이
  같은 키를 쓴다
- «Medusa 가 시작한 환불인가»는 wallet 이 환불 사실에 싣는 `reasonCode === 'MEDUSA_REFUND'`(almond-payment 가 넘기고 wallet 이
  이제 사실에 싣는다 — §10-4) **또는** provider 가 결제 `data.walletRefundIds` 에 기록해 둔 wallet 환불 id 로 가린다. refundId 없는
  옛 사실은 기록하지 않는다
- 대상: wallet 관리자 환불, 무통장 환불 승인. Medusa 결제가 없는 intent 는 지금처럼 건너뛴다
- `refundPayment` 의 wallet 호출 Idempotency-Key 는 `medusa-refund:<context.idempotency_key>`(= Medusa refund 행 id)다.
  **한계:** provider 호출이 실패하면 Medusa 가 refund 행을 지우므로, «wallet 은 환불했는데 응답만 유실» 된 경우 재시도는 새 키로
  나간다 — wallet 환불가능액 검사가 남은 방어선이다(기존 Medusa 동작)

## 7. 계약·channel-adapter·화면

### 7.1 명령 — `channel-orders.commands.v1` 에 `CancelChannelOrder`

```ts
interface CancelChannelOrderPayload {
  requestId: string;              // core sales_order_amendments.id
  salesChannel: string;
  externalOrderId: string;
  scope: 'full' | 'partial';
  lines?: Array<{ channelOrderItemId: string; quantity: number }>; // partial 일 때만, 취소할 수량
  reasonCode?: string;
  requestedBy: 'operator' | 'customer' | 'wallet-refund-approval';
  requestedAt: string;            // ISO 8601
}
```

파티션 키 `channelOrderPartitionKey` — 같은 주문의 «다시 확인»과 취소가 순서대로 처리된다.

### 7.2 결과 사실 — `orders.events.v1` 에 `ChannelOrderCancelRejected`

`{ requestId, salesChannel, externalOrderId, reasonCode, message }`

| reasonCode | 뜻 |
| --- | --- |
| `NOT_SUPPORTED` | 자동 취소 불가 채널(방어선 — core 가 이미 거른다) |
| `ORDER_NOT_FOUND` | 채널에 그 주문이 없다 |
| `NOT_CANCELABLE` | Medusa 가 상태상 거절(`NOT_ALLOWED`) |
| `REFUND_FAILED` | wallet 이 «환불 불가»류로 거절해 Medusa 워크플로가 롤백(`REFUND_AMOUNT_EXCEEDS_*`·`CHARGE_NOT_REFUNDABLE`) |

core 의 거절 처리 사유에는 `OPERATOR_WITHDRAWN`(§5.5)이 더 있다 — 사실이 아니라 core 내부 값이다.

**진행 사실 — `ChannelOrderCancelStalled { requestId, salesChannel, externalOrderId, stage: 'edited', message }`.**
부분취소 라우트가 수정 확정 뒤 환불에서 실패하면(응답 `stage = edited`) channel-adapter 가 재시도용으로 던지기 **전에** 이것을 낸다.
종결이 아니다 — core 는 요청 행 `metadata.request.stage = 'edited'` 만 적고 `requested` 를 유지한다(같은 값이라 여러 번 와도 멱등).
core 는 Medusa 안의 진행 단계를 볼 길이 없으므로, 정체 보드가 «수정됨 · 환불 미완»을 구분하려면 이 사실이 필요하다(§7.4).

### 7.3 channel-adapter

`ChannelOrdersCommandConsumer` 에 처리기 하나:

1. 능력 확인 → 아니면 `NOT_SUPPORTED`
2. 매핑으로 Medusa 주문 id 확인 → 없으면 `ORDER_NOT_FOUND`
3. 전체 → `medusaClient.cancelOrder`, 부분 → `medusaClient.partialCancelOrder`(새). 둘 다 `requestId` 를 넘긴다
4. 성공 → `orderPoller.syncOrder(salesChannel, externalOrderId, { force: true })`

실패 분류:

- 정해진 실패(위 표) → 거절 사실 발행, 정상 종료
- 일시 실패(Medusa 5xx, 네트워크, **부분취소 라우트 404** — 롤링 중 옛 Medusa) → 던진다(재시도·DLQ). 재수집 실패도 여기다
- **`cancelOrder` 의 400 분류를 고친다:** 지금은 400 이면 무엇이든 «이미 취소됨»으로 성공 처리한다(`medusa.client.ts`).
  «이미 취소됨»만 성공, 나머지 400 은 `NOT_CANCELABLE`
- **부분취소 클라이언트는 그걸 베끼지 않는다:** 400 은 `type` 으로 가른다 — `not_allowed` 만 정해진 거절, `invalid_data`(본문 오류)는
  호출 쪽 버그라 던진다. 502 `refund_pending` 은 일시 실패(§6.2, §9-5)

### 7.4 admin-web

- 취소 대화상자(`lib/services/orders/mutations.ts` 의 취소 mutation): 응답 `{ requestId, status: 'requested' }` 를 받으면 닫고,
  주문에 «취소 요청됨» 배지. 그 주문을 잠깐 다시 읽어 확정되면 배지가 사라진다
- 거절: 주문 상세에 «취소 실패 · 사유» + [다시 요청]
- 변경 기록에 요청 행 한 줄: «환불 27,500원 · 배송비 −3,000원», 미조정이면 «배송비 미조정»
- 자동 취소 불가 채널 주문: 취소 버튼 자리에 «○○ 판매자센터에서 취소»
- 채널 주문에는 환불 «수동 완료»·«재시도»를 새로 띄우지 않는다(옛 기록은 그대로)
- 정체 보드: «취소 요청 미반영» 항목, 기준 5분, 조치 [다시 보내기]·[요청 접기]. 집계는 서버가 끝내서 보낸다.
  `ChannelOrderCancelStalled` 를 받은 요청(§7.2)은 **«수정됨 · 환불 미완»** 으로 따로 표시한다 — Medusa 주문은 줄었는데
  돈이 아직 안 돌아간 가장 급한 상태다. 같은 [다시 보내기]가 환불 단계부터 이어 간다

### 7.5 스토어프론트

- 취소 → «취소 처리 중», actions API 를 **2초마다 최대 30초** 다시 읽는다. 끝나면 «취소 완료». 30초를 넘기면 읽기만 멈춘다
- 거절: «취소를 완료하지 못했습니다. 고객센터로 문의해 주세요.»
- `StoreOrderActionsResponse` 에 `cancelRequestStatus?: 'requested' | 'rejected'`, `StoreCancelUnavailableReason` 에 `cancel_requested`
- 환불 요약(`refundSummary`)은 수집된 환불 기록(`order_lifecycle_refund_collected`)에서 만든다
- 주문 목록은 Medusa 에서 읽으므로 Medusa 취소가 끝나는 순간 «취소됨»이 된다
- 부분취소 뒤 주문 상세가 Medusa 합계를 그대로 그리면 크레딧 라인이 낯선 차감 줄로 보일 수 있다 — 구현 계획 때
  상세 화면의 합계 출처를 확인하고 필요하면 «배송비 환불»로 표시한다

## 8. 지우는 것

- **core → Medusa 취소 역투영**: `fulfillment-events.consumer.ts` `handleCoreOrderCancelled` 와 `inbox-worker.service.ts`
  `CoreOrderCancelled` 분기. **PR-D 에서**(§11). 그 처리기 주석의 35번 행 언급도 함께
- §5.7 의 core 쪽
- `apps/channel-adapter/CLAUDE.md` 에 한 줄: «`CancelChannelOrder` 를 받아 채널에 취소를 요청한다 — core 는 직접 부르지 않는다»

## 9. 경합과 실패

1. **요청 vs 출고**: §5.3 의 같은 행 잠금으로 직렬화
2. **고객·운영자 동시 요청**: 열린 요청 하나(§5.1). 늦은 쪽은 먼저 온 요청을 돌려받는다
3. **명령 중복 처리**(최소 1회 전달): 전체 — 이미 취소됨 → 성공. 부분 — 같은 `requestId` 의 `stage`
4. **Medusa 성공 뒤 재수집 전 channel-adapter 사망**: 재시도 → 멱등 → 재수집. DLQ 여도 5분 폴링이 끌어와 요청을 닫는다
5. **부분취소의 수정 확정 뒤 환불 실패**: `ChannelOrderCancelStalled` 를 낸 뒤 일시 실패로 재시도, `stage = edited` 부터 이어 간다.
   끝내 안 되면 정체 보드에 «수정됨 · 환불 미완» → [다시 보내기]
6. **전체취소의 환불 실패**: Medusa 워크플로가 취소까지 되돌린다. «환불 불가»류면 `REFUND_FAILED`, 네트워크·5xx 면 재시도
7. **부분취소 요청이 열린 채 채널 전체취소가 옴**(예: 무통장 환불 승인): 전체취소 반영, 열린 요청 `superseded`
8. **요청을 접은 뒤 늦은 수집**: 판단 10 대로 반영. 부분취소면 5번 규칙이라 박스가 `planned` 면 «반영 대기 변경»에 남는다 — 운영자가 거기서 처리
9. **메아리**: PR-D 뒤 역투영이 없으므로 채널 쪽 취소 반영이 채널로 돌아가지 않는다. PR-C~PR-D 사이에는 역투영이
   «이미 취소됨»으로 무해하게 끝난다
10. **포인트 병용 결제**: wallet `createByIntent` 가 charge 비례로 나눈다 — 바뀌지 않는다
11. **무통장 환불**: Medusa 가 환불 레코드를 남기고 wallet 은 `PENDING` 으로 송금을 추적한다 — 두 번째 요청이 없으므로 충돌 없음
12. **`edited` 에 멈춘 부분취소 뒤에 전체취소가 옴**: 전체취소가 캡처 잔액을 다 환불하므로 그 부분취소의 재시도는 «캡처 잔액 부족»으로
    영원히 실패한다. 돈은 맞는데 끝 상태가 없다 — PR-B/C 가 정체 보드에서 이 경우를 닫아야 한다
13. **품목과 무관한 wallet 일부 환불 뒤 같은 품목의 부분취소**: 외부 환불은 크레딧 라인으로 투영될 뿐 품목에 묶이지 않아, 같은
    품목을 Medusa 에서 부분취소하면 다시 환불한다
14. **배포 겹침 창**: `reasonCode` 없는 옛 wallet 의 사실이 아직 `walletRefundIds` 에 안 실린 Medusa 환불의 것이면 한 번 더
    기록될 수 있다(좁은 창)

## 10. 먼저 확인할 항목 (구현 계획 첫 태스크 — Medusa 실 DB 통합 테스트)

결과가 예상과 다르면 §6 을 고친 뒤 진행한다.

1. 줄 수량만 줄였을 때(`carry_over_promotions` 꺼짐) 줄 할인 금액이 그대로 남는가 — §6.2-4 의 전제
   **답(2026-10-07): 그대로 남는다.**
2. 환불 + 크레딧 라인 뒤 주문의 «합계 − 거래»가 0 인가 — §6.2-7
   **답(2026-10-07): 0 이다.** 크레딧 라인은 `refundPaymentWorkflow` 가 붙인다.
3. `confirmOrderEditRequestWorkflow` 가 돌려줄 차액에 결제 컬렉션을 따로 만드는가(`createOrUpdateOrderPaymentCollectionWorkflow`)
   **답(2026-10-07): 새로 만들지 않는다.**
4. wallet 환불 사실 payload 에 `reasonCode` 가 실리는가 — §6.4 의 판별 근거
   **답(2026-10-07): 실리지 않았다 → wallet 이 싣게 했다(PR-A).**
5. (core) 미등록 명령을 `EventTypeGuard` 가 조용히 넘기는가 — §11 롤링 함정

## 11. 배포 — 한 SST 스택이라 각 PR 이 혼자 안전하게

| PR | 내용 | 배포 직후 |
| --- | --- | --- |
| **A** Medusa | 배송 정책 스냅샷, 부분취소 라우트·오케스트레이터, §6.4 환불 투영 | 부르는 쪽 없음. §6.4 만 즉시 효과(무통장 충돌 감소). 먼저 나갈수록 스냅샷 있는 주문이 쌓인다 |
| **B** 계약 + channel-adapter | 명령·거절 사실, 명령 처리기, 400 분류 | 보내는 쪽 없음 |
| **C** core + admin-web + 스토어프론트 | 요청·보류·관문·확정·거절·정체, wallet 호출 제거, 화면. 마이그 additive → **`migrate → deploy`** | 전환. 역투영은 살아 있다(무해한 중복, 롤링 중 옛 core 태스크의 취소도 Medusa 에 닿는다) |
| **D** channel-adapter | 역투영 제거 | **C 배포가 끝난 뒤**(expand-contract — 사이에 배포 한 번) |

롤링 중 함정:

- 새 core 가 옛 channel-adapter 에 명령을 보내면 처리기가 없다 → 요청이 `requested` 로 남아 5분 뒤 정체 보드 → [다시 보내기]
- 새 channel-adapter 가 옛 Medusa 의 부분취소 라우트를 부르면 404 → 일시 실패로 재시도(§7.3)

### ⚠️ PR-D 전 라이브 확인 — 이미 어긋난 주문

지금 구조 때문에 «core 취소 · Medusa 결제완료»로 남은 주문이 있을 수 있다(§1 의 무통장 경우). channel-adapter
`inbox_events` 의 `CoreOrderCancelled` 중 `failed` 가 후보다. PR-D 가 역투영을 지우면 그 행을 다시 돌릴 길도 사라지므로,
PR-D 전에 읽기 전용으로 센다(`sst shell --stage live`, 사람이 실행):

```sql
-- channel_adapter
select status, count(*), min(created_at), max(created_at)
  from inbox_events where event_type = 'CoreOrderCancelled' group by 1;
```

있으면 정리 스크립트를 따로 둔다: §6.4 로 wallet 환불을 Medusa 장부에 먼저 넣고 → Medusa 를 취소해 환불 없이 끝나게 한다.

## 12. 테스트

- **core**(유닛 + `describeIfDb`): 계획/적용 분리(순수 함수) · 요청(멱등, 열린 요청 하나, 자동 취소 불가 채널 거절, 고객 가드,
  31번 전환, 남은 몫 0 거절) · 관문 셋의 `CANCEL_REQUESTED` · 확정 맞추기(정확히 맞음 → 운영자 범위 적용 / 일부 → 나머지 5번 /
  안 맞음) · 전체취소 수집 시 열린 부분 요청 `superseded` · 거절 처리 · 정체 항목 · 요청 행이 «반영 대기 변경»·무시·다시
  확인에 섞이지 않음 · 요청 vs 배치 시작 직렬화(실 DB) · **가드: 채널 주문 취소가 `WalletRefundClient` 를 부르지 않음**
- **이벤트 계약**: `CancelChannelOrder`·`ChannelOrderCancelRejected`·`ChannelOrderCancelStalled` 스키마·레지스트리
- **channel-adapter**(유닛): 능력 확인, 전체/부분 라우팅, 400 분류(이미 취소됨만 성공), 부분 라우트 404 는 던짐, 일시 실패는 던짐,
  성공 뒤 재수집, 거절 사실 발행, `stage = edited` 실패면 진행 사실을 낸 뒤 던짐
- **Medusa**(`scripts/local/run-medusa-integration.sh`, 실 DB + redis): §10 1~4 · 할인 비례 반올림 · 줄 통째 제거 · 배송비(조건부 무료
  미달과 상한, 그룹 통째 취소 → 크레딧 라인, 수량당, 스냅샷 없음 → 미조정, 그룹 어긋남 → 미조정) · 같은 `requestId` 재실행 ·
  환불 한 번 실패 뒤 이어 가기(한 번 실패하는 가짜 provider) · §6.4 투영 뒤 전체취소 → provider 환불 호출 0회 ·
  `no-duplicate-validate-hooks` 그대로 초록(훅을 더하지 않는다)
- **수동 스모크**(로컬 E2E — 브라우저 로그인은 사람이): 카드 전체취소 · 쿠폰 쓴 주문의 부분취소 · 조건부 무료배송 미달 · 고객 취소 · 거절 경로
- **게이트**: `type-check`·`jest` 0, admin-web `tsc --noEmit`, `apps/medusa` 통합 CI

## 13. 하지 않는 것

- 고객 부분취소(스토어프론트) — 운영자만
- 네이버·쿠팡의 «취소 요청 승인/거부» 연동 — 판매자 판단에 core 의 출고 상태가 필요하다. 연동할 때 능력 벡터를 켜고 같은 명령
  스트림에 승인 명령을 더한다
- 출고된 몫의 회수·반품 — 지금 경로(34번 행)
- Medusa 업그레이드 뒤 `SHIPPING_ADJUSTMENTS_REPLACE` 로 옮기기 — D9 의 크레딧 라인을 그쪽으로 바꿀 수 있다
- 구매 뒤 상품의 배송 그룹이 바뀐 주문의 배송비 정확화(§6.1 미조정으로 둔다)
