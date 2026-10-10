# 외부 환불 뒤 부분취소 — 이중 환불 안전망 (#1016 37번)

트래킹: #1016 37번 행(분류 C, 지금, 묶음 «채널 정본», 관련 35번). 원인 기록: `2026-10-07-channel-order-cancel-design.md` §9-13.
상위 결정: ADR-0043(환불은 «무엇을 되돌리는가»로 나누고 주문 정본 하나가 낸다) — 이 스펙은 그 모델의 첫 조각이고, 나머지 조각은
§10 의 #1016 새 행이다.

## 1. 배경

### 1.1 구멍

1. 운영자가 wallet 관리자 화면(`apps/admin-web/src/app/(admin)/payments/[id]/payment-detail-sidebar.tsx` →
   `POST /v1/admin/payment-intents/:id/refund`, `payment-intent-admin.controller.ts`)에서 Medusa 주문의 결제를 X원 환불한다.
   입력은 charge·자유 금액·자유 사유뿐이고 품목은 없다.
2. 환불 사실이 Medusa 로 투영된다(`apps/medusa/src/api/hooks/payment-events/route.ts` `handleRefundProjection` Step 1.5):
   표식 `externalRefund` + `refundPaymentWorkflow({ amount: X, note: 'wallet:<walletRefundId>' })`. 갚을 차액이 0 인 주문이면
   Medusa 2.13.4 `refundPaymentWorkflow` 가 환불 «전액»을 크레딧 라인으로 붙인다(`pending_difference ≥ 0` 이면 creditLineAmount =
   환불액) — 장부에는 «금액 조정 X»로 남는다. 어느 품목의 몫인지는 어디에도 없다.
3. 같은 품목 Y원어치를 core → Medusa 부분취소(`partial-cancel-order.ts`)로 취소하면 주문 수정이 차액 −Y 를 만들고, 워크플로는
   Y 를 그대로 환불한다. wallet 은 «캡처 − 환불» 안이라(Y ≤ P − X) 통과시킨다. **같은 품목에 X + Y 가 나간다.**

전체취소는 안전하다 — Medusa 가 «캡처 − 환불»만 돌려준다.

### 1.2 라이브 (2026-10-10, READ ONLY)

- Medusa 주문 결제에 붙은 wallet 외부 환불(`MEDUSA_REFUND` 아닌 것) 535건 중 Medusa 장부에 투영된 것은 3건 — 투영은 10-07
  PR-A 배포부터 돈다(ADR-0042 원칙 3).
- 외부 «일부» 환불(환불 합 < 결제액)이 있는 Medusa 주문 291건. core 상태: `shipped` 284, `cancelled` 4, `delivered` 1, 판매주문 없음 2.
  **core 미출고·미취소 0건, Medusa `partialCancels` 기록 0건** — 이중 환불은 아직 한 번도 일어나지 않았고 정리할 주문도 없다.
- 사유 칸은 대부분 «○○ 품절 부분 취소», «○개 부족 부분 취소» 같은 품목 문장이고, 반품·변경 차액·멤버십가 차액·배송 지연이 섞인다.

### 1.3 왜 지금은 안 터지고, 언제 터지는가

셀메이트 과도기에는 `scripts/sellmate/mark-shipped-from-csv.ts` 가 판매주문을 일괄 `shipped` 로 올려 core 부분취소가 막힌다.
품절분을 돌려줄 출구가 wallet 관리자 환불뿐이고, 그 주문은 core 에서 다시 부분취소될 수 없다. **core 출고 개통(한진) 뒤**
미출고 주문의 부분취소가 열리는데 운영자 습관(품절 → 관리자 환불)이 남아 있으면 그때 터진다.

## 2. 목표와 성공 기준

- Medusa 부분취소는 «품목에 연결되지 않은 외부 환불»이 있는 주문에서 운영자의 확인 없이 환불하지 않는다.
- 운영자가 «이미 환불한 금액»을 주면 그만큼 상계해 나머지만 환불하고, Medusa 장부(크레딧 라인 합·환불 합·갚을 차액 0)가 맞는다.
- 외부 환불이 없는 주문의 부분취소는 지금과 한 글자도 다르지 않게 돈다.
- 어느 앱이 먼저 배포돼도 이중 환불 쪽으로 열리지 않는다.

