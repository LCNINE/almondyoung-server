# 채널 주문 취소의 wallet 환불 거절 — 사유를 붙이고 보류는 유지한다 (#1016 36번 행)

> 상위 설계: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md`(35번 행, 이하 «35번 스펙») §7.2 의 후속.
> ADR: `docs/adr/0042-channel-order-cancel-is-initiated-by-the-channel.md`.
> 사용자 결정 2026-10-10. 기준 커밋 develop `bc6ea2df1`.

## 1. 문제

채널(Medusa) 주문의 취소는 core 가 요청을 기록하고 출고를 보류한 뒤 `CancelChannelOrder` 명령을 내고, channel-adapter 가
Medusa 를 불러 실행한다(35번 스펙 §4). Medusa 안에서 환불은 `almond-payment.refundPayment` → wallet 이다.

wallet 이 환불을 **영구히** 거절하면(400) 지금은 이렇게 된다.

1. `walletFetch` 가 `"CODE: message"` 문장을 가진 평범한 `Error` 를 던진다(`apps/medusa/src/modules/almond-payment/service.ts`).
2. **전체취소**: Medusa `cancelOrderWorkflow` 가 롤백되고, Medusa 에러 핸들러가 MedusaError 가 아닌 오류를
   **500 `unknown_error`** 로 가린다(`@medusajs/framework` `error-handler.js`, 2.13.4). channel-adapter 는 이것을 일시
   실패로 보고 재시도 → DLQ. core 의 요청은 `requested` 로 남아 5분 뒤 정체 보드 «취소 요청 미반영»에 **사유 없이** 뜬다.
3. **부분취소**: 주문 수정은 이미 확정됐고 환불만 실패한다. 라우트는 원인과 무관하게 502 `refund_pending` 을 내고,
   channel-adapter 는 `ChannelOrderCancelStalled` 를 낸 뒤 재시도 → DLQ. 사유 문장은 사실의 `message` 에 실리지만 core 의
   `markStalled` 가 버린다. 보드엔 «수정됨 · 환불 미완»만 보인다.

`ChannelOrderCancelRejected` 의 `REFUND_FAILED` 는 계약(`packages/event-contracts/streams/orders.stream.ts`)과 admin-web
문구에만 있고 아무도 내지 않는다.

### 1.1 «환불 불가»와 «장부 불일치»는 다른 일이다

35번 스펙은 `REFUND_AMOUNT_EXCEEDS_*` 를 «환불 불가»로 묶었다. 그러나 `EXCEEDS_*` 는 대개 **wallet 이 이미 환불했는데
Medusa 장부가 모른다**는 뜻이다.

- 환불 응답 유실 — wallet 은 환불했는데 Medusa 는 실패로 보고 refund 행을 지운다. 재시도는 새 refund 행 id 라 멱등 키
  (`medusa-refund:<refund id>`)가 달라져 `EXCEEDS_TOTAL` 이 된다.
- 결제분이 여럿일 때 앞 leg 만 나감(`judgeWalletRefund` 의 `moved`) — 그 환불은 `reasonCode=MEDUSA_REFUND` 라 투영도
  건너뛴다(`api/hooks/payment-events/classify-wallet-refund.ts`). 재시도는 `EXCEEDS_TOTAL`.
- Medusa 장부에 투영되지 않은 외부 환불(37번 행과 같은 뿌리).

이것을 «환불 불가»로 보이면 운영자는 «고객이 돈을 못 받았다»로 읽고 수동으로 또 환불한다 — **이중 환불로 이끄는 문구**다.
core 의 `wallet-refund.client.ts` 도 같은 코드를 «이미 환불됨»으로 읽는다.

### 1.2 거절로 닫으면 보류가 풀린다

35번 스펙 §5.5 대로 `REFUND_FAILED` 를 종결 사실로 받으면 core 는 요청을 `rejected` 로 닫고 출고 보류를 푼다. 정체 보드는
`status = 'requested'` 만 «취소 요청» 단계로 잡으므로(`order-progress.judge-sql.ts` creq) 그 주문은 보드에서도 사라진다.
고객·wallet 환불 승인 요청은 아무도 주문 상세를 보지 않는다. 결과: **고객이 취소한 주문이 조용히 출고로 돌아간다.**
장부 불일치(wallet 환불 승인 경로에서 투영이 빠진 경우 등)라면 **돈은 돌려줬는데 물건도 나간다.**

지금(재시도 → DLQ)은 사유가 없을 뿐 보류는 유지된다. 사유를 붙이면서 그 안전장치를 잃지 않아야 한다.

`REFUND_FAILED` 는 «채널이 취소를 거부했다»(`NOT_CANCELABLE`)가 아니라 «취소 의사는 유효한데 자동으로 끝낼 수 없다»다.
두 갈래 모두 지금은 «취소 완료» 출구가 없다 — Medusa 취소 워크플로는 결제된 몫을 무조건 다시 환불하려 해서 다시 보내도
같은 거절이 난다.

## 2. 목표와 성공 기준

1. wallet 의 영구 거절은 **사유와 갈래(환불 불가 / 장부 불일치)** 와 함께 정체 보드와 주문 상세에 보인다 — 전체취소·부분취소 모두
2. 그 동안 **출고 보류는 유지된다.** 출고 재개는 운영자가 [요청 접기]로 정한다
3. 장부 불일치는 «다시 환불하지 말 것»을 명시한다
4. 일시 실패(5xx·네트워크·PG 거절)는 지금처럼 재시도한다
5. 롤링 중 어떤 버전 조합도 지금보다 나빠지지 않는다(§8)
6. `npm run type-check` 0 · `npx jest` 0 · admin-web `tsc --noEmit` 0 · Medusa 통합 스펙 초록 · 로컬 스모크 3건 통과

## 3. 결정 (사용자 결정 2026-10-10)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| E1 | 분류를 어디서 하나 | **Medusa almond-payment 한 곳.** wallet 어휘(`INTENT_NOT_CANCELABLE` 분기)를 이미 아는 곳이고, 전체·부분취소가 같은 분류를 쓴다 | channel-adapter 에서: wallet 코드 어휘가 두 서비스에 퍼진다 |
| E2 | 계약 | **`REFUND_FAILED` + optional `refundFailure` 필드.** enum 은 늘리지 않는다 | 새 reasonCode(`REFUND_LEDGER_MISMATCH`): 소비자 zod 가 모르는 값을 거부해 소비자 선배포가 필요한데 한 SST 스택이라 순서를 보장할 수 없다 |
| E3 | 갈래 | **환불 불가 / 장부 불일치 둘**(§4.1) | 하나로 «환불 불가»: §1.1 |
| E4 | core 처리 | **`REFUND_FAILED` 면 요청을 열어 둔 채 보류 유지 + 보드 상태** | 계약대로 닫고 주문 상세에만 사유: §1.2 |
| E5 | 부분취소 | **사유 표시까지.** 재시도·DLQ 동작은 그대로 | 부분취소 출구(재시도 중단·수동 환불 뒤 완료 처리): 결정할 것이 늘어 별도 일 |
| E6 | 장부를 맞추는 도구 | **범위 밖.** 이 스펙은 «대사 필요, 다시 환불 금지»를 보이는 데까지 | 37번의 «이미 환불한 금액»은 Medusa 장부에 투영된 외부 환불까지만 받아(`checkAlreadyRefunded`) 투영 안 된 환불의 출구가 되지 못한다 |
| E7 | 스토어프론트 | **바꾸지 않는다.** 요청이 열려 있으니 고객에겐 «취소 처리 중» | 고객 안내 문구 추가: 운영자가 보드에서 보고 연락하는 것으로 갈음 |

## 4. Medusa — almond-payment

### 4.1 분류 — «wallet 이 돈을 어떻게 보는가»

| 갈래 `kind` | wallet `error` 코드 | 뜻 | 운영자에게 |
| --- | --- | --- | --- |
| `refused` (환불 불가) | `REFUND_NOT_AUTOMATABLE`, `MEMBERSHIP_REFUND_NOT_ALLOWED` | 돈은 있는데 자동으로 못 돌려준다 | 다른 수단으로 환불해야 한다 |
| `ledger_mismatch` (장부 불일치) | `REFUND_AMOUNT_EXCEEDS_TOTAL`, `REFUND_AMOUNT_EXCEEDS_AVAILABLE`, `REFUND_AMOUNT_EXCEEDS_CHARGE`, `CHARGE_NOT_REFUNDABLE`, `REFUNDABLE_CHARGE_NOT_FOUND` | wallet 이 Medusa 생각보다 돌려줄 돈이 적다 | 이미 환불됐을 수 있다 — 다시 환불하지 말고 wallet 환불 내역과 대조 |
| (분류 없음 — 일시 실패) | 그 밖의 전부: 5xx·네트워크·코드 없는 응답·PG 거절(200 + FAILED 행, `judgeWalletRefund`) | 다시 하면 될 수 있다 | 지금처럼 재시도 |

- `CHARGE_NOT_REFUNDABLE` 은 35번 스펙과 #1016 36번 행 본문이 «환불 불가»로 적었으나 **장부 불일치**로 옮긴다. Medusa 가 타는
  intent 환불 경로(`refunds.service.ts` `createByIntent` → `planIntentRefund` → `create`)에서는 SUCCEEDED 결제분을 고른
  뒤 상태가 바뀔 때, 곧 **누가 동시에 환불했을 때만** 난다.
- `REFUNDABLE_CHARGE_NOT_FOUND` 는 404 다. 환불할 SUCCEEDED 결제분이 없고 성공 환불 합도 요청액에 못 미친다는 뜻이라
  장부 불일치다. 판정은 상태 코드가 아니라 본문 `error` 로 한다(본문 없는 404 는 분류 없음 → 재시도).
- `MEMBERSHIP_REFUND_NOT_ALLOWED` 는 멤버십 fee intent 전용이라 Medusa 주문에선 닿지 않지만 영구 거절이라 넣어 둔다.
- 분류는 순수 함수 `classifyWalletRefundRefusal(code: string | undefined): 'refused' | 'ledger_mismatch' | null` 하나가 한다.

### 4.2 wallet 오류를 구조로

`walletFetch` 가 `WalletHttpError extends Error { status, walletCode?, walletMessage }` 를 던진다. 속성 이름을 `code` 로
두지 않는다 — Medusa `formatException` 이 `err.code` 를 Postgres 오류 코드로 읽고, 에러 핸들러가 `code` 를 응답에 싣는다. `message` 는 지금과 같은
`"CODE: message"` 라 기존 `msg.includes('INTENT_NOT_CANCELABLE')` 분기(`authorizePayment`·`cancelPayment`·`updatePayment`)는
그대로 돈다.

### 4.3 `refundPayment`

wallet 호출이 `WalletHttpError` 로 실패하고 `classifyWalletRefundRefusal(err.walletCode)` 가 갈래를 주면:

```ts
throw new MedusaError(
  MedusaError.Types.NOT_ALLOWED,
  `<갈래별 한국어 문장> (wallet ${err.walletCode}: ${err.walletMessage})`,
  `wallet_refund_${kind}:${err.walletCode}`, // 예: wallet_refund_ledger_mismatch:REFUND_AMOUNT_EXCEEDS_TOTAL
);
```

갈래 문장:
- `refused`: «wallet 이 이 결제를 자동으로 환불할 수 없습니다 — 다른 수단으로 환불해야 합니다»
- `ledger_mismatch`: «wallet 에 Medusa 장부에 없는 환불이 있습니다 — 이미 환불됐을 수 있으니 다시 환불하지 말고 wallet 환불 내역을 대조하세요»

분류가 없으면 지금처럼 원래 오류를 던진다. `judgeWalletRefund` 실패(200 + FAILED)도 지금 그대로다.

**전파 경로(2.13.4 소스로 확인, 통합 스펙이 실증한다 — §9):** 결제 모듈 `refundPayment` 는 refund 행을 지우고 오류를 다시
던진다 → 워크플로 엔진 `setStepFailure` 가 `serializeError` 로 직렬화하는데 오류의 자체 속성(`type`·`code`)을 보존한다 →
`workflow.run` 이 첫 오류를 던진다 → 에러 핸들러가 `type: not_allowed` 를 400 으로, `code` 를 그대로 응답에 싣는다.
응답 본문은 `{ type, code, message }` 뿐이라 **표지는 `code` 에 싣는다**(37번 부분취소의 `reason` 필드는 커스텀 라우트라 가능했다).

### 4.4 부분취소 라우트

`partial-cancel-order.ts` 의 환불 단계 `catch` 가 잡은 오류의 `code` 를 읽어 `PartialCancelRefundPending` 에
`refundFailure?: { kind, walletCode }` 를 품는다. 직렬화된 오류는 클래스가 아니라 평범한 객체라 `instanceof` 가 아니라 `code`
문자열로 본다 — 표지를 만든 almond-payment 옆에 짝 함수 `readRefundFailureCode` 를 둔다(§5.2 와 같은 정규식). 라우트는 502 `refund_pending` 본문에 `refundFailure` 를 덧붙인다.
상태 코드·재시도 동작은 그대로다.

### 4.5 곁효과

Medusa 관리자 환불(`api/admin/payments/[id]/refund/route.ts`)도 같은 `refundPayment` 를 쓴다 — «An unknown error occurred»(500)
이던 것이 읽을 수 있는 400 이 된다. 이 라우트를 부르는 우리 서비스는 없다(grep).

## 5. 계약 · channel-adapter

### 5.1 계약 (`packages/event-contracts/streams/orders.stream.ts`)

```ts
export const REFUND_FAILURE_KINDS = ['refused', 'ledger_mismatch'] as const;
export interface ChannelOrderCancelRefundFailure {
  kind: (typeof REFUND_FAILURE_KINDS)[number];
  /** wallet 의 error 코드 그대로 — 화면·대사용 */
  walletCode: string;
}
```

- `ChannelOrderCancelRejectedPayload.refundFailure?` — **`reasonCode === 'REFUND_FAILED'` 이면 필수**(zod `superRefine`).
  지금 `REFUND_FAILED` 생산자가 없어 이 제약은 아무것도 깨지 않는다.
- `ChannelOrderCancelStalledPayload.refundFailure?` — 분류된 거절로 멈췄을 때만.
- 옛 소비자는 안전하다: 계약 스키마는 `z.object`(strict 아님)이고 `@app/events` 는 `safeParse` 결과를 넘긴다
  (`libs/events/src/validation/schema-validation.util.ts`) — 모르는 필드는 떼어지고 던지지 않는다.
- `REFUND_FAILED` 주석을 고친다: «아직 아무도 내지 않는다» 삭제, «종결 사실의 예외 — core 는 요청을 열어 둔 채 보류를 유지한다(§6)».

### 5.2 표지 파서

channel-adapter 에 순수 함수 둘:
- `parseRefundFailureCode(code: unknown): ChannelOrderCancelRefundFailure | null` — 전체취소 400 의 `code` 문자열,
  `/^wallet_refund_(refused|ledger_mismatch):(.+)$/`
- `readRefundFailure(value: unknown): ChannelOrderCancelRefundFailure | null` — 부분취소 502 본문의 `refundFailure` 객체

Medusa 도 같은 정규식을 쓰지만(§4.4) 공유 패키지로 묶지 않는다 — `@packages` 별칭은 medusa 런타임에서 풀리지 않는다.
양쪽 스펙이 같은 예시 값(`wallet_refund_ledger_mismatch:REFUND_AMOUNT_EXCEEDS_TOTAL`)을 써서 어긋남을 잡는다.

### 5.3 전체취소 — `medusa.client.ts` `cancelOrder`

400 판정 순서:

1. `parseRefundFailureCode(body.code)` 가 값을 주면 `{ kind: 'refund_refused', message, refundFailure }`
2. «이미 취소됨» 문구(`ALREADY_CANCELLED_MESSAGE`) → `already_cancelled` (지금 그대로)
3. 나머지 → `not_cancelable` (지금 그대로)

접두어는 맞는데 갈래를 모르는 값은 1 에서 null 이라 3 으로 떨어져 문장과 함께 거절로 닫힌다 — 재시도 루프는 생기지 않는다.
`ChannelOrderCancelManager.cancelFull` 은 `refund_refused` → `{ reasonCode: 'REFUND_FAILED', message, refundFailure }`.

### 5.4 부분취소 — `partialCancelOrder`

502 `refund_pending` 본문의 `refundFailure` 를 `readRefundFailure` 로 읽어 outcome 에 싣고, `recordStalled` 사실에 실은 뒤 **지금처럼 던져 재시도한다.**

**정체 사실의 멱등 키를 바꾼다.** 지금 `cancel-stalled:${requestId}:${deliveryId}` 는 첫 시도가 일시 실패로 멈추고 재시도가
영구 거절을 만나면 같은 키라 사유 실린 두 번째 사실을 버린다. `refundFailure` 가 있을 때만 키 끝에 `:${walletCode}` 를
붙인다 — 사유가 바뀔 때만 새 사실이 나가고, 사유 없는 사실의 키는 지금 그대로라 배포 전후 아웃박스 행과 겹치지 않는다.

## 6. core

### 6.1 사실 받기 (`channel-cancel-request.manager.ts`)

- **`ChannelOrderCancelRejected` + `REFUND_FAILED`** → 닫지 않는다. 새 `markRefundFailed(fact)`: 요청 행이 `requested` 일 때만,
  `requested` 그대로 두고 `metadata.request.refundFailure = { kind, walletCode, message, at }` 를 적는다. 보류는 행 상태가 곧
  보류라 따로 할 일 없다. 다른 reasonCode 는 지금처럼 `reject`.
- **`ChannelOrderCancelStalled`** → 지금은 `stage === 'edited'` 면 바로 끝낸다. 바꾼다: 들어온 `refundFailure` 가 있고 저장된 것과
  `walletCode` 가 다르면 함께 적는다. `refundFailure` 없는 사실은 저장된 값을 지우지 않는다(일시 실패 한 번이 영구 거절이
  풀렸다는 증거가 아니다).
- **[다시 보내기]**(`resend`) → `refundFailure` 를 지우고 명령을 다시 낸다. 그동안은 «처리 중», 다시 거절되면 다시 붙는다.
- **[요청 접기]**(`withdraw`) → 지금 그대로(`OPERATOR_WITHDRAWN` 으로 닫고 보류 해제).
- 컨슈머(`order-events.consumer.ts` `handleChannelOrderCancelRejected`)는 분기를 manager 에 맡긴다 — 컨슈머에 reasonCode 분기를 두지 않는다.

### 6.2 메타데이터 스키마 (`channel-cancel-request.types.ts`)

`CancelRequestMetadataSchema.request` 에 `refundFailure: z.object({ kind: z.enum(REFUND_FAILURE_KINDS), walletCode, message, at }).optional()`.
**필수다** — 스키마가 strict 가 아니라, 빠지면 다음 read-modify-write(`resend`·`markStalled`·`write`)에서 값이 조용히 떨어진다.
`CancelRequestView` 에 `refundFailure: {...} | null`.

### 6.3 정체 보드 (`fulfillment/order-progress`)

`order-progress.judge-sql.ts` creq CASE — `refundFailure` 를 `edited` 보다 **먼저** 본다:

```sql
CASE a.metadata->'request'->'refundFailure'->>'kind'
  WHEN 'refused'         THEN 'cancel_refund_refused'
  WHEN 'ledger_mismatch' THEN 'cancel_refund_mismatch'
  ELSE CASE WHEN a.metadata->'request'->>'stage' = 'edited' THEN 'cancel_edited' ELSE 'cancel_requested' END
