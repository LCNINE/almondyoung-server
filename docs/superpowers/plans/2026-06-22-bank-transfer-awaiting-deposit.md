# 무통장입금 `AWAITING_DEPOSIT` 상태 도입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 무통장 입금 대기 intent를 Toss용 15분 action 만료에서 분리해 전용 `AWAITING_DEPOSIT` 상태로 72시간 동안 유지하고, 미입금 시 적립금 hold를 해제하며 CANCEL한다.

**Architecture:** intent 레벨에만 새 상태 `AWAITING_DEPOSIT`를 추가한다(charge는 `REQUIRES_ACTION` 유지). 프로바이더가 `actionMode`('interactive'|'offline-wait')로 자기 액션 의미를 선언하고, confirm 흐름이 그에 따라 짧은 action 만료(Toss) vs 긴 입금 윈도우(무통장)로 라우팅한다. 만료는 기존 `ExpirationJob`(72h 윈도우)이, Toss reclaim은 기존 `TossActionExpirationJob`이 각각 담당한다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), Jest(단위 mock), Medusa(almond-payment provider), Next.js(wallet-web). 참고 설계: `docs/superpowers/specs/2026-06-22-bank-transfer-awaiting-deposit-design.md`.

> **테스트 실행 주의:** 전체 jest 스위트 실행 금지(OOM). 항상 파일 단위로 좁혀 실행한다 — `npx jest <spec 경로> --runInBand`.

---

### Task 1: intent enum에 `AWAITING_DEPOSIT` 추가 + 마이그레이션

**Files:**
- Modify: `apps/wallet/src/schema.ts:23-34` (`paymentIntentStatusEnum`)
- Create: `apps/wallet/drizzle/<timestamp>_add-awaiting-deposit-status.sql` (생성됨)

- [ ] **Step 1: enum 값 추가**

`apps/wallet/src/schema.ts`의 `paymentIntentStatusEnum`에 `'AWAITING_DEPOSIT'`를 추가한다. 위치는 `'REQUIRES_ACTION'` 다음 줄:

```ts
export const paymentIntentStatusEnum = pgEnum('payment_intent_status', [
  'CREATED',
  'PROCESSING',
  'REQUIRES_ACTION',
  'AWAITING_DEPOSIT',
  'AUTHORIZED',
  'CAPTURED',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'PENDING_SETTLEMENT',
  'PARTIALLY_CAPTURED',
]);
```

- [ ] **Step 2: 마이그레이션 생성**

Run:
```bash
npm run db:generate:wallet -- --name add-awaiting-deposit-status
```
Expected: `apps/wallet/drizzle/<timestamp>_add-awaiting-deposit-status.sql`가 생성되고 내용은 `ALTER TYPE "public"."payment_intent_status" ADD VALUE 'AWAITING_DEPOSIT' ...` 한 줄. (enum 값 추가는 additive 라 인터랙티브 rename 프롬프트가 뜨지 않아야 정상)

- [ ] **Step 3: 생성된 SQL 검토**

생성된 `.sql`이 `ADD VALUE`만 포함하는지 확인한다. `DROP TYPE`이나 컬럼 재생성이 보이면 잘못된 것 — `git rm` 후 schema 수정하고 재생성.

- [ ] **Step 4: 컴파일 확인**

Run: `npx tsc --noEmit -p apps/wallet/tsconfig.app.json`
Expected: 타입 에러 없음. (`PaymentIntentStatus` 추론 타입에 `'AWAITING_DEPOSIT'`가 포함됨)

- [ ] **Step 5: Commit (schema + drizzle 한 커밋)**

```bash
git add apps/wallet/src/schema.ts apps/wallet/drizzle
git commit -m "[wallet] payment_intent_status에 AWAITING_DEPOSIT 추가"
```

---

### Task 2: 상태머신에 `AWAITING_DEPOSIT` 전이 규칙 추가

**Files:**
- Modify: `apps/wallet/src/domain/state-transition/state-transition.rules.ts:22-28`
- Create: `apps/wallet/src/domain/state-transition/state-transition.rules.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/wallet/src/domain/state-transition/state-transition.rules.spec.ts`:

```ts
import { canTransition } from './state-transition.rules';

describe('payment intent transition rules — AWAITING_DEPOSIT', () => {
  it('allows PROCESSING → AWAITING_DEPOSIT', () => {
    expect(canTransition('INTENT', 'PROCESSING', 'AWAITING_DEPOSIT')).toBe(true);
  });

  it('allows AWAITING_DEPOSIT → AUTHORIZED / CANCELED / FAILED', () => {
    expect(canTransition('INTENT', 'AWAITING_DEPOSIT', 'AUTHORIZED')).toBe(true);
    expect(canTransition('INTENT', 'AWAITING_DEPOSIT', 'CANCELED')).toBe(true);
    expect(canTransition('INTENT', 'AWAITING_DEPOSIT', 'FAILED')).toBe(true);
  });

  it('denies AWAITING_DEPOSIT → PROCESSING (no soft-reset of a deposit wait)', () => {
    expect(canTransition('INTENT', 'AWAITING_DEPOSIT', 'PROCESSING')).toBe(false);
  });

  it('keeps REQUIRES_ACTION → AUTHORIZED for backward compat', () => {
    expect(canTransition('INTENT', 'REQUIRES_ACTION', 'AUTHORIZED')).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest apps/wallet/src/domain/state-transition/state-transition.rules.spec.ts --runInBand`
Expected: FAIL — `PROCESSING → AWAITING_DEPOSIT`가 `false` (아직 규칙 없음).

- [ ] **Step 3: 규칙 추가**

`apps/wallet/src/domain/state-transition/state-transition.rules.ts`의 `paymentIntentTransitionRules`를 수정한다. `PROCESSING` 줄에 `'AWAITING_DEPOSIT'`를 추가하고, `REQUIRES_ACTION` 줄 아래에 `AWAITING_DEPOSIT` 키를 신설:

```ts
const paymentIntentTransitionRules: TransitionRules<PaymentIntentStatus> = {
  CREATED: ['PROCESSING', 'FAILED', 'CANCELED'],
  PROCESSING: ['AUTHORIZED', 'FAILED', 'REQUIRES_ACTION', 'AWAITING_DEPOSIT', 'PENDING_SETTLEMENT', 'CREATED', 'CANCELED'],
  REQUIRES_ACTION: ['PROCESSING', 'AUTHORIZED', 'FAILED', 'CREATED', 'CANCELED'],
  AWAITING_DEPOSIT: ['AUTHORIZED', 'CANCELED', 'FAILED'],
  PENDING_SETTLEMENT: ['AUTHORIZED', 'FAILED', 'CANCELED'],
  AUTHORIZED: ['CAPTURED', 'PARTIALLY_CAPTURED', 'CANCELED'],
  PARTIALLY_CAPTURED: ['CAPTURED', 'CANCELED'],
  SUCCEEDED: ['CAPTURED', 'CANCELED'], // backward compat: existing SUCCEEDED records
};
```

또한 파일 상단 주석 다이어그램에 한 줄 추가(선택, 가독성):
```
//                      → AWAITING_DEPOSIT → AUTHORIZED (admin 입금확인) | CANCELED (만료/취소)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest apps/wallet/src/domain/state-transition/state-transition.rules.spec.ts --runInBand`
Expected: PASS (4개 모두)

- [ ] **Step 5: Commit**

```bash
git add apps/wallet/src/domain/state-transition/state-transition.rules.ts apps/wallet/src/domain/state-transition/state-transition.rules.spec.ts
git commit -m "[wallet] 상태머신에 AWAITING_DEPOSIT 전이 규칙 추가"
```

---

### Task 3: `PaymentProvider`에 `actionMode` 선언 + 각 프로바이더 설정

**Files:**
- Modify: `apps/wallet/src/providers/payment-provider.interface.ts` (`PaymentProvider` 인터페이스)
- Modify: `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.ts` (`'offline-wait'`)
- Modify: `apps/wallet/src/providers/toss/toss.provider.ts`, `toss/toss-billing.provider.ts`, `nicepay/nicepay.provider.ts`, `nicepay/nicepay-billing.provider.ts`, `points/points.provider.ts` (`'interactive'`)
- Test: `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts`:

```ts
import { BankTransferPaymentProvider } from './bank-transfer.provider';

describe('BankTransferPaymentProvider', () => {
  it('declares offline-wait action mode (deposit is not a short interactive redirect)', () => {
    const provider = new BankTransferPaymentProvider(null as never);
    expect(provider.actionMode).toBe('offline-wait');
    expect(provider.providerType).toBe('BANK_TRANSFER');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts --runInBand`
