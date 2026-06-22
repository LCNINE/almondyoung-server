# 무통장입금 전용 상태 `AWAITING_DEPOSIT` 도입 설계

- 날짜: 2026-06-22
- 상태: 설계 합의 완료 (구현 전)
- 관련 도메인: `apps/wallet` (payment-intents 상태머신/만료), `apps/medusa` (almond-payment provider), `apps/admin-web`, `apps/wallet-web`

## 1. 배경 / 문제

무통장입금(BANK_TRANSFER)은 PG가 없어 `authorize()`가 `REQUIRES_ACTION`(계좌 안내)으로 멈추고, 관리자가 admin-web에서 "입금 확인"을 눌러야 결제가 확정된다. 확정 신호는
`confirmDeposit → intent CAPTURED → outbox(payment.intent.captured) → Kafka → channel-adapter → Medusa /hooks/payment-events → recoverBankTransferOrder(completeCartWorkflow) → capturePaymentWorkflow`
로 전달된다.

### 직접 원인 (P0)

이전에 **Toss 결제창을 켠 채 닫아버리면 적립금(POINTS) hold가 intent 만료(24h)까지 풀리지 않는** 문제를 해결하려고, `REQUIRES_ACTION` intent에 짧은 `actionExpiresAt`(기본 15분)을 찍고(`confirm.service.ts` `stampActionExpiry`, 라인 396 무조건 호출) `TossActionExpirationJob`(5분 cron)이 이를 abandon(soft-reset → CREATED, hold 해제)하도록 했다.

그런데 이 로직이 **프로바이더 구분 없이 모든 `REQUIRES_ACTION`에 적용**되어, 무통장 intent도 15분 뒤 abandon된다. 실제 계좌이체는 수 시간~익일이 걸리므로:

- 약 15~20분 내 intent가 CREATED로 리셋 + AUTHORIZE charge 해제
- `getPendingTransfers`(status=REQUIRES_ACTION 필터)에서 사라져 **admin이 확인할 대상조차 없어짐**
- 뒤늦게 confirm 시도해도 `confirmDeposit`이 REQUIRES_ACTION AUTHORIZE charge를 못 찾아 `NO_REQUIRES_ACTION_CHARGE` throw
- 2차 천장으로 `ExpirationJob`(24h, `expiresAt`)이 REQUIRES_ACTION을 CANCEL

→ **고객은 입금했는데 주문은 영원히 생성 불가.** 운영에서 무통장 기능이 사실상 붕괴.

### 근본 원인

`REQUIRES_ACTION` 한 상태가 의미가 전혀 다른 두 경우를 함께 표현하고 있다:

| | REQUIRES_ACTION (Toss 등) | 무통장 입금 대기 |
|---|---|---|
| 의미 | 외부 인터랙티브 리다이렉트 진행 중 | 오프라인 입금을 기다림 |
| 정상 소요 | 수십 초~분 | 수 시간~수일 |
| 방치 시 | 빨리 reclaim(hold 해제) | 윈도우(예: 72h)까지 유지 |
| 완료 신호 | Toss 콜백/웹훅 | admin 수동 확인 |

만료/취소/재시도 의미가 달라, 잡 로직이 매번 둘을 구분해야 하는 부담이 생긴다. **상태로 분리**해 그 구분을 상태머신에 한 번 박는다.

## 2. 목표 / 비목표

### 목표
- 무통장 입금 대기 intent를 Toss 액션 만료(15분)에서 분리해 **72h 입금 윈도우** 동안 살아있게 한다.
- 윈도우 경과 시 자동 CANCEL + 적립금 hold 해제 (원래의 누수 해결을 무통장에도 적절한 타임스케일로 적용).
- Toss abandon 로직(원래 P0를 만든 수정)은 **그대로 보존**.
- Medusa 완료 신호 체인은 변경 없이 유지.

### 비목표 (이번 PR 범위 밖)
- **P1**: 입금 대기 동안 재고 미예약 → confirm 시점 `completeCartWorkflow` 실패 가능성 / 보상 경로 부재. (별도 과제)
- **P2**: wallet-web 입금 대기 화면이 storefront로 복귀하지 않는 UX 막다른 길. (별도 과제)
- 무통장의 입금 *자동* 감지(가상계좌 PG 연동). 본 설계는 수동 확인 전제.

## 3. 결정 사항

- **입금 윈도우 기본값: 72시간** (env `WALLET_BANK_TRANSFER_DEPOSIT_WINDOW_HOURS`, 미설정 시 72). 금요일 저녁 주문 → 월요일 입금을 커버. 영업일 캘린더 방식은 공휴일 소스가 필요해 YAGNI로 보류(만료 계산식만 교체하면 추후 승급 가능).
- **컷오버**: admin `getPendingTransfers`는 한 배포 주기 동안 `status IN ('AWAITING_DEPOSIT','REQUIRES_ACTION')` 둘 다 노출.
- **새 상태는 intent 레벨에만 추가.** charge는 기존대로 `REQUIRES_ACTION` 유지(charge 의미 불변, 변경 면적 최소화).