END
```

`order-progress.thresholds.ts` `cancel_request` 상태 목록에 둘을 더한다. 갇힘 기준(단계 체류 5분)은 그대로. `state` 는
`varchar(64)` 라 **마이그레이션이 없다.** 보드에 이미 [다시 보내기]·[요청 접기]가 있다(`stall-board/components/stage-orders.tsx`).

## 7. admin-web

판정은 순수 함수에 두고 스펙으로 지킨다(컴포넌트 테스트 불가).

- `order-progress.shape.ts` `stateLabel`: `cancel_refund_refused` → «취소 · 환불 불가», `cancel_refund_mismatch` → «취소 · 장부 불일치»
- `cancel-request.shape.ts`: `CancelRequestView.refundFailure` 정형(`refundFailureOf`), 요청 중 문구를 갈래별로:
  - 환불 불가: «환불 불가 · 다른 수단으로 환불 필요 · <message>»
  - 장부 불일치: «장부 불일치 · 다시 환불하지 마세요 · wallet 환불 내역 대조 · <message>»
- `REJECTION_LABELS.REFUND_FAILED` 는 남긴다(닫힌 옛 행·혹시 모를 종결 경로 표시용).

## 8. 배포 — 받는 쪽부터 세 PR

한 SST 스택이라 배포 순서는 통제할 수 없다(`sst-single-stack-no-deploy-order`). **머지 순서**를 받는 쪽부터로 해 어느 PR 까지만
배포돼도 혼자 안전하게 한다.

1. **계약 + core + admin-web** — 아무도 `REFUND_FAILED` 를 안 내니 휴면
2. **channel-adapter** — Medusa 가 표지를 안 붙이니 휴면
3. **Medusa** — 켜진다

롤링 중 섞이는 조합:

| 조합 | 결과 |
| --- | --- |
| 새 Medusa + 옛 channel-adapter | 표지 붙은 400 을 `NOT_CANCELABLE` 로 닫는다(§1.2 의 나쁜 동작). 1→2→3 머지면 생기지 않는다 |
| 새 channel-adapter + 옛 core | `refundFailure` 가 떼이고 `REFUND_FAILED` 로 닫힌다. 1 이 먼저면 생기지 않는다 |
| 그 밖 | 지금 동작(500 → 재시도) |

마이그레이션 없음. 배포 전 대기 마이그레이션 대조는 평소대로(남이 머지한 마이그도 함께 실린다).

## 9. 테스트

**Medusa 통합** (`scripts/local/run-medusa-integration.sh`) — §4.3 전파 경로의 실증:
- 전체취소, wallet 스텁 400 `REFUND_NOT_AUTOMATABLE` → HTTP 400, `code = wallet_refund_refused:REFUND_NOT_AUTOMATABLE`, 주문 미취소, refund 행 없음
- 전체취소, 스텁 400 `REFUND_AMOUNT_EXCEEDS_TOTAL` → `wallet_refund_ledger_mismatch:…`
- 전체취소, 스텁 500 → 지금처럼 500
- 부분취소, 기존 픽스처(`partial-cancel-fixture.ts` 의 `EXCEEDS_AVAILABLE`) → 502 본문 `refundFailure.kind = ledger_mismatch`

**Medusa 유닛:** `classifyWalletRefundRefusal` 표 전수 · `refundPayment` 갈래별 throw(타입·code·문장) · `WalletHttpError.message` 가 기존 `includes` 분기를 깨지 않음.

**계약:** `REFUND_FAILED` 인데 `refundFailure` 없음 → 거부 / 다른 reasonCode 에 `refundFailure` 없음 → 통과.

**channel-adapter:** `parseRefundFailureCode` · `cancelOrder` 400 판정 순서(표지 > 이미 취소됨 > not_cancelable, 모르는 갈래) ·
매니저가 내는 `REFUND_FAILED` 사실 · 부분취소 정체 사실에 `refundFailure` · 멱등 키에 `walletCode`.

**core:** `REFUND_FAILED` → `requested` 유지·보류 유지(송장 발급 사전검사가 여전히 막음) · 다른 reasonCode → 지금처럼 닫음 ·
`markStalled` 갱신/비갱신 규칙 · `resend` 가 `refundFailure` 를 지움 · 메타데이터 왕복에서 `refundFailure` 생존 ·
judge SQL 이 두 상태를 냄(통합, `describeIfDb` 가드).

**admin-web:** shape 순수 함수 스펙.

**로컬 스모크** (`bootstrap:e2e:local` → `start:all:local` → `preflight:e2e:local`, 브라우저 로그인은 사람이 한다):

| # | 준비 | 동작 | 기대 |
| --- | --- | --- | --- |
| S1 장부 불일치 · 전체 | 포인트 결제 주문 1건. wallet `POST /v1/payment-intents/:id/refund` 를 `reasonCode: 'MEDUSA_REFUND'` 로 일부 금액 직접 호출(투영이 건너뛰어 Medusa 장부가 모른다) | 어드민 전체취소 | 보드 «취소 · 장부 불일치», 주문 상세 «다시 환불하지 마세요», Medusa 주문 미취소, 송장 발급·배치 시작이 막힘. [요청 접기] → 보류 해제 |
| S2 환불 불가 · 전체 → 출구 | 포인트 결제 주문 1건. 로컬 wallet DB 에서 그 결제수단 `type` 을 `CMS_BATCH`(환불 기능 없음)로 바꿈 | 어드민 전체취소 → 보드 확인 → type 원복 → [다시 보내기] | 보드 «취소 · 환불 불가» → 다시 보내기 뒤 Medusa 취소·환불 완료, core 요청 `applied` |
| S3 장부 불일치 · 부분 | S1 처럼 준비한 주문(품목 2개 이상) | 어드민 부분취소 | 주문 수정 확정, 보드 «취소 · 장부 불일치»(`edited` 보다 우선), DLQ 로 가도 표시 유지 |

라이브 실측은 하지 않는다 — wallet 의 영구 거절을 안전하게 만들 방법이 없다. 배포 뒤엔 두 새 상태가 보드에 0건으로
뜨는지만 본다.

## 10. 하지 않는 것

- 장부를 맞추는 도구(투영 안 된 wallet 환불을 Medusa 장부에 넣기) — E6
- 부분취소의 영구 거절 출구(재시도 중단·완료 처리) — E5
- PG 거절(200 + FAILED)의 사유 표시 — 일시/영구를 wallet 이 구분해 주지 않는다
- 스토어프론트 문구 — E7
- `cancelPaymentStep`(미캡처 결제 취소)에 보상 단계가 없는 것 — Medusa 코어 동작, 이번 변경과 무관

## 11. 마무리

- #1016 36번 행: 해결 칸에 커밋 해시, 문서 칸에 이 스펙 경로. 본문의 코드 목록을 §4.1 로 고친다(`CHARGE_NOT_REFUNDABLE` → 장부 불일치, `REFUND_NOT_AUTOMATABLE` 추가, 보류 유지)
- 35번 스펙 §7.2 의 «`REFUND_FAILED` 는 지금은 내지 않는다» 문단에 이 스펙을 가리키는 한 줄
- 아티팩트 재게시