## 3. 결정 (사용자 결정 2026-10-10)

- **접근 A** — 지금은 안전망(Medusa 부분취소가 거절 + 운영자 확인 출구). 입구 차단(wallet 관리자 품목 환불 막기)은 core 출고
  개통 체크리스트로 미룬다(§1.3 — 지금 막으면 품절분 출구가 없다).
- **자동 차감 기각** — 외부 환불에는 보상·차액도 섞여 있어(§1.2), 종류를 모르고 빼면 보상을 품목 값으로 먹는다(ADR-0043 기각 1).
- **반품 환불(`RETURN_COMPLETED`)도 예외로 두지 않는다** — Medusa 장부에 사유가 없고, «반품 뒤 같은 주문 미출고분 부분취소»는
  드물며, 34번이 반품을 Medusa 로 옮기면 사라진다. 그 경우 운영자는 0원으로 답한다.
- **거절 표지는 기존 코드에 사유를 더한다** — 새 HTTP 코드를 만들면 옛 channel-adapter 가 일시 실패로 보고 재시도·DLQ 로 보낸다(§8).
- **범위** — 환불 모델 전체는 ADR-0043 로 기록하고, 이 스펙은 안전망과 출구만 한다(§10).

## 4. Medusa — `partial-cancel-order.ts`

### 4.1 미해결 외부 환불 U

```
U = Σ(그 주문 결제들의 refund 중 note 가 'wallet:' 로 시작하는 것의 amount)
  − Σ(metadata.partialCancels 기록들의 externalRefundApplied)
```

- 장부만 읽는다. wallet 은 부르지 않는다. 결제 목록은 `orderPaymentIds` 그대로.
- 계산은 순수 함수(`unresolvedExternalRefund(refunds, records)`)로 뺀다 — 같은 파일 옆 `external-refund.ts`.
- 10-07 이전 외부 환불은 투영되지 않아 U 에 안 들어간다. §1.2 대로 그 주문은 전부 출고·취소돼 부분취소 대상이 아니다 — **이
  전제가 깨지면(투영 안 된 외부 환불이 있는 미출고 주문이 생기면) 안전망이 못 본다.** 새로 생기는 외부 환불은 전부 투영된다.

### 4.2 입력과 세 갈래

`PartialCancelInput.alreadyRefunded?: number`(원, 0 이상 정수). 판정은 **주문 수정 전에** 한다(거절이 주문을 건드리지 않게).

| U | `alreadyRefunded`(a) | 결과 |
|---|---|---|
| 0 | 없음 | 지금과 같다 |
| 0 | 0 | 지금과 같다 |
| 0 | > 0 | 거절 `external_refund_absent` — «돌려준 외부 환불이 없습니다» |
| > 0 | 없음 | 거절 `external_refund_unresolved` + `unresolvedAmount: U` |
| > 0 | 0 ≤ a ≤ U | 진행(§4.3) |
| > 0 | a > U | 거절 `external_refund_exceeds` + `unresolvedAmount: U` |

거절은 모두 `PartialCancelRejected` 의 하위 클래스 `PartialCancelExternalRefundRejected { reason, unresolvedAmount }` 다.

### 4.3 상계

주문 수정·확정은 지금 그대로다. 수정 뒤:

1. `owed = roundWon(order.pendingDifference − edited.pendingDifference)`(기존 계산, 품목 차액).
2. `applied = min(a, max(0, owed))` — 상계는 품목 차액까지만이다. 배송비 환불 몫은 상계하지 않는다(a 가 남으면 U 에 남아 다음
   부분취소에서 다시 묻는다).
3. 기록: `refundAmount = max(0, owed) − applied + 배송비 환불`, `externalRefundApplied = applied`. 요청 해시에 a 를 넣되 **a 가 없을 때는
   지금과 같은 해시**가 나오게 한다(배포 중 옛 코드가 남긴 `edited` 기록을 새 코드가 이어 갈 때 «다른 요청»으로 거절하지 않게).