## 4. 설계

### 4.1 상태머신 (`apps/wallet/src/domain/state-transition/state-transition.rules.ts`)

```
PROCESSING:        [..., 'AWAITING_DEPOSIT']               // 추가
AWAITING_DEPOSIT:  ['AUTHORIZED', 'CANCELED', 'FAILED']    // 신규
```

`REQUIRES_ACTION: [...]`는 **그대로 유지** → 배포 시점에 떠있던 구 REQUIRES_ACTION 무통장 건도 `confirmDeposit`(→ AUTHORIZED)이 계속 처리 가능(하위호환).

### 4.2 enum / 마이그레이션 (`apps/wallet/src/schema.ts`)

`paymentIntentStatusEnum`에 `'AWAITING_DEPOSIT'` 추가.

```
npm run db:generate:wallet -- --name add-awaiting-deposit-status
```

- additive enum 값 = expand 단계 → **단일 PR 허용**(ADR-0005).
- Postgres `ALTER TYPE payment_intent_status ADD VALUE 'AWAITING_DEPOSIT'`는 단독 statement로 적용(생성된 SQL 검토).

### 4.3 프로바이더 의미 선언 + confirm 분기

`PaymentProvider` 인터페이스(`apps/wallet/src/providers/payment-provider.interface.ts`)에 추가:

```ts
readonly actionMode: 'interactive' | 'offline-wait';
```

- `BankTransferPaymentProvider.actionMode = 'offline-wait'`
- Toss 등 나머지 = `'interactive'` (기본/명시)

`confirm.service.ts` `handlePrimaryResult`의 `REQUIRES_ACTION` 분기를 `plan.primary.provider.actionMode`로 라우팅:

- `interactive` → (변경 없음) charge=REQUIRES_ACTION, intent=REQUIRES_ACTION, `stampActionExpiry()`(15분)
- `offline-wait` → charge=REQUIRES_ACTION(동일), **intent=AWAITING_DEPOSIT로 전이**, `stampDepositExpiry()` 호출(`expiresAt = now + 윈도우`), **`stampActionExpiry()` 호출 안 함**

신규 헬퍼 `stampDepositExpiry(intentId)` — `stampActionExpiry`와 대칭. 윈도우는 env에서 읽음(`actionTtlMs` 패턴 미러).

### 4.4 만료 잡

- `ExpirationJob`(`apps/wallet/src/jobs/expiration.job.ts`): scan 상태 목록에 `'AWAITING_DEPOSIT'` 추가. `expiresAt`(72h) 도달 시 기존 경로 그대로 — `releaseIntentCharges()`(적립금 hold 해제) + `transitionIntent('CANCELED')`.
- `TossActionExpirationJob`: **무변경**. AWAITING_DEPOSIT은 `actionExpiresAt`이 NULL이라 `lte(actionExpiresAt, now)`(NULL 제외)에서 자동으로 빠진다.

### 4.5 admin / confirmDeposit (`apps/wallet/src/admin/bank-transfer-admin.service.ts`)

- `getPendingTransfers`: intent 상태 필터 `eq(status,'REQUIRES_ACTION')` → `inArray(status, ['AWAITING_DEPOSIT','REQUIRES_ACTION'])`. charge 조인(REQUIRES_ACTION AUTHORIZE)·nextAction 스냅샷 읽기는 그대로.
- `confirmDeposit`: 전이 소스가 AWAITING_DEPOSIT가 됨. charge 조회(REQUIRES_ACTION)·흐름(→ AUTHORIZED → CAPTURED + outbox `payment.intent.captured`)은 동일. 구 REQUIRES_ACTION 건은 4.1 호환 규칙으로 동일하게 처리.

### 4.6 Medusa (`apps/medusa/src/modules/almond-payment/service.ts`)

`mapStatus`에 `case 'AWAITING_DEPOSIT': return 'pending';` 명시 추가(기본 default도 pending이지만 의도 명시). 완료 신호는 capture 이벤트가 트리거하므로 **그 외 변경 없음**.

### 4.7 wallet-web (`apps/wallet-web/app/pay/[intentId]/pay-form.tsx`)

계좌 안내 화면 분기를 intent `status`가 아니라 **nextAction 타입(`BANK_TRANSFER_PENDING`)** 기준으로 변경:

```ts
// before: result.status === 'REQUIRES_ACTION' && isBankTransferPendingAction(result.nextAction)
// after : isBankTransferPendingAction(result.nextAction)
```

confirm 응답 `status`는 intent 상태(`AWAITING_DEPOSIT`)를 그대로 싣게 되므로, 상태에 의존하지 않고 nextAction으로 판별해야 한다.