Expected: FAIL — `provider.actionMode`가 `undefined` (아직 필드 없음).

- [ ] **Step 3: 인터페이스에 필드 추가**

`apps/wallet/src/providers/payment-provider.interface.ts`의 `PaymentProvider` 인터페이스에서 `autoCapture` 아래에 추가:

```ts
export interface PaymentProvider {
  readonly providerType: string;
  readonly autoCapture: boolean;

  /**
   * REQUIRES_ACTION의 의미를 선언한다.
   * - 'interactive'  : Toss 등 짧은 외부 리다이렉트. 짧은 actionExpiresAt로 빠르게 reclaim.
   * - 'offline-wait' : 무통장 등 오프라인 입금 대기. 긴 입금 윈도우(expiresAt) 동안 유지.
   */
  readonly actionMode: 'interactive' | 'offline-wait';

  getUserMethods(userId: string): Promise<PaymentMethod[]>;
  // ... (이하 변경 없음)
```

- [ ] **Step 4: 각 프로바이더에 필드 설정**

`bank-transfer.provider.ts`의 클래스 상단 필드부에 추가:
```ts
  readonly providerType = 'BANK_TRANSFER';
  readonly autoCapture = true;
  readonly actionMode = 'offline-wait' as const;
```

나머지 5개 프로바이더(`toss.provider.ts`, `toss-billing.provider.ts`, `nicepay.provider.ts`, `nicepay-billing.provider.ts`, `points.provider.ts`) 각각의 `readonly autoCapture = ...;` 줄 아래에 추가:
```ts
  readonly actionMode = 'interactive' as const;
```

- [ ] **Step 5: 테스트 + 컴파일 통과 확인**

Run:
```bash
npx jest apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts --runInBand
npx tsc --noEmit -p apps/wallet/tsconfig.app.json
```
Expected: 테스트 PASS, 타입 에러 없음(인터페이스 required 필드를 6개 프로바이더 모두 만족).

- [ ] **Step 6: Commit**

```bash
git add apps/wallet/src/providers
git commit -m "[wallet] PaymentProvider.actionMode 도입 (무통장=offline-wait)"
```

---

### Task 4: confirm 흐름 라우팅 + `stampDepositExpiry`(72h 윈도우)