4. `applied > 0` 이면 **음수 크레딧 라인 −applied** 를 공식 `createOrderCreditLinesWorkflow` 로 넣는다 —
   `reference: 'partial-cancel'`, `reference_id: requestId`. 넣기 전에 주문의 크레딧 라인에 같은 `reference_id` 가 있으면 건너뛴다
   (진행 단계를 늘리지 않고 멱등을 잡는다 — core 가 읽는 `stage` 계약이 그대로다).
5. 환불(`refund()`)은 지금 그대로 `refundAmount` 를 낸다.

장부가 맞는 이유: 외부 환불 X 는 «+X 크레딧 라인»으로 남아 있다. −applied 가 그 몫을 «품목 값»으로 다시 적는다. 품목 Y 를 빼고
X 를 상계하면 수정 뒤 차액 −Y → 크레딧 라인 뒤 −(Y−X) → 환불 Y−X 뒤 0. 배송비 환불 S 가 있으면 환불은 Y−X+S 이고,
`refundPaymentWorkflow` 가 차액을 넘는 S 만큼 양수 크레딧 라인을 스스로 붙인다(기존 동작). Medusa 검증
(`validateOrderCreditLinesStep`: 차액이 음수일 때만 음수 라인, |차액| 이내)도 이 순서에서 지켜진다 — applied ≤ owed ≤ |수정 뒤 차액|
(수정 전 차액이 0 이하일 때).

**확인 필요(구현 계획 첫 태스크, §9):** `createOrderCreditLinesWorkflow` 는 차액을 `query.graph` 로 읽는데, `loadOrder` 주석대로
주문 수정 직후 `query.graph` 가 옛 버전 summary 를 섞어 낼 수 있다. 섞이면 검증이 «차액 0» 으로 보고 던진다. 그 경우 대안은
같은 주문 수정에 `CREDIT_LINE_ADD` 동작을 더해 확정과 원자적으로 넣는 것이다(`createOrderChangeActionsWorkflow`, 품목 할인 재작성과
같은 자리) — 이때 검증은 우리 코드가 한다(applied ≤ owed 는 수정 전에 알 수 없으므로 `plan.itemRefundEstimate` 로 상한).

### 4.4 기록·결과

- `PartialCancelRecord.externalRefundApplied?: number`(없으면 0 — 옛 기록).
- `PartialCancelResult.externalRefundApplied: number`.
- 이어 가기: 같은 requestId 재호출은 기록의 applied 를 쓴다(다시 판정하지 않는다). U 판정은 기록이 없을 때만 한다.

### 4.5 라우트

- `parse-input.ts`: `already_refunded`(선택, 0 이상 정수).
- 거절은 지금처럼 400 `{ type: 'not_allowed', code: 'partial_cancel_rejected', message }` 에 `reason`, `unresolvedAmount` 를 더한다.
- 성공 응답에 `externalRefundApplied`.

## 5. 계약·channel-adapter

### 5.1 계약 (`packages/event-contracts`)

- `CancelChannelOrderPayload.alreadyRefundedAmount?: number` — 0 이상 정수, `scope: 'partial'` 에만(superRefine: 전체취소에 실으면 거절).
- `CHANNEL_ORDER_CANCEL_REJECTION_CODES` 에 `EXTERNAL_REFUND_UNRESOLVED` 를 더한다. Medusa 의 세 사유(§4.2)를 모두 이 코드로 낸다 —
  운영자의 다음 행동(금액을 넣어 다시 요청)이 같다. 구분은 `message` 가 한다.
- `ChannelOrderCancelRejectedPayload.unresolvedRefundAmount?: number`.
- `OrderModifiedCancelRequest.externalRefundApplied?: number`(0 이면 생략).

### 5.2 channel-adapter

- `medusa.client.ts` `partialCancelOrder`: 입력 `alreadyRefunded` 를 `already_refunded` 로 싣는다. 400 `partial_cancel_rejected` 에
  `reason` 이 `external_refund_*` 면 `{ kind: 'external_refund', message, unresolvedAmount }`, 아니면 지금처럼 `rejected`.