## 5. 데이터 흐름 (변경 후, 무통장)

```
storefront initiatePaymentSession → wallet 무통장 선택/confirm
  → BankTransferProvider.authorize() = REQUIRES_ACTION(BANK_TRANSFER_PENDING)
  → handlePrimaryResult: charge=REQUIRES_ACTION, intent=AWAITING_DEPOSIT, expiresAt=now+72h
  → wallet-web: nextAction=BANK_TRANSFER_PENDING → 계좌 안내 화면
  ┌─ (정상) admin "입금 확인" → AWAITING_DEPOSIT → AUTHORIZED → CAPTURED
  │     → outbox payment.intent.captured → … → Medusa 주문 생성 + 캡처
  └─ (미입금) 72h 경과 → ExpirationJob → releaseIntentCharges(POINTS hold 해제) + CANCELED
```

## 6. 영향 파일

| 파일 | 변경 |
|---|---|
| `apps/wallet/src/schema.ts` | enum `AWAITING_DEPOSIT` 추가 (+ 마이그레이션) |
| `apps/wallet/src/domain/state-transition/state-transition.rules.ts` | PROCESSING 타깃 추가, AWAITING_DEPOSIT 규칙 신설 |
| `apps/wallet/src/providers/payment-provider.interface.ts` | `actionMode` 추가 |
| `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.ts` | `actionMode='offline-wait'` |
| (그 외 프로바이더) | `actionMode='interactive'` 명시 |
| `apps/wallet/src/payment-intents/confirm.service.ts` | `handlePrimaryResult` 분기, `stampDepositExpiry` 헬퍼, 윈도우 env |
| `apps/wallet/src/jobs/expiration.job.ts` | scan 목록에 AWAITING_DEPOSIT 추가 |
| `apps/wallet/src/admin/bank-transfer-admin.service.ts` | 목록 필터(두 상태), confirm 소스 상태 |
| `apps/medusa/src/modules/almond-payment/service.ts` | `mapStatus` AWAITING_DEPOSIT → pending |
| `apps/wallet-web/app/pay/[intentId]/pay-form.tsx` | nextAction 기준 분기 |

## 7. 하위호환 / 컷오버

- 구 in-flight 무통장 REQUIRES_ACTION 건은 (현 버그로) 15분 내 abandon되어 사실상 없음.
- 그래도 안전망: (a) `REQUIRES_ACTION → AUTHORIZED` 규칙 유지, (b) admin 목록 두 상태 수용 → 혹시 남은 구 건도 확인 가능.
- 한 배포 주기 후 별도 PR에서 admin 필터를 `AWAITING_DEPOSIT` 단독으로 좁히는 정리 가능(선택).

## 8. 테스트 (red-green)

- 상태머신: `PROCESSING→AWAITING_DEPOSIT`, `AWAITING_DEPOSIT→AUTHORIZED/CANCELED/FAILED` 허용, 그 외 금지 전이 거부.
- confirm: `offline-wait` 프로바이더 결과가 intent=AWAITING_DEPOSIT + `expiresAt≈now+72h` + `actionExpiresAt` 미설정. `interactive`는 기존(REQUIRES_ACTION + actionExpiresAt) 유지.
- `TossActionExpirationJob.spec`: AWAITING_DEPOSIT(actionExpiresAt NULL)를 reclaim하지 않음 케이스 추가.
- `ExpirationJob`: 72h 경과 AWAITING_DEPOSIT을 release(hold 해제)+CANCEL.
- 적립금 합산 무통장: 만료 시 POINTS hold가 해제됨.
- confirmDeposit: AWAITING_DEPOSIT 및 (호환) REQUIRES_ACTION 모두에서 CAPTURED + outbox 발행.

## 9. 리스크 / 확인 필요

- cancel/abandon 경로 (구현 계획에서 해소됨):
  - **명시적 cancel**: `payment-intents.service.ts`의 `cancelableStatuses`에 `AWAITING_DEPOSIT`를 **추가해야 함**(현재 미포함 → `INTENT_NOT_CANCELABLE`로 막힘, Medusa는 no-op로 삼켜 적립금 hold 잔류). 계획 Task 6.
  - **만료 cancel**: `ExpirationJob`은 `stateTransitionService`를 직접 호출해 위 가드를 우회 → 상태 규칙(AWAITING_DEPOSIT→CANCELED)만 있으면 동작.
  - **abandon**: `AbandonService.ABANDONABLE = ['REQUIRES_ACTION','PROCESSING']` 그대로 둬 AWAITING_DEPOSIT를 **의도적으로 제외**(입금 대기는 soft-reset 대상이 아님).
- `mapStatus` 기본 default가 이미 pending이라 명시 추가는 가독성 목적.
- 멀티 인스턴스 잡 중복 실행 시 동시성 — 기존 잡과 동일한 락/멱등 전제 그대로(신규 리스크 없음).