**Files:**
- Modify: `apps/wallet/src/payment-intents/confirm.service.ts:386-397` (`handlePrimaryResult`의 `REQUIRES_ACTION` 분기), `:524-537` (TTL 헬퍼 부근)
- Modify: `apps/wallet/src/payment-intents/confirm.service.spec.ts` (기존 TOSS 테스트 보강 + 신규 무통장 테스트)

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/wallet/src/payment-intents/confirm.service.spec.ts`의 `makeContext`를 옵션을 받도록 일반화하고 `stateTransitionService`를 반환에 노출한다. 아래 4곳을 수정:

(a) 시그니처:
```ts
function makeContext(opts: {
  providerActionMode?: 'interactive' | 'offline-wait';
  authorizeResult?: { status: string; nextAction?: Record<string, unknown> };
  methodType?: string;
} = {}) {
```

(b) `extProvider`의 `authorize` 위에 `actionMode`를 추가하고 `authorize`를 옵션 기반으로(기존 다른 메서드 mock이 있으면 유지):
```ts
  const extProvider = {
    actionMode: opts.providerActionMode ?? 'interactive',
    authorize: jest
      .fn()
      .mockResolvedValue(
        opts.authorizeResult ?? { status: 'REQUIRES_ACTION', nextAction: { type: 'TOSS_CHECKOUT' } },
      ),
    // ...기존 다른 mock 메서드 유지
  };
```

(c) `paymentMethodsService.findById`가 methodType를 반영:
```ts
    findById: jest.fn().mockResolvedValue({ id: 'pm-ext', type: opts.methodType ?? 'TOSS', providerData: {} }),
```

(d) 반환 객체에 `stateTransitionService` 추가:
```ts
  return { service, pointsProvider, chargesService, updateSet, stateTransitionService };
```

그 다음 `describe('ConfirmService', ...)` 안에 신규 테스트를 추가한다(confirm 호출은 기존 테스트와 동일하게 3-arg, transitionIntent 단언도 실제 호출과 동일하게 3-arg):

```ts
it('offline-wait provider enters AWAITING_DEPOSIT and stamps a long deposit expiry (not actionExpiresAt)', async () => {
  const { service, updateSet, stateTransitionService } = makeContext({
    providerActionMode: 'offline-wait',
    authorizeResult: { status: 'REQUIRES_ACTION', nextAction: { type: 'BANK_TRANSFER_PENDING' } },
    methodType: 'BANK_TRANSFER',
  });

  await service.confirm('intent-1', { paymentMethodId: 'pm-ext', pointsToApply: 0 }, 'corr-1');

  expect(stateTransitionService.transitionIntent).toHaveBeenCalledWith(
    'intent-1',
    'AWAITING_DEPOSIT',
    expect.objectContaining({ reasonCode: 'AWAITING_DEPOSIT' }),
  );

  const setArgs = updateSet.mock.calls.map((c) => c[0]);
  expect(setArgs).toContainEqual(expect.objectContaining({ expiresAt: expect.any(Date) }));
  expect(setArgs).not.toContainEqual(expect.objectContaining({ actionExpiresAt: expect.any(Date) }));
});
```

> 기존 테스트 두 개(`releases a stale ...`, `stamps a short action-expiry ...`)는 옵션 미지정 → 기본 interactive/TOSS 경로로 그대로 통과해 회귀 가드가 된다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest apps/wallet/src/payment-intents/confirm.service.spec.ts --runInBand`
Expected: 신규 테스트 FAIL — 현재는 offline-wait도 REQUIRES_ACTION으로 전이하고 `actionExpiresAt`를 stamp 하므로 단언이 깨짐.

- [ ] **Step 3: 윈도우 헬퍼 추가**

`apps/wallet/src/payment-intents/confirm.service.ts`의 `actionTtlMs()` / `stampActionExpiry()` 근처(라인 524~537)에 추가:

```ts
  private static readonly DEFAULT_DEPOSIT_WINDOW_HOURS = 72;

  private depositWindowMs(): number {
    const raw = Number(process.env.WALLET_BANK_TRANSFER_DEPOSIT_WINDOW_HOURS);
    const hours = Number.isFinite(raw) && raw > 0 ? raw : ConfirmService.DEFAULT_DEPOSIT_WINDOW_HOURS;
    return hours * 60 * 60_000;
  }

  private async stampDepositExpiry(intentId: string): Promise<void> {
    await this.dbService.db
      .update(paymentIntents)
      .set({ expiresAt: new Date(Date.now() + this.depositWindowMs()) })
      .where(eq(paymentIntents.id, intentId));
  }
```

- [ ] **Step 4: `REQUIRES_ACTION` 분기 라우팅**

`handlePrimaryResult`의 `case 'REQUIRES_ACTION':`(라인 386~397)를 다음으로 교체:

```ts
      case 'REQUIRES_ACTION': {
        await this.chargesService.updateStatus(primaryChargeId, 'REQUIRES_ACTION', {
          responsePayload: { ...(result.raw ?? {}), nextAction: result.nextAction },
        });

        // 프로바이더가 선언한 액션 의미로 만료 정책을 분기한다.
        if (phase1.plan.primary.provider.actionMode === 'offline-wait') {
          // 무통장: 오프라인 입금 대기. 긴 입금 윈도우(expiresAt)로 두고
          // actionExpiresAt은 찍지 않아 TossActionExpirationJob 대상에서 제외한다.
          await this.stateTransitionService.transitionIntent(intentId, 'AWAITING_DEPOSIT', {
            correlationId,
            reasonCode: 'AWAITING_DEPOSIT',
          });
          await this.stampDepositExpiry(intentId);
        } else {
          // Toss 등 인터랙티브 액션: 기존대로 짧은 actionExpiresAt로 빠르게 reclaim.
          await this.stateTransitionService.transitionIntent(intentId, 'REQUIRES_ACTION', {
            correlationId,
            reasonCode: 'REQUIRES_ACTION',
          });
          await this.stampActionExpiry(intentId);
        }
        return { nextAction: result.nextAction };
      }
```

> 메모: `phase1.plan.primary.provider`는 authorize에 쓰인 동일 프로바이더 인스턴스다(`authorizeSlot`의 `slot.provider`). 무통장 첫 confirm 시 from-state는 항상 `PROCESSING`이라 `PROCESSING → AWAITING_DEPOSIT`(Task 2) 규칙이 적용된다. `allowedStatuses`(confirm 진입 가드)에 `AWAITING_DEPOSIT`는 **추가하지 않는다** — 입금 대기 중 재confirm을 막기 위함.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest apps/wallet/src/payment-intents/confirm.service.spec.ts --runInBand`
Expected: 신규(무통장) + 기존(TOSS actionExpiresAt 회귀) 모두 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/wallet/src/payment-intents/confirm.service.ts apps/wallet/src/payment-intents/confirm.service.spec.ts
git commit -m "[wallet] confirm: offline-wait 프로바이더는 AWAITING_DEPOSIT + 72h 윈도우로 라우팅"
```

---

### Task 5: `ExpirationJob` 스캔에 `AWAITING_DEPOSIT` 포함

**Files:**
- Modify: `apps/wallet/src/jobs/expiration.job.ts:54-60`
- Modify/Create test: `apps/wallet/src/jobs/expiration.job.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/wallet/src/jobs/expiration.job.spec.ts`에 추가(파일이 있으면 케이스 추가, 없으면 생성):

```ts
import { EXPIRABLE_INTENT_STATUSES } from './expiration.job';

describe('ExpirationJob — expirable statuses', () => {
  it('includes AWAITING_DEPOSIT so unpaid bank-transfer intents get released + canceled at the deposit window', () => {
    expect(EXPIRABLE_INTENT_STATUSES).toContain('AWAITING_DEPOSIT');
  });

  it('still includes the in-flight statuses', () => {
    expect(EXPIRABLE_INTENT_STATUSES).toEqual(
      expect.arrayContaining(['CREATED', 'PROCESSING', 'REQUIRES_ACTION', 'AWAITING_DEPOSIT']),
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest apps/wallet/src/jobs/expiration.job.spec.ts --runInBand`
Expected: FAIL — `EXPIRABLE_INTENT_STATUSES` export 없음 / `AWAITING_DEPOSIT` 미포함.

- [ ] **Step 3: 상수 export 후 사용**

`apps/wallet/src/jobs/expiration.job.ts` 상단(import 아래, 클래스 위)에 추가:

```ts
export const EXPIRABLE_INTENT_STATUSES = [
  'CREATED',
  'PROCESSING',
  'REQUIRES_ACTION',
  'AWAITING_DEPOSIT',
] as const;
```

`expireDueIntents()`의 `inArray(paymentIntents.status, ['CREATED', 'PROCESSING', 'REQUIRES_ACTION'])`(라인 58)를 다음으로 교체:

```ts
          inArray(paymentIntents.status, EXPIRABLE_INTENT_STATUSES as unknown as string[]),
```

> 메모: 만료 처리 본문(releaseIntentCharges → transitionIntent('CANCELED'))은 무변경. `AWAITING_DEPOSIT → CANCELED`는 Task 2에서 허용됨. 적립금 hold는 기존 `releaseIntentCharges`가 해제한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest apps/wallet/src/jobs/expiration.job.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/wallet/src/jobs/expiration.job.ts apps/wallet/src/jobs/expiration.job.spec.ts
git commit -m "[wallet] ExpirationJob이 AWAITING_DEPOSIT을 72h 윈도우로 만료 처리"
```

---

### Task 6: 명시적 cancel 경로가 `AWAITING_DEPOSIT`를 허용 (spec §9)

**Files:**
- Modify: `apps/wallet/src/payment-intents/payment-intents.service.ts:258` (`cancel()`의 `cancelableStatuses`)
- Create: `apps/wallet/src/payment-intents/payment-intents.cancelable.spec.ts`

> 배경: `ExpirationJob`은 `stateTransitionService.transitionIntent`를 직접 호출해 이 가드를 우회하므로 만료 취소는 영향 없다. 하지만 사용자/관리자/Medusa(cart 수정 시 cancelPayment) 의 **명시적 취소**는 이 가드를 거치며, 현재 `AWAITING_DEPOSIT`가 빠져 있어 `INTENT_NOT_CANCELABLE`로 막힌다(→ Medusa는 no-op로 삼켜 적립금 hold가 72h까지 잔류). `AWAITING_DEPOSIT`를 cancelable에 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/wallet/src/payment-intents/payment-intents.cancelable.spec.ts`:

```ts
import { CANCELABLE_INTENT_STATUSES } from './payment-intents.service';

describe('CANCELABLE_INTENT_STATUSES', () => {
  it('includes AWAITING_DEPOSIT so a pending deposit can be explicitly canceled', () => {
    expect(CANCELABLE_INTENT_STATUSES).toContain('AWAITING_DEPOSIT');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest apps/wallet/src/payment-intents/payment-intents.cancelable.spec.ts --runInBand`
Expected: FAIL — `CANCELABLE_INTENT_STATUSES` export 없음.

- [ ] **Step 3: 상수 export + 값 추가 후 사용**

`apps/wallet/src/payment-intents/payment-intents.service.ts` 상단(클래스 위)에 추가:

```ts
export const CANCELABLE_INTENT_STATUSES = [
  'CREATED',
  'PROCESSING',
  'REQUIRES_ACTION',
  'AWAITING_DEPOSIT',
  'AUTHORIZED',
  'SUCCEEDED',
] as const;
```

`cancel()` 내부의 인라인 배열/검사(라인 258~)를 다음으로 교체:

```ts
    if (!(CANCELABLE_INTENT_STATUSES as readonly string[]).includes(intent.status)) {
      throw new BadRequestException({
        error: 'INTENT_NOT_CANCELABLE',
        message: `Intent cannot be canceled in status: ${intent.status}`,
      });
    }
```

(기존 `const cancelableStatuses = [...]` 줄은 삭제)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest apps/wallet/src/payment-intents/payment-intents.cancelable.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/wallet/src/payment-intents/payment-intents.service.ts apps/wallet/src/payment-intents/payment-intents.cancelable.spec.ts
git commit -m "[wallet] AWAITING_DEPOSIT를 명시적 cancel 가능 상태에 추가"
```

---

### Task 7: admin `getPendingTransfers`가 두 상태 모두 노출 (컷오버)

**Files:**
- Modify: `apps/wallet/src/admin/bank-transfer-admin.service.ts` (`getPendingTransfers`의 `condition`)

> `confirmDeposit`은 변경하지 않는다 — intent를 현재 상태에서 `AUTHORIZED`로 전이하며, `AWAITING_DEPOSIT → AUTHORIZED`(신규)와 `REQUIRES_ACTION → AUTHORIZED`(유지)가 모두 허용되므로 신/구 건 모두 처리된다.

- [ ] **Step 1: 필터 수정**

`getPendingTransfers`의 `condition` 정의를 수정한다. 먼저 import에 `inArray`가 있는지 확인하고 없으면 추가(`import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';`). 그 다음:

```ts
    const condition = and(
      inArray(paymentIntents.status, ['AWAITING_DEPOSIT', 'REQUIRES_ACTION']),
      eq(paymentMethods.type, 'BANK_TRANSFER'),
    );
```

> 메모: charge 조인은 여전히 `charges.status = 'REQUIRES_ACTION'`(AUTHORIZE)로 두어 nextAction 스냅샷을 읽는다 — charge 상태는 본 변경에서 바뀌지 않는다. 한 배포 주기 뒤 후속 PR에서 `AWAITING_DEPOSIT` 단독으로 좁힐 수 있다(선택).

- [ ] **Step 2: 컴파일 확인**

Run: `npx tsc --noEmit -p apps/wallet/tsconfig.app.json`
Expected: 타입 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add apps/wallet/src/admin/bank-transfer-admin.service.ts
git commit -m "[wallet] admin 무통장 대기 목록이 AWAITING_DEPOSIT/REQUIRES_ACTION 모두 노출 (컷오버)"
```

---

### Task 8: Medusa `mapStatus`에 `AWAITING_DEPOSIT` 명시

**Files:**
- Modify: `apps/medusa/src/modules/almond-payment/service.ts` (`mapStatus`)

- [ ] **Step 1: case 추가**

`mapStatus`의 `switch (walletStatus)`에서 `case 'CANCELED'` 위 적당한 위치에 추가:

```ts
      case 'AWAITING_DEPOSIT':
        return 'pending'; // 무통장 입금 대기 — 아직 cart 완료 불가
```

> 메모: default도 이미 `'pending'`을 반환하지만, 의도를 명시해 회귀를 방지한다. 완료 신호 경로(`getWebhookActionAndData`/`payment-events` hook)는 capture 이벤트로만 동작하므로 무변경.

- [ ] **Step 2: 컴파일 확인**

Run: `cd apps/medusa && npx tsc --noEmit -p tsconfig.json; cd -`
Expected: 타입 에러 없음. (느리면 생략 가능하나 권장)

- [ ] **Step 3: Commit**

```bash
git add apps/medusa/src/modules/almond-payment/service.ts
git commit -m "[medusa] almond-payment mapStatus에 AWAITING_DEPOSIT→pending 명시"
```

---

### Task 9: wallet-web pay-form이 status 대신 nextAction으로 분기

**Files:**
- Modify: `apps/wallet-web/app/pay/[intentId]/pay-form.tsx` (`handleConfirm`의 무통장 분기)

- [ ] **Step 1: 분기 조건 변경**

`handleConfirm` 안의 무통장 분기를 status 의존에서 nextAction 의존으로 변경한다. 기존:

```ts
      if (result.status === 'REQUIRES_ACTION' && isBankTransferPendingAction(result.nextAction)) {
        setBankTransferPending(result.nextAction);
        return;
      }
```

변경 후 (TOSS 분기 **뒤**, 일반 REQUIRES_ACTION 폴백 **앞**에 위치 유지):

```ts
      // 무통장: confirm 응답 status는 이제 AWAITING_DEPOSIT이므로 status가 아니라
      // nextAction 타입(BANK_TRANSFER_PENDING)으로 판별한다.
      if (isBankTransferPendingAction(result.nextAction)) {
        setBankTransferPending(result.nextAction);
        return;
      }
```

> 메모: TOSS 분기(`result.nextAction?.type === 'TOSS_CHECKOUT'`)가 먼저 처리되므로 순서를 유지하면 충돌 없음. 이후의 `if (result.status === 'REQUIRES_ACTION')` 폴백은 그대로 둔다.

- [ ] **Step 2: 컴파일/린트 확인**

Run: `npx tsc --noEmit -p apps/wallet-web/tsconfig.json`
Expected: 타입 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add "apps/wallet-web/app/pay/[intentId]/pay-form.tsx"
git commit -m "[wallet-web] 무통장 대기 화면을 nextAction(BANK_TRANSFER_PENDING) 기준으로 표시"
```

---

### Task 10: 통합 빌드 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: wallet 빌드**

Run: `nest build wallet`
Expected: 성공, 타입 에러 없음.

- [ ] **Step 2: 변경된 wallet 단위 테스트 일괄(좁힌 범위) 재확인**

Run:
```bash
npx jest \
  apps/wallet/src/domain/state-transition/state-transition.rules.spec.ts \
  apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts \
  apps/wallet/src/payment-intents/confirm.service.spec.ts \
  apps/wallet/src/payment-intents/payment-intents.cancelable.spec.ts \
  apps/wallet/src/jobs/expiration.job.spec.ts \
  apps/wallet/src/jobs/toss-action-expiration.job.spec.ts \
  --runInBand
```
Expected: 모두 PASS. (특히 `toss-action-expiration.job.spec.ts`는 기존 그대로 PASS — 무통장은 actionExpiresAt NULL + status≠REQUIRES_ACTION이라 영향 없음)

- [ ] **Step 3: 최종 상태 확인**

Run: `git log --oneline -10`
Expected: Task 1~9 커밋이 순서대로 존재.

---

## 수동 검증 (배포 전 권장)

코드 자동 테스트로는 못 잡는 end-to-end 흐름:

1. storefront에서 무통장 선택 → wallet-web에서 "입금 확인 대기 중" 계좌 화면이 뜨는지(Task 8).
2. wallet DB에서 해당 intent `status='AWAITING_DEPOSIT'`, `action_expires_at IS NULL`, `expires_at ≈ now+72h` 확인(Task 1/4).
3. 15분 경과 후에도 intent가 살아있는지(TossActionExpirationJob에 안 잡힘).
4. admin-web "무통장 입금" 목록에 노출 → "입금 확인" → intent `CAPTURED` → Medusa 주문 생성 확인(Task 6 + 기존 체인).
5. (선택) 미입금 intent를 만료시켜(또는 `expires_at`을 과거로) ExpirationJob이 `CANCELED` + 적립금 hold 해제하는지(Task 5).

## Out of scope (별도 과제)

- **P1**: 입금 대기 동안 재고 미예약 → confirm 시점 `completeCartWorkflow` 실패 가능성/보상 경로 부재.
- **P2**: wallet-web 입금 대기 화면에서 storefront 복귀 경로/주문 추적 부재.