- `channel-order-cancel.manager.ts`: `external_refund` → `EXTERNAL_REFUND_UNRESOLVED` 거절 + `unresolvedRefundAmount`.
- `medusa-order.source.ts` `readCancelRequests`: 기록의 `externalRefundApplied` 를 싣는다.

## 6. core

- `CancelSalesOrderDto.alreadyRefundedAmount?`(`@IsInt() @Min(0)`). `adminCancelRequest` → `CancelRequestInput.alreadyRefundedAmount`.
- `ChannelCancelRequestManager.request`: 값이 있는데 채널이 `medusa` 가 아니거나 scope 가 `full` 이면 `BadRequestError`. 있으면
  명령에 싣는다 — 명령이 요청 행 metadata 에 그대로 남아 [다시 보내기]도 같은 값을 낸다.
- 거절 사실: `rejection` 에 `unresolvedRefundAmount` 를 더해 적는다(`CancelRequestMetadataSchema`, `CancelRequestView`).
- 확정 사실: `outcome.externalRefundApplied`(있을 때).
- 고객(`StoreCancelOrderDto` 에 줄이 없다)과 wallet 환불 승인은 전체취소만 요청하므로 이 경로를 타지 않는다. 운영자의 전체취소가
  출고분 때문에 부분으로 바뀌는 경우(`convertedFromFull`)는 부분취소라 이 거절을 만날 수 있다 — 같은 출구를 쓴다.

## 7. admin-web

- `cancel-request.shape.ts`: `REJECTION_LABELS.EXTERNAL_REFUND_UNRESOLVED = '이미 환불한 금액 확인 필요'`. 뷰에 `unresolvedRefundAmount`,
  `outcome.externalRefundApplied`.
- 취소 창(`cancel-order-modal.tsx`): **그 주문의 직전 요청이 `EXTERNAL_REFUND_UNRESOLVED` 로 거절됐을 때만** «이미 환불한 금액» 칸을
  보인다. 칸 아래 한 줄: «품목에 연결 안 된 외부 환불 N원». 그 상태에선 칸이 필수(0 허용). 평소엔 숨긴다.
- 보일지 판정은 순수 함수(`needsAlreadyRefunded(view)`)로 뺀다 — admin-web 은 컴포넌트 테스트를 못 돌린다.
- 반영 줄(`cancelRequestLine`): applied 가 있으면 «외부 환불 X원 상계»를 덧붙인다.

## 8. 경합과 실패

1. **판정과 외부 환불 사이의 경합**: U 를 읽은 뒤 확정 전에 새 외부 환불이 투영되면 그 몫은 이번 판정에 안 들어간다. 이번 요청은
   그 환불을 모른 채 Y 를 내고, 새 외부 환불이 같은 품목이었다면 이중 환불이다. 창은 주문 잠금(`partial-cancel:<orderId>`) 안의
   수 초이고, 투영은 결제 잠금만 잡는다. 사람이 같은 주문을 두 화면에서 동시에 환불하는 경우라 받아들인다.
2. **배포 겹침**:
   - 옛 channel-adapter + 새 Medusa: 응답 code 가 같아 `NOT_CANCELABLE` 로 닫히고 사유 문장이 보인다. 금액 칸만 아직 못 쓴다.
   - 새 core + 옛 channel-adapter: 계약 zod 는 모르는 칸을 버린다(strict 아님) → Medusa 는 칸이 없다고 보고 다시 거절. 이중 환불
     쪽으로 열리지 않는다.
   - 새 channel-adapter + 옛 Medusa: 옛 `parse-input` 이 `already_refunded` 를 무시하고 판정 없이 돈다 — 지금과 같다(나빠지지 않는다).
   - **새 channel-adapter + 옛 core: 새 enum 값을 옛 core 의 zod 가 throw 한다.** core 를 먼저 배포한다(§11).
3. **크레딧 라인은 넣었는데 환불이 실패**: 기록은 `edited`, 크레딧 라인은 있다. 재시도가 크레딧 라인을 `reference_id` 로 건너뛰고
   환불만 낸다. 그 사이 차액은 −(Y−X) 로 «돌려줄 돈 있음»이 맞게 보인다.
4. **크레딧 라인 넣기 실패**(§4.3 확인 항목 포함): 기록이 `edited` 라 지금의 `refund_pending` 과 같이 정체 보드에 «수정됨 · 환불 미완»
   으로 남고 재시도된다. 영구 실패면 사람이 본다 — 로그에 requestId·applied·차액을 남긴다.
5. **같은 외부 환불을 두 요청이 나눠 주장**: U 가 기록의 applied 합을 빼므로 두 번째 요청은 남은 몫까지만 주장할 수 있다. 주문
   잠금이 두 부분취소를 직렬화한다.

## 9. 테스트

- **Medusa 유닛**: `unresolvedExternalRefund`(note 접두어, 옛 기록 applied 없음), 세 갈래 판정(§4.2 표 전부), applied 상한.
- **Medusa 통합** (`integration-tests/http/partial-cancel.spec.ts`, `wallet-refund-projection.spec.ts` 의 투영 픽스처를 쓴다) —
  **구현 계획 첫 태스크**:
  1. 외부 환불 X 투영 → 칸 없이 부분취소 → 400 `reason: external_refund_unresolved`, 주문·장부 변화 없음.
  2. 같은 주문에 `already_refunded: X` → wallet 에 Y−X 한 번, 크레딧 라인 합 = 0(+X, −X), 갚을 차액 0.
     **§4.3 의 `query.graph` 차액이 수정 직후에 맞는지 여기서 판정한다.**
  3. 같은 requestId 재호출 → 음수 라인 하나, 환불 추가 없음.
  4. 배송비 환불이 섞인 부분취소 → 양수 라인이 배송비 환불 몫만큼만 붙고 차액 0.
  5. 외부 환불 없는 주문 → 지금과 같은 결과(회귀).
- **channel-adapter**: 클라이언트의 사유 대응, 매니저의 거절 사실·금액, 진행 기록의 applied.
- **core**: DTO → 명령 실음, 채널·scope 거절, 거절 금액·확정 applied 저장(통합 스펙 `channel-cancel-request.integration.spec.ts`).
- **계약**: 스키마 스펙(전체취소에 금액 거절, 새 enum).
- **admin-web**: `needsAlreadyRefunded`, `cancelRequestLine` 상계 문구.

## 10. 범위 밖 — #1016 에 행으로 (ADR-0043 의 나머지)

1. Medusa 주문의 **금액 조정 경로** — core 요청 → 명령 → Medusa «크레딧 라인 + 환불». 지금은 wallet 관리자 환불뿐이다.
2. core 출고 개통 때 **wallet 관리자 화면의 Medusa 주문 환불 차단**(intent `metadata.medusaSessionId` 로 판별). 개통 체크리스트 항목.
3. **환불 사유 구조화** — «종류 + 메모». wallet `refunds.reason_code` 가 자유 문장이다.
4. **CS 사건과 요청 연결** — 요청(`sales_order_amendments`) 쪽 `cs_case_id`.
5. **네이버·쿠팡 임의 금액 부분환불 지원 확인** — 안 되면 금액 조정은 «주문 밖 보상»으로 간다.
6. 반품의 Medusa 이전 — 기존 34번에 ADR-0043 을 연결만 한다.

## 11. 배포

순서: **core → channel-adapter → Medusa → admin-web**. 지켜야 하는 것은 «core 가 channel-adapter 보다 먼저» 하나다(§8-2). 나머지
순서는 꼬여도 이중 환불 쪽으로 열리지 않는다. 마이그레이션 없음(전부 jsonb·계약 선택 칸). 한 SST 스택이라(메모리
«SST 한 스택엔 배포 순서 없음») core 를 먼저 내려면 core 변경 PR 을 먼저 머지·배포하고 나머지를 다음 배포에 싣는다.

배포 뒤 확인: 외부 환불이 있는 미출고 Medusa 주문이 생기기 전까지는 라이브에서 이 경로가 돌 일이 없다(§1.3). 개통 체크리스트에
«외부 환불 주문 부분취소 한 번 — 거절 → 금액 입력 → 상계 환불» 스모크를 넣는다.
