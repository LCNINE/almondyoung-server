# 주문 리컨실러 (#1016 12번 행) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재판정 묶음의 리컨실러 틀을 만들고, 그 첫 규칙으로 #1016 12번 행(매칭 전략 변경이 매칭 대기 주문을 깨우지 않음 + 링크 0개 매칭)을 닫는다.

**Architecture:** core 에 `order-reconcile` 모듈을 둔다. `@CronOnce` 작업 하나가 매분 레지스트리의 규칙을 돌리고, 후보는 틀이 정체 보드 투영(`order_progress`)에서만 고른다. 규칙은 `fingerprint`·`check`(도메인 판정 공유)·`act`(도메인 함수 호출)만 쓰고, 시도 횟수·백오프·포기·관찰 기록은 `order_reconcile_state` 테이블과 순수 함수 하나가 맡는다. 12번은 FO 생성 가드(셀메이트 출고 주문), 주문 단위 깨우기 규칙, 링크 0개 매칭을 만드는 두 명령의 차단으로 닫는다.

**Tech Stack:** NestJS 11 · Drizzle ORM(postgres.js) · `@app/cron-once` · Jest(ts-jest) · Next.js admin-web(React Query)

**Spec:** `docs/superpowers/specs/2026-10-08-order-reconciler-design.md` (선행: `docs/superpowers/specs/2026-10-06-order-stall-board-design.md`)

## Global Constraints

- 게이트: `npm run type-check` 에러 0 · `npx jest` 실패 0 · `(cd apps/admin-web && npx tsc --noEmit)` 에러 0 · `npm run test:admin-web` 실패 0
- `any` 금지. `as` 는 이유를 주석으로 남긴 경우만(예: `execute()` 원시 결과, 테스트 더블)
- 서비스는 `@app/shared` 의 도메인 예외(`BadRequestError` 등)를 던진다. drizzle 쿼리는 `trx.select().from()…` 빌더로(`db.query.*` 는 기존 코드만)
- tx 전파: 공개 메서드는 마지막 인자 `tx?: DbTx`, 안에서는 `this.dbService.run(async (trx) => …, tx)`. 클래스별 `inTx` 헬퍼 금지
- 마이그: `npm run db:generate:core -- --name add-order-reconcile-state`. `schema.ts` + `apps/core/drizzle/<ts>_*.sql` + `apps/core/drizzle/meta/` 를 **한 커밋**에. 생성된 SQL 을 손으로 고치지 않는다. additive(expand) → 배포는 `db:migrate` → `sst deploy`
- 통합 스펙은 `describeIfDb`(= `process.env.DATABASE_URL` 있을 때만) + 롤백 트랜잭션. 스펙 안에서 `dotenv.config()` 금지. 실행: `npm run test:core:integration:local -- <파일 경로>` (워크트리면 앞에 `COMPOSE_PROJECT_NAME=almondyoung-server`). 러너의 마이그 단계가 다른 브랜치 마이그 잔재로 실패하면, 빈 임시 DB 를 만들어 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<임시DB> npx drizzle-kit migrate --config apps/core/drizzle.config.ts` 로 전부 적용한 뒤 같은 `DATABASE_URL` 로 `npx jest --runInBand <파일>` 를 돌린다(정체 보드 때 쓴 방식)
- 리컨실러 상수(스펙 §4.5): 시도 간격 **1·4·16·64·256분**, 다섯 번 뒤 포기, 포기 뒤 **1024분**마다 재시도, `not_needed`·`would_act` 는 **10분** 뒤, 규칙당 주기마다 후보 최대 **50**건
- 크론 이름 `order-reconcile`, `@CronOnce('* * * * *', { name: 'order-reconcile' })`. core 루트 모듈은 이미 `CronOnceModule` 을 import 한다
- 12번 규칙의 첫 배포 모드는 **`'observe'`**. `changeMatchingStrategy` 에 `wake` 호출을 **더하지 않는다**(스펙 D4 — 깨우기는 리컨실러 몫)
- 주석은 한국어, «왜»만. 주변 코드의 밀도를 따른다
- admin-web 은 컴포넌트 테스트를 쓰지 않는다 — 화면 판단은 `.ts` 순수 함수로 빼서 테스트한다
- 모든 커밋 메시지 끝에 빈 줄 + `Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`

## Review Focus

- **링크 0개 매칭(라이브 20건)을 기다리는 주문** — 리컨실러가 «매칭됨»으로 오인해 깨우면 워커가 곧장 `awaiting_matching` 으로 되돌려 다섯 번 헛돌고 포기한다. `check` 는 `not_needed` 여야 한다 → Task 6 테스트 «링크 0개 매칭을 기다리면 not_needed»
- **`waiting_variant_ids` 가 비었거나 배열이 아닌 jsonb** — 예외로 죽지 않고 `not_needed` → Task 6 테스트 «기다리는 variant 가 비면 not_needed»
- **투영이 늦어 이미 깨어난 주문**(backlog 는 `pending`, 투영은 아직 `awaiting_matching`) — `act` 하지 않고 `not_needed` → Task 6 테스트 «backlog 가 이미 awaiting_matching 이 아니면 not_needed»
- **관찰 → 실행 전환 직후** — 관찰 동안의 행 때문에 곧장 포기로 가면 안 된다. 모드가 바뀌면 횟수 0 → Task 1 테스트 «모드가 바뀌면 횟수와 포기를 지운다»
- **pending 매칭(전략 NULL)을 편집 창에서 링크와 함께 저장** — 지금은 전략 변경 요청이 400 을 낸다. 새 저장 계획은 upsert 하나만 보낸다 → Task 10 테스트 «pending 매칭에 링크를 붙이면 upsert 하나»

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.ts` (신규) | 상수·모드/결과 타입·`effectivePrior`·`chooseStep`·`nextRecord` 순수 함수 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts` (신규) | `OrderReconcileRule` 인터페이스, DI 토큰 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.ts` (신규) | 후보 조회(투영 JOIN 상태)·떠난 행 삭제·상태 upsert |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts` (신규) | 한 바퀴: 떠난 행 삭제 → 후보 → 후보별 savepoint → 기록 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.ts` (신규) | `@CronOnce` 진입점, 실행 중 플래그 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts` (신규) | 규칙 클래스 배열 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts` (신규) | DI 배선 |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts` (신규) | 12번 규칙 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | `orderReconcileState` 테이블 |
| `apps/core/src/modules/product-matching/fulfillable-matching.ts` (신규) | «FO 를 만들 수 있는 매칭» 순수 판정 |
| `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` | 셀메이트 출고 주문 가드, 공유 판정 사용 |
| `apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.ts` | `findBySalesOrderId`·`requeueAwaitingMatching` |
| `apps/core/src/modules/product-matching/services/product-matching.service.ts` | `variant` 전략 변경 거절 |
| `apps/core/src/modules/product-matching/services/product-sku-mapping.service.ts` | 빈 링크 upsert → `pending` |
| `apps/core/src/modules/fulfillment/order-progress/*` | 요약·목록에 `gaveUp` |
| `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts` | `gaveUp` 타입·표시 순수 함수 |
| `apps/admin-web/src/features/order/stall-board/**` | «자동 멈춤» 표시 |
| `apps/admin-web/src/lib/services/matching/save-plan.ts` (신규) | 편집 창 저장 순서 순수 함수 |
| `apps/admin-web/src/features/matching/variants/components/editor-dialog/index.tsx` | 저장 계획을 순서대로 실행 |
| `scripts/ops/1016-row12-demote-zero-link-matchings.ts` (신규) | 기존 링크 0개 매칭 20건 → `pending` |

---

### Task 1: 재판정 상태 전이 순수 함수

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.ts`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.spec.ts`

**Interfaces:**
- Produces:
  - 상수 `MAX_ATTEMPTS = 5`, `RETRY_DELAYS_MIN = [1, 4, 16, 64, 256]`, `GAVE_UP_RECHECK_MIN = 1024`, `IDLE_RECHECK_MIN = 10`, `RECONCILE_CANDIDATE_LIMIT = 50`, `LAST_ERROR_MAX = 1000`
  - `type ReconcileMode = 'observe' | 'act'`, `isReconcileMode(v: string): v is ReconcileMode`
  - `type ReconcileResult = 'acted' | 'would_act' | 'not_needed' | 'error'`, `isReconcileResult(v: string): v is ReconcileResult`
  - `type ReconcileStep = 'act' | 'would_act' | 'not_needed' | 'give_up'`
  - `type ReconcilePrior = { fingerprint: string; mode: ReconcileMode; attempts: number; lastResult: ReconcileResult; lastError: string | null; gaveUpAt: Date | null }`
  - `type EffectivePrior = { attempts: number; gaveUpAt: Date | null; lastResult: ReconcileResult | null; lastError: string | null }`
  - `type ReconcileRecord = { fingerprint: string; mode: ReconcileMode; attempts: number; lastResult: ReconcileResult; lastError: string | null; gaveUpAt: Date | null; nextCheckAt: Date }`
  - `effectivePrior(prior: ReconcilePrior | null, fingerprint: string, mode: ReconcileMode): EffectivePrior`
  - `chooseStep(eff: EffectivePrior, mode: ReconcileMode, checkPassed: boolean): ReconcileStep`
  - `nextRecord(eff: EffectivePrior, input: { fingerprint: string; mode: ReconcileMode; step: ReconcileStep; outcome?: 'acted' | 'error'; error?: string | null }, now: Date): ReconcileRecord`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.spec.ts
import {
  EffectivePrior,
  ReconcilePrior,
  chooseStep,
  effectivePrior,
  nextRecord,
} from './order-reconcile.state';

const NOW = new Date('2026-10-08T00:00:00.000Z');
const plusMin = (m: number) => new Date(NOW.getTime() + m * 60_000);
const fresh: EffectivePrior = { attempts: 0, gaveUpAt: null, lastResult: null, lastError: null };
const prior = (over: Partial<ReconcilePrior> = {}): ReconcilePrior => ({
  fingerprint: 'fp',
  mode: 'act',
  attempts: 0,
  lastResult: 'acted',
  lastError: null,
  gaveUpAt: null,
  ...over,
});

describe('effectivePrior', () => {
  it('처음 보는 주문은 0 에서 시작한다', () => {
    expect(effectivePrior(null, 'fp', 'act')).toEqual(fresh);
  });

  it('지문이 바뀌면 횟수와 포기를 지운다 — 사람이 원인을 손봤다', () => {
    const eff = effectivePrior(prior({ fingerprint: 'old', attempts: 5, gaveUpAt: NOW }), 'new', 'act');
    expect(eff).toEqual(fresh);
  });

  it('모드가 바뀌면 횟수와 포기를 지운다 — 관찰 기간의 행이 곧장 포기로 가지 않게', () => {
    const eff = effectivePrior(prior({ mode: 'observe', attempts: 3 }), 'fp', 'act');
    expect(eff).toEqual(fresh);
  });

  it('같은 지문·모드면 이어간다', () => {
    const eff = effectivePrior(prior({ attempts: 2, lastResult: 'error', lastError: 'boom' }), 'fp', 'act');
    expect(eff).toEqual({ attempts: 2, gaveUpAt: null, lastResult: 'error', lastError: 'boom' });
  });
});

describe('chooseStep', () => {
  it('check 가 false 면 무엇이든 not_needed', () => {
    expect(chooseStep({ ...fresh, attempts: 5 }, 'act', false)).toBe('not_needed');
    expect(chooseStep(fresh, 'observe', false)).toBe('not_needed');
  });

  it('관찰 모드는 would_act 만 한다(포기 없음)', () => {
    expect(chooseStep({ ...fresh, attempts: 9 }, 'observe', true)).toBe('would_act');
  });

  it('다섯 번 시도 전에는 act', () => {
    for (const attempts of [0, 1, 2, 3, 4]) expect(chooseStep({ ...fresh, attempts }, 'act', true)).toBe('act');
  });

  it('다섯 번 시도 뒤 아직 할 일이 있으면 give_up', () => {
    expect(chooseStep({ ...fresh, attempts: 5 }, 'act', true)).toBe('give_up');
  });

  it('이미 포기한 주문은 1024분마다 다시 act 한다', () => {
    expect(chooseStep({ ...fresh, attempts: 5, gaveUpAt: NOW }, 'act', true)).toBe('act');
  });
});

describe('nextRecord', () => {
  const base = { fingerprint: 'fp', mode: 'act' as const };

  it.each([
    [0, 1],
    [1, 4],
    [2, 16],
    [3, 64],
    [4, 256],
  ])('시도 %i 회 뒤 acted → 간격 %i분, 횟수 +1', (attempts, delay) => {
    const rec = nextRecord({ ...fresh, attempts }, { ...base, step: 'act', outcome: 'acted' }, NOW);
    expect(rec).toEqual({
      ...base,
      attempts: attempts + 1,
      lastResult: 'acted',
      lastError: null,
      gaveUpAt: null,
      nextCheckAt: plusMin(delay),
    });
  });

  it('error 도 시도로 세고 오류를 1000자로 자른다', () => {
    const rec = nextRecord(fresh, { ...base, step: 'act', outcome: 'error', error: 'x'.repeat(1500) }, NOW);
    expect(rec.attempts).toBe(1);
    expect(rec.lastResult).toBe('error');
    expect(rec.lastError).toHaveLength(1000);
    expect(rec.nextCheckAt).toEqual(plusMin(1));
  });

  it('give_up 은 act 하지 않고 포기 시각을 찍고, 마지막 결과·오류는 그대로 둔다', () => {
    const eff = { attempts: 5, gaveUpAt: null, lastResult: 'error' as const, lastError: 'boom' };
    expect(nextRecord(eff, { ...base, step: 'give_up' }, NOW)).toEqual({
      ...base,
      attempts: 5,
      lastResult: 'error',
      lastError: 'boom',
      gaveUpAt: NOW,
      nextCheckAt: plusMin(1024),
    });
  });

  it('포기 뒤 act 는 횟수를 늘리지 않고 포기를 유지한 채 1024분 뒤', () => {
    const gaveUpAt = new Date('2026-10-01T00:00:00.000Z');
    const rec = nextRecord({ ...fresh, attempts: 5, gaveUpAt }, { ...base, step: 'act', outcome: 'acted' }, NOW);
    expect(rec).toMatchObject({ attempts: 5, gaveUpAt, lastResult: 'acted', nextCheckAt: plusMin(1024) });
  });

  it('not_needed·would_act 는 10분 뒤, 횟수·포기 유지', () => {
    const gaveUpAt = new Date('2026-10-01T00:00:00.000Z');
    const eff = { ...fresh, attempts: 5, gaveUpAt };
    expect(nextRecord(eff, { ...base, step: 'not_needed' }, NOW)).toMatchObject({
      attempts: 5,
      gaveUpAt,
      lastResult: 'not_needed',
      lastError: null,
      nextCheckAt: plusMin(10),
    });
    expect(nextRecord(fresh, { fingerprint: 'fp', mode: 'observe', step: 'would_act' }, NOW)).toMatchObject({
      attempts: 0,
      lastResult: 'would_act',
      nextCheckAt: plusMin(10),
    });
  });

  it('첫 시도부터 포기까지 341분(5시간 41분)', () => {
    let eff: EffectivePrior = fresh;
    let at = NOW;
    for (let i = 0; i < 5; i++) {
      const rec = nextRecord(eff, { ...base, step: 'act', outcome: 'acted' }, at);
      eff = { attempts: rec.attempts, gaveUpAt: rec.gaveUpAt, lastResult: rec.lastResult, lastError: rec.lastError };
      at = rec.nextCheckAt;
    }
    expect(chooseStep(eff, 'act', true)).toBe('give_up');
    expect((at.getTime() - NOW.getTime()) / 60_000).toBe(341);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.spec.ts`
Expected: FAIL — `Cannot find module './order-reconcile.state'`

- [ ] **Step 3: 구현한다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.ts
/**
 * 리컨실러 재판정 상태 전이(스펙 docs/superpowers/specs/2026-10-08-order-reconciler-design.md §4.5).
 * 시도 횟수·백오프·포기·리셋 규칙은 전부 여기 한 곳에만 있다 — 러너와 저장소는 이 결과를 그대로 쓴다.
 */
export const MAX_ATTEMPTS = 5;
export const RETRY_DELAYS_MIN = [1, 4, 16, 64, 256] as const;
// 포기 뒤에도 이 주기로 다시 해 본다 — 배포로 원인이 고쳐진 경우처럼 지문이 못 잡는 변화를 위해서다.
export const GAVE_UP_RECHECK_MIN = 1024;
// 할 일이 없었거나 관찰만 한 주문을 다시 볼 간격. 기록하지 않으면 주기당 상한 때문에 늘 같은 오래된 주문만 본다.
export const IDLE_RECHECK_MIN = 10;
export const RECONCILE_CANDIDATE_LIMIT = 50;
export const LAST_ERROR_MAX = 1000;

export const RECONCILE_MODES = ['observe', 'act'] as const;
export type ReconcileMode = (typeof RECONCILE_MODES)[number];
export function isReconcileMode(value: string): value is ReconcileMode {
  return (RECONCILE_MODES as readonly string[]).includes(value);
}

export const RECONCILE_RESULTS = ['acted', 'would_act', 'not_needed', 'error'] as const;
export type ReconcileResult = (typeof RECONCILE_RESULTS)[number];
export function isReconcileResult(value: string): value is ReconcileResult {
  return (RECONCILE_RESULTS as readonly string[]).includes(value);
}

export type ReconcileStep = 'act' | 'would_act' | 'not_needed' | 'give_up';

export type ReconcilePrior = {
  fingerprint: string;
  mode: ReconcileMode;
  attempts: number;
  lastResult: ReconcileResult;
  lastError: string | null;
  gaveUpAt: Date | null;
};

export type EffectivePrior = {
  attempts: number;
  gaveUpAt: Date | null;
  lastResult: ReconcileResult | null;
  lastError: string | null;
};

export type ReconcileRecord = {
  fingerprint: string;
  mode: ReconcileMode;
  attempts: number;
  lastResult: ReconcileResult;
  lastError: string | null;
  gaveUpAt: Date | null;
  nextCheckAt: Date;
};

const FRESH: EffectivePrior = { attempts: 0, gaveUpAt: null, lastResult: null, lastError: null };
const plusMinutes = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

/**
 * 지문이 바뀌었으면(운영자가 원인을 손봄) 또는 모드가 바뀌었으면(관찰→실행) 처음부터 센다.
 * 투영의 (단계, 세부 상태)는 리셋 기준이 못 된다 — 1분 해상도로는 깨운 뒤 몇 초 만에 되돌아온 것을 볼 수 없다.
 */
export function effectivePrior(
  prior: ReconcilePrior | null,
  fingerprint: string,
  mode: ReconcileMode,
): EffectivePrior {
  if (!prior || prior.fingerprint !== fingerprint || prior.mode !== mode) return FRESH;
  return {
    attempts: prior.attempts,
    gaveUpAt: prior.gaveUpAt,
    lastResult: prior.lastResult,
    lastError: prior.lastError,
  };
}

export function chooseStep(eff: EffectivePrior, mode: ReconcileMode, checkPassed: boolean): ReconcileStep {
  if (!checkPassed) return 'not_needed';
  if (mode === 'observe') return 'would_act';
  if (eff.gaveUpAt === null && eff.attempts >= MAX_ATTEMPTS) return 'give_up';
  return 'act';
}

export function nextRecord(
  eff: EffectivePrior,
  input: {
    fingerprint: string;
    mode: ReconcileMode;
    step: ReconcileStep;
    outcome?: 'acted' | 'error';
    error?: string | null;
  },
  now: Date,
): ReconcileRecord {
  const head = { fingerprint: input.fingerprint, mode: input.mode };
  if (input.step === 'not_needed' || input.step === 'would_act') {
    return {
      ...head,
      attempts: eff.attempts,
      gaveUpAt: eff.gaveUpAt,
      lastResult: input.step,
      lastError: null,
      nextCheckAt: plusMinutes(now, IDLE_RECHECK_MIN),
    };
  }
  if (input.step === 'give_up') {
    return {
      ...head,
      attempts: eff.attempts,
      gaveUpAt: now,
      // 포기는 실행이 아니다 — 보드가 보여 줄 «마지막으로 무슨 일이 있었나»를 덮지 않는다
      lastResult: eff.lastResult ?? 'acted',
      lastError: eff.lastError,
      nextCheckAt: plusMinutes(now, GAVE_UP_RECHECK_MIN),
    };
  }
  const outcome = input.outcome ?? 'acted';
  const lastError = outcome === 'error' ? (input.error ?? '').slice(0, LAST_ERROR_MAX) : null;
  if (eff.gaveUpAt !== null) {
    return {
      ...head,
      attempts: eff.attempts,
      gaveUpAt: eff.gaveUpAt,
      lastResult: outcome,
      lastError,
      nextCheckAt: plusMinutes(now, GAVE_UP_RECHECK_MIN),
    };
  }
  const attempts = eff.attempts + 1;
  const delay = RETRY_DELAYS_MIN[Math.min(attempts, RETRY_DELAYS_MIN.length) - 1];
  return { ...head, attempts, gaveUpAt: null, lastResult: outcome, lastError, nextCheckAt: plusMinutes(now, delay) };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.spec.ts`
Expected: PASS (19 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.ts apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.spec.ts
git commit -m "feat(core): 리컨실러 재판정 상태 전이 — 백오프·포기·지문 리셋 (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 2: `order_reconcile_state` 테이블과 저장소

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`orderProgress` 정의 바로 뒤 · `wmsTables` 의 `orderProgress,` 다음 줄 · `OrderProgressRow` 타입 다음 줄)
- Create: `apps/core/drizzle/<timestamp>_add-order-reconcile-state.sql` + `apps/core/drizzle/meta/*` (생성)
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.ts`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.integration.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-08-order-reconciler-design.md` §4.5 표 (`tracking_row` 칸 추가)

**Interfaces:**
- Consumes: Task 1 의 `ReconcileMode`·`ReconcilePrior`·`ReconcileRecord`·`isReconcileMode`·`isReconcileResult`
- Produces:
  - `wmsTables.orderReconcileState`, 타입 `OrderReconcileStateRow`
  - `ORDER_RECONCILE_RULES: symbol`
  - `interface OrderReconcileRule { readonly name: string; readonly row: number; readonly mode: ReconcileMode; readonly situation: { stage: OrderProgressStage; states: readonly string[] }; fingerprint(salesOrderId: string, tx: DbTx): Promise<string>; check(salesOrderId: string, tx: DbTx): Promise<boolean>; act(salesOrderId: string, tx: DbTx): Promise<void>; }`
  - `type ReconcileRuleRef = Pick<OrderReconcileRule, 'name' | 'row' | 'situation'>`
  - `type ReconcileCandidate = { salesOrderId: string; prior: ReconcilePrior | null }`
  - `class OrderReconcileRepository { candidates(rule: ReconcileRuleRef, now: Date, limit: number, tx?: DbTx): Promise<ReconcileCandidate[]>; deleteDeparted(rule: ReconcileRuleRef, tx?: DbTx): Promise<number>; save(rule: ReconcileRuleRef, salesOrderId: string, record: ReconcileRecord, now: Date, tx?: DbTx): Promise<void>; }`

- [ ] **Step 1: 스키마에 테이블을 더한다**

`inventory.schema.ts` 의 `orderProgress` 정의(닫는 `);`) 바로 뒤에:

```ts
/**
 * 리컨실러 재판정 상태 (스펙 docs/superpowers/specs/2026-10-08-order-reconciler-design.md §4.5).
 * 행 하나 = «규칙 × 주문». 주문이 규칙의 상황을 떠나면 러너가 지운다 — 남은 행은 «아직 그 상황에 있다»는 뜻이다.
 * rule·mode·last_result 는 varchar 다(값 목록은 order-reconcile.state.ts). tracking_row 는 #1016 행 번호 —
 * 정체 보드가 리컨실러 모듈을 import 하지 않고도 «자동 멈춤 · #12» 를 그리게 행에 둔다.
 */
export const orderReconcileState = pgTable(
  'order_reconcile_state',
  {
    rule: varchar('rule', { length: 64 }).notNull(),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    trackingRow: integer('tracking_row').notNull(),
    fingerprint: text('fingerprint').notNull(),
    mode: varchar('mode', { length: 16 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastResult: varchar('last_result', { length: 16 }).notNull(),
    lastError: text('last_error'),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull(),
    // NULL = 진행 중. 찍히면 정체 보드에 «자동 멈춤»으로 보인다
    gaveUpAt: timestamp('gave_up_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rule, t.salesOrderId] }),
    idxRuleNextCheck: index('idx_order_reconcile_state_rule_next_check').on(t.rule, t.nextCheckAt),
    // 정체 보드 요약·목록이 «포기한 주문»만 찾는다
    idxGaveUp: index('idx_order_reconcile_state_gave_up')
      .on(t.salesOrderId)
      .where(sql`${t.gaveUpAt} IS NOT NULL`),
  }),
);
```

`wmsTables` 객체의 `orderProgress,` 다음 줄에 `orderReconcileState,` 를 더하고, `export type OrderProgressRow = …` 다음 줄에:

```ts
export type OrderReconcileStateRow = InferSelectModel<typeof orderReconcileState>;
```

- [ ] **Step 2: 마이그를 생성하고 검토한다**

Run: `npm run db:generate:core -- --name add-order-reconcile-state`
Expected: `apps/core/drizzle/<timestamp>_add-order-reconcile-state.sql` 생성. 내용이 `CREATE TABLE "order_reconcile_state"` + PK `("rule","sales_order_id")` + FK `sales_orders` `ON DELETE cascade` + 인덱스 2개 **뿐**인지 확인한다. 다른 테이블의 `ALTER`/`DROP` 이 섞여 있으면 멈추고 보고한다(다른 브랜치 스키마가 섞인 것).

- [ ] **Step 3: 규칙 인터페이스 파일을 만든다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts
import { DbTx } from '../../inventory/schema/inventory.schema';
import { OrderProgressStage } from '../order-progress/order-progress.thresholds';
import { ReconcileMode } from './order-reconcile.state';

export const ORDER_RECONCILE_RULES = Symbol('ORDER_RECONCILE_RULES');

/**
 * 재판정 규칙 하나(스펙 §4.2·§4.4). 규칙은 후보 SQL 을 쓰지 않는다 — 후보는 틀이 투영에서 고른다.
 * check 는 도메인이 쓰는 판정 함수를 그대로 쓰고, act 는 도메인 함수만 부른다(상태를 직접 쓰지 않는다).
 * 일시적 막힘(정비 모드 등)은 check 가 false 로 걸러 시도로 세지 않게 한다.
 */
export interface OrderReconcileRule {
  /** 상태 기록의 키. 바꾸면 기록이 끊긴다 */
  readonly name: string;
  /** #1016 행 번호 */
  readonly row: number;
  readonly mode: ReconcileMode;
  /** 투영(order_progress)에서 볼 칸 */
  readonly situation: { stage: OrderProgressStage; states: readonly string[] };
  /** 상황 지문 — 바뀌면 횟수·포기가 리셋된다 */
  fingerprint(salesOrderId: string, tx: DbTx): Promise<string>;
  /** 원천 재확인. false = 지금은 할 일 없음(실패 아님) */
  check(salesOrderId: string, tx: DbTx): Promise<boolean>;
  act(salesOrderId: string, tx: DbTx): Promise<void>;
}

export type ReconcileRuleRef = Pick<OrderReconcileRule, 'name' | 'row' | 'situation'>;
```

- [ ] **Step 4: 실패하는 통합 테스트를 쓴다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.integration.spec.ts
import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { ReconcileRuleRef } from './order-reconcile.rule';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 투영 행을 직접 넣는다 — 판정 SQL 이 아니라 저장소의 후보 선택만 본다. state 는 테스트마다 고유하게 해 다른 행과 섞이지 않게 한다. */
async function seedProgress(
  tx: DbTx,
  args: { stage: string | null; state: string; outcome?: string | null; enteredAt: Date },
): Promise<string> {
  const o = await f.seedOrder(tx);
  await tx.insert(wmsTables.orderProgress).values({
    salesOrderId: o.salesOrderId,
    salesChannel: 'medusa',
    orderedAt: args.enteredAt,
    stage: args.stage,
    state: args.state,
    stageEnteredAt: args.enteredAt,
    outcome: args.outcome ?? null,
    closedAt: args.outcome ? args.enteredAt : null,
    evaluatedAt: args.enteredAt,
  });
  return o.salesOrderId;
}

const record = (over: Partial<Parameters<OrderReconcileRepository['save']>[2]> = {}) => ({
  fingerprint: 'fp',
  mode: 'act' as const,
  attempts: 1,
  lastResult: 'acted' as const,
  lastError: null,
  gaveUpAt: null,
  nextCheckAt: new Date('2099-01-01T00:00:00.000Z'),
  ...over,
});

describeIfDb('OrderReconcileRepository (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end();
  });

  const NOW = new Date('2099-06-01T00:00:00.000Z');
  const ruleFor = (state: string): ReconcileRuleRef => ({
    name: `it-rule-${state}`,
    row: 99,
    situation: { stage: 'fo', states: [state] },
  });

  it('후보는 진행 중 + 같은 칸만, 오래된 순, 상한까지', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const oldest = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      const middle = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-02T00:00:00Z') });
      await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-03T00:00:00Z') });
      // 셀메이트 출고처럼 종료된 주문은 같은 state 문자열이어도 고르지 않는다
      await seedProgress(tx, { stage: null, state, outcome: 'external_shipped', enteredAt: new Date('1999-01-01T00:00:00Z') });
      // 다른 단계
      await seedProgress(tx, { stage: 'plan', state, enteredAt: new Date('1999-01-01T00:00:00Z') });

      const got = await repo.candidates(ruleFor(state), NOW, 2, tx);
      expect(got.map((c) => c.salesOrderId)).toEqual([oldest, middle]);
      expect(got.every((c) => c.prior === null)).toBe(true);
    });
  });

  it('next_check_at 이 안 된 행은 건너뛰고, 된 행은 이전 상태와 함께 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const rule = ruleFor(state);
      const later = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      const due = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-02T00:00:00Z') });
      await repo.save(rule, later, record({ nextCheckAt: new Date('2099-06-01T00:10:00Z') }), NOW, tx);
      await repo.save(
        rule,
        due,
        record({ attempts: 2, lastResult: 'error', lastError: 'boom', nextCheckAt: new Date('2099-05-31T23:59:00Z') }),
        NOW,
        tx,
      );

      const got = await repo.candidates(rule, NOW, 50, tx);
      expect(got).toEqual([
        {
          salesOrderId: due,
          prior: { fingerprint: 'fp', mode: 'act', attempts: 2, lastResult: 'error', lastError: 'boom', gaveUpAt: null },
        },
      ]);
    });
  });

  it('save 는 upsert 하고 first_seen_at 은 처음 값을 지킨다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const rule = ruleFor(state);
      const id = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      await repo.save(rule, id, record(), new Date('2099-01-01T00:00:00Z'), tx);
      await repo.save(rule, id, record({ attempts: 2 }), new Date('2099-01-02T00:00:00Z'), tx);

      const rows = await tx.select().from(wmsTables.orderReconcileState);
      const ours = rows.filter((r) => r.salesOrderId === id);
      expect(ours).toHaveLength(1);
      expect(ours[0]).toMatchObject({
        rule: rule.name,
        trackingRow: 99,
        attempts: 2,
        firstSeenAt: new Date('2099-01-01T00:00:00Z'),
        updatedAt: new Date('2099-01-02T00:00:00Z'),
      });
    });
  });

  it('deleteDeparted 는 그 규칙의 상황을 떠난 주문 행만 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const rule = ruleFor(state);
      const stays = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      const left = await seedProgress(tx, { stage: 'reserve', state: 'created', enteredAt: new Date('2000-01-01T00:00:00Z') });
      const closed = await seedProgress(tx, { stage: null, state, outcome: 'delivered', enteredAt: new Date('2000-01-01T00:00:00Z') });
      for (const id of [stays, left, closed]) await repo.save(rule, id, record(), NOW, tx);

      expect(await repo.deleteDeparted(rule, tx)).toBe(2);
      const remaining = (await tx.select().from(wmsTables.orderReconcileState)).filter((r) => r.rule === rule.name);
      expect(remaining.map((r) => r.salesOrderId)).toEqual([stays]);
    });
  });
});
```

- [ ] **Step 5: 실패를 확인한다**

Run: `npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.integration.spec.ts`
Expected: FAIL — `Cannot find module './order-reconcile.repository'` (러너가 마이그를 먼저 적용하므로 테이블은 이미 있다)

- [ ] **Step 6: 저장소를 구현한다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.ts
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ReconcileRuleRef } from './order-reconcile.rule';
import { ReconcilePrior, ReconcileRecord, isReconcileMode, isReconcileResult } from './order-reconcile.state';

export type ReconcileCandidate = { salesOrderId: string; prior: ReconcilePrior | null };

/** 리컨실러 상태 저장소(스펙 §4.3·§4.5). 후보 선택은 여기에만 있다 — 규칙은 후보 SQL 을 쓰지 않는다(§4.4-1). */
@Injectable()
export class OrderReconcileRepository {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 투영의 진행 중 행 중 규칙의 칸에 있고 볼 때가 된 주문. 종료(셀메이트 출고·취소 등)는 outcome 으로 이미 빠져 있다. */
  async candidates(rule: ReconcileRuleRef, now: Date, limit: number, tx?: DbTx): Promise<ReconcileCandidate[]> {
    const p = wmsTables.orderProgress;
    const s = wmsTables.orderReconcileState;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          salesOrderId: p.salesOrderId,
          fingerprint: s.fingerprint,
          mode: s.mode,
          attempts: s.attempts,
          lastResult: s.lastResult,
          lastError: s.lastError,
          gaveUpAt: s.gaveUpAt,
        })
        .from(p)
        .leftJoin(s, and(eq(s.rule, rule.name), eq(s.salesOrderId, p.salesOrderId)))
        .where(
          and(
            isNull(p.outcome),
            eq(p.stage, rule.situation.stage),
            inArray(p.state, [...rule.situation.states]),
            or(isNull(s.salesOrderId), lte(s.nextCheckAt, now)),
          ),
        )
        .orderBy(asc(p.stageEnteredAt), asc(p.salesOrderId))
        .limit(limit);
      return rows.map((r) => ({ salesOrderId: r.salesOrderId, prior: toPrior(r) }));
    }, tx);
  }

  /** 그 규칙의 상황을 떠난 주문의 행을 지운다 — «해결됨». 지운 행 수를 낸다. */
  async deleteDeparted(rule: ReconcileRuleRef, tx?: DbTx): Promise<number> {
    const p = wmsTables.orderProgress;
    const s = wmsTables.orderReconcileState;
    return this.dbService.run(async (trx) => {
      const deleted = await trx
        .delete(s)
        .where(
          and(
            eq(s.rule, rule.name),
            sql`NOT EXISTS (
              SELECT 1 FROM ${p}
               WHERE ${p.salesOrderId} = ${s.salesOrderId}
                 AND ${p.outcome} IS NULL
                 AND ${p.stage} = ${rule.situation.stage}
                 AND ${inArray(p.state, [...rule.situation.states])}
            )`,
          ),
        )
        .returning({ salesOrderId: s.salesOrderId });
      return deleted.length;
    }, tx);
  }

  async save(rule: ReconcileRuleRef, salesOrderId: string, record: ReconcileRecord, now: Date, tx?: DbTx): Promise<void> {
    const s = wmsTables.orderReconcileState;
    const values = {
      trackingRow: rule.row,
      fingerprint: record.fingerprint,
      mode: record.mode,
      attempts: record.attempts,
      lastResult: record.lastResult,
      lastError: record.lastError,
      nextCheckAt: record.nextCheckAt,
      gaveUpAt: record.gaveUpAt,
      updatedAt: now,
    };
    await this.dbService.run(
      (trx) =>
        trx
          .insert(s)
          .values({ rule: rule.name, salesOrderId, firstSeenAt: now, ...values })
          .onConflictDoUpdate({ target: [s.rule, s.salesOrderId], set: values }),
      tx,
    );
  }
}

function toPrior(r: {
  fingerprint: string | null;
  mode: string | null;
  attempts: number | null;
  lastResult: string | null;
  lastError: string | null;
  gaveUpAt: Date | null;
}): ReconcilePrior | null {
  // 모르는 모드·결과 값(손으로 고친 행 등)은 이전 상태가 없는 것으로 본다 — 처음부터 다시 센다
  if (r.fingerprint === null || r.mode === null || r.lastResult === null || r.attempts === null) return null;
  if (!isReconcileMode(r.mode) || !isReconcileResult(r.lastResult)) return null;
  return {
    fingerprint: r.fingerprint,
    mode: r.mode,
    attempts: r.attempts,
    lastResult: r.lastResult,
    lastError: r.lastError,
    gaveUpAt: r.gaveUpAt,
  };
}
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.integration.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: 스펙 §4.5 표에 `tracking_row` 를 더한다**

`docs/superpowers/specs/2026-10-08-order-reconciler-design.md` §4.5 표의 `sales_order_id` 행 아래에:

```markdown
| `tracking_row` | integer | #1016 행 번호. 정체 보드가 리컨실러 모듈 없이 «자동 멈춤 · #12» 를 그리게 행에 둔다 |
```

- [ ] **Step 9: 타입체크 후 커밋 (스키마·마이그·meta 를 한 커밋에)**

Run: `npm run type-check`
Expected: 에러 0

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle docs/superpowers/specs/2026-10-08-order-reconciler-design.md \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.ts \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.integration.spec.ts
git commit -m "feat(core): 리컨실러 상태 테이블과 저장소 — 후보는 투영에서만 고른다 (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 3: 러너·잡·레지스트리·모듈

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts`
- Modify: `apps/core/src/app.module.ts` (import 목록의 `OrderProgressModule,` 다음 줄)
- Test: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `effectivePrior`·`chooseStep`·`nextRecord`·`RECONCILE_CANDIDATE_LIMIT`·`ReconcilePrior`·`ReconcileStep`, Task 2 의 `OrderReconcileRepository`·`OrderReconcileRule`·`ORDER_RECONCILE_RULES`
- Produces:
  - `type RuleRunSummary = { rule: string; departed: number; acted: number; wouldAct: number; notNeeded: number; gaveUp: number; errors: number }`
  - `class OrderReconcileRunner { runAll(now: Date): Promise<RuleRunSummary[]>; runRule(rule: OrderReconcileRule, now: Date, tx?: DbTx): Promise<RuleRunSummary>; }` — 생성자 `(dbService: DbService<typeof wmsSchema>, repository: OrderReconcileRepository, rules: OrderReconcileRule[])`
  - `class OrderReconcileJob { tick(): Promise<void>; runOnce(now?: Date): Promise<'ran' | 'skipped' | 'failed'>; }` — 생성자 `(runner: OrderReconcileRunner)`
  - `ORDER_RECONCILE_RULE_CLASSES: Type<OrderReconcileRule>[]` (이 태스크에선 빈 배열)
  - `class OrderReconcileModule`

- [ ] **Step 1: 실패하는 러너 통합 테스트를 쓴다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { OrderReconcileRule } from './order-reconcile.rule';
import { OrderReconcileRunner } from './order-reconcile.runner';
import { ReconcileMode } from './order-reconcile.state';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function seedProgress(tx: DbTx, args: { stage: string | null; state: string; outcome?: string | null }) {
  const o = await f.seedOrder(tx);
  const at = new Date('2000-01-01T00:00:00Z');
  await tx.insert(wmsTables.orderProgress).values({
    salesOrderId: o.salesOrderId,
    salesChannel: 'medusa',
    orderedAt: at,
    stage: args.stage,
    state: args.state,
    stageEnteredAt: at,
    outcome: args.outcome ?? null,
    closedAt: args.outcome ? at : null,
    evaluatedAt: at,
  });
  return o.salesOrderId;
}

function fakeRule(state: string, mode: ReconcileMode, act: (id: string) => Promise<void>) {
  const rule: OrderReconcileRule = {
    name: `it-runner-${state}`,
    row: 99,
    mode,
    situation: { stage: 'fo', states: [state] },
    fingerprint: jest.fn(async () => 'fp'),
    check: jest.fn(async () => true),
    act: jest.fn(async (id: string) => act(id)),
  };
  return rule;
}

describeIfDb('OrderReconcileRunner (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end();
  });
  const NOW = new Date('2099-06-01T00:00:00.000Z');
  const statesOf = async (tx: DbTx, rule: string) =>
    new Map(
      (await tx.select().from(wmsTables.orderReconcileState))
        .filter((r) => r.rule === rule)
        .map((r) => [r.salesOrderId, r]),
    );

  it('종료된 주문(셀메이트 출고)은 고르지 않는다 — backlog 가 awaiting_matching 이어도', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const shipped = await seedProgress(tx, { stage: null, state, outcome: 'external_shipped' });
      await f.seedBacklog(tx, shipped, 'awaiting_matching');
      const rule = fakeRule(state, 'act', async () => undefined);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).not.toHaveBeenCalled();
      expect(summary.acted).toBe(0);
      expect((await statesOf(tx, rule.name)).size).toBe(0);
    });
  });

  it('한 후보의 act 예외가 다른 후보를 막지 않고, 실패 행엔 error 가 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const bad = await seedProgress(tx, { stage: 'fo', state });
      const good = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async (id) => {
        if (id === bad) throw new Error('boom');
      });
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(summary).toMatchObject({ acted: 1, errors: 1 });
      const rows = await statesOf(tx, rule.name);
      expect(rows.get(bad)).toMatchObject({ lastResult: 'error', lastError: 'boom', attempts: 1 });
      expect(rows.get(good)).toMatchObject({ lastResult: 'acted', attempts: 1 });
    });
  });

  it('관찰 모드는 act 를 부르지 않고 would_act 를 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'observe', async () => undefined);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).not.toHaveBeenCalled();
      expect(summary.wouldAct).toBe(1);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'would_act', mode: 'observe', attempts: 0 });
    });
  });

  it('check 가 false 면 not_needed 로 남기고 act 하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => undefined);
      (rule.check as jest.Mock).mockResolvedValue(false);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).not.toHaveBeenCalled();
      expect(summary.notNeeded).toBe(1);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'not_needed', attempts: 0 });
    });
  });

  it('상황을 떠난 주문의 행은 다음 바퀴에 지워진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => undefined);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);
      await runner.runRule(rule, NOW, tx);
      await tx
        .update(wmsTables.orderProgress)
        .set({ stage: 'reserve', state: 'created' })
        .where(eq(wmsTables.orderProgress.salesOrderId, id));

      const summary = await runner.runRule(rule, new Date('2099-06-01T01:00:00.000Z'), tx);

      expect(summary.departed).toBe(1);
      expect((await statesOf(tx, rule.name)).size).toBe(0);
    });
  });
});

```

- [ ] **Step 2: 실패하는 잡 단위 테스트를 쓴다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.spec.ts
import { OrderReconcileJob } from './order-reconcile.job';

describe('OrderReconcileJob', () => {
  it('앞 실행이 끝나기 전 틱은 건너뛴다', async () => {
    let release: () => void = () => undefined;
    const runner = {
      runAll: jest.fn(
        () =>
          new Promise<never[]>((resolve) => {
            release = () => resolve([]);
          }),
      ),
    };
    const job = new OrderReconcileJob(runner as never);
    const first = job.runOnce();
    expect(await job.runOnce()).toBe('skipped');
    release();
    expect(await first).toBe('ran');
  });

  it('실패는 로그만 남기고 failed 를 낸다', async () => {
    const runner = { runAll: jest.fn().mockRejectedValue(new Error('db down')) };
    const job = new OrderReconcileJob(runner as never);
    expect(await job.runOnce()).toBe('failed');
    expect(await job.runOnce()).toBe('failed'); // 플래그가 풀렸다
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.spec.ts`
Expected: FAIL — `Cannot find module './order-reconcile.job'`

Run: `npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts`
Expected: FAIL — `Cannot find module './order-reconcile.runner'`

- [ ] **Step 4: 러너를 구현한다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { ORDER_RECONCILE_RULES, OrderReconcileRule } from './order-reconcile.rule';
import {
  RECONCILE_CANDIDATE_LIMIT,
  ReconcilePrior,
  ReconcileStep,
  chooseStep,
  effectivePrior,
  nextRecord,
} from './order-reconcile.state';

export type RuleRunSummary = {
  rule: string;
  departed: number;
  acted: number;
  wouldAct: number;
  notNeeded: number;
  gaveUp: number;
  errors: number;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 리컨실러 한 바퀴(스펙 §4.3). 후보 하나 = savepoint 하나 — 한 주문의 실패가 다른 주문을 막지 않는다(#1016 1번 행의 교훈).
 * 규칙 하나가 통째로 실패하면 그 규칙만 건너뛴다.
 */
@Injectable()
export class OrderReconcileRunner {
  private readonly logger = new Logger(OrderReconcileRunner.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly repository: OrderReconcileRepository,
    @Inject(ORDER_RECONCILE_RULES) private readonly rules: OrderReconcileRule[],
  ) {}

  async runAll(now: Date): Promise<RuleRunSummary[]> {
    const out: RuleRunSummary[] = [];
    for (const rule of this.rules) {
      try {
        out.push(await this.runRule(rule, now));
      } catch (error) {
        this.logger.error(
          `order-reconcile rule ${rule.name} failed: ${messageOf(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return out;
  }

  async runRule(rule: OrderReconcileRule, now: Date, tx?: DbTx): Promise<RuleRunSummary> {
    const summary: RuleRunSummary = {
      rule: rule.name,
      departed: await this.repository.deleteDeparted(rule, tx),
      acted: 0,
      wouldAct: 0,
      notNeeded: 0,
      gaveUp: 0,
      errors: 0,
    };
    const candidates = await this.repository.candidates(rule, now, RECONCILE_CANDIDATE_LIMIT, tx);
    for (const candidate of candidates) {
      const step = await this.reconcileOne(rule, candidate.salesOrderId, candidate.prior, now, tx);
      if (step === 'act') summary.acted++;
      else if (step === 'would_act') summary.wouldAct++;
      else if (step === 'not_needed') summary.notNeeded++;
      else if (step === 'give_up') summary.gaveUp++;
      else summary.errors++;
    }
    const touched =
      summary.departed + summary.acted + summary.wouldAct + summary.notNeeded + summary.gaveUp + summary.errors;
    if (touched > 0) {
      this.logger.log(
        `order-reconcile ${rule.name}(#${rule.row}, ${rule.mode}): acted=${summary.acted} would_act=${summary.wouldAct} ` +
          `not_needed=${summary.notNeeded} gave_up=${summary.gaveUp} error=${summary.errors} departed=${summary.departed}`,
      );
    }
    return summary;
  }

  private async reconcileOne(
    rule: OrderReconcileRule,
    salesOrderId: string,
    prior: ReconcilePrior | null,
    now: Date,
    tx?: DbTx,
  ): Promise<ReconcileStep | 'error'> {
    try {
      return await this.dbService.run(
        (trx) =>
          trx.transaction(async (sp) => {
            const fingerprint = await rule.fingerprint(salesOrderId, sp);
            const eff = effectivePrior(prior, fingerprint, rule.mode);
            const step = chooseStep(eff, rule.mode, await rule.check(salesOrderId, sp));
            if (step === 'act') await rule.act(salesOrderId, sp);
            if (step === 'would_act' && (prior?.lastResult !== 'would_act' || prior.fingerprint !== fingerprint)) {
              // 관찰 기록은 처음 볼 때만 로그 — 매분 같은 줄이 쌓이지 않게
              this.logger.log(`order-reconcile ${rule.name} would act on sales order ${salesOrderId}`);
            }
            await this.repository.save(
              rule,
              salesOrderId,
              nextRecord(eff, { fingerprint, mode: rule.mode, step, outcome: step === 'act' ? 'acted' : undefined }, now),
              now,
              sp,
            );
            return step;
          }),
        tx,
      );
    } catch (error) {
      // 지문을 못 구했으면 이전 지문으로 센다 — 같은 예외가 매분 반복돼도 백오프가 걸리게
      const fingerprint = prior?.fingerprint ?? '';
      const eff = effectivePrior(prior, fingerprint, rule.mode);
      await this.dbService.run(
        (trx) =>
          this.repository.save(
            rule,
            salesOrderId,
            nextRecord(eff, { fingerprint, mode: rule.mode, step: 'act', outcome: 'error', error: messageOf(error) }, now),
            now,
            trx,
          ),
        tx,
      );
      this.logger.warn(`order-reconcile ${rule.name} failed on sales order ${salesOrderId}: ${messageOf(error)}`);
      return 'error';
    }
  }
}
```

- [ ] **Step 5: 잡·레지스트리·모듈을 만든다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { OrderReconcileRunner } from './order-reconcile.runner';

/**
 * 리컨실러 1분 주기(스펙 §4.3-5). CronOnce 가 주기당 클러스터 한 번을 보장하고, 같은 프로세스 안에서 앞 실행이
 * 1분을 넘기면 다음 틱을 건너뛴다. 실패는 로그만 — 다음 주기가 다시 한다.
 */
@Injectable()
export class OrderReconcileJob {
  private readonly logger = new Logger(OrderReconcileJob.name);
  private running = false;

  constructor(private readonly runner: OrderReconcileRunner) {}

  @CronOnce('* * * * *', { name: 'order-reconcile' })
  async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(now: Date = new Date()): Promise<'ran' | 'skipped' | 'failed'> {
    if (this.running) return 'skipped';
    this.running = true;
    try {
      await this.runner.runAll(now);
      return 'ran';
    } catch (error) {
      this.logger.error(
        `order-reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    } finally {
      this.running = false;
    }
  }
}
```

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts
import { Type } from '@nestjs/common';
import { OrderReconcileRule } from './order-reconcile.rule';

/**
 * 재판정 규칙 목록(스펙 §4.1). #1016 재판정 행을 닫을 때 여기 한 줄을 더하고, 규칙이 쓰는 도메인 모듈을
 * OrderReconcileModule 의 imports 에 더한다.
 */
export const ORDER_RECONCILE_RULE_CLASSES: Type<OrderReconcileRule>[] = [];
```

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts
import { Module } from '@nestjs/common';
import { OrderReconcileJob } from './order-reconcile.job';
import { ORDER_RECONCILE_RULE_CLASSES } from './order-reconcile.registry';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { ORDER_RECONCILE_RULES, OrderReconcileRule } from './order-reconcile.rule';
import { OrderReconcileRunner } from './order-reconcile.runner';

/**
 * 주문 리컨실러(스펙 docs/superpowers/specs/2026-10-08-order-reconciler-design.md). 정체 보드 투영을 읽어
 * 깨우는 신호를 놓친 주문을 다시 판정한다. DbModule 은 전역.
 */
@Module({
  imports: [],
  providers: [
    OrderReconcileRepository,
    OrderReconcileRunner,
    OrderReconcileJob,
    ...ORDER_RECONCILE_RULE_CLASSES,
    {
      provide: ORDER_RECONCILE_RULES,
      useFactory: (...rules: OrderReconcileRule[]) => rules,
      inject: [...ORDER_RECONCILE_RULE_CLASSES],
    },
  ],
})
export class OrderReconcileModule {}
```

`apps/core/src/app.module.ts` 에서 `OrderProgressModule` import 줄 옆에 `import { OrderReconcileModule } from './modules/fulfillment/order-reconcile/order-reconcile.module';` 를 더하고, `imports` 배열의 `OrderProgressModule,` 다음 줄에 `OrderReconcileModule,` 를 더한다.

- [ ] **Step 6: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.spec.ts libs/cron-once`
Expected: PASS (잡 2 tests + cron-once 가드 스펙 — 이름 중복·모듈 누락 위반 없음)

Run: `npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: 타입체크 후 커밋**

Run: `npm run type-check`
Expected: 에러 0

```bash
git add apps/core/src/modules/fulfillment/order-reconcile apps/core/src/app.module.ts
git commit -m "feat(core): 리컨실러 러너·잡 — 후보마다 savepoint, 관찰/실행 모드 (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 4: FO 생성 가드와 «FO 를 만들 수 있는 매칭» 공유 판정

**Files:**
- Create: `apps/core/src/modules/product-matching/fulfillable-matching.ts`
- Test: `apps/core/src/modules/product-matching/fulfillable-matching.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` (`createV2` 의 기존 FO 검사 뒤 · `isVoidMatching`·`getPhysicalSkuLinks` 본문)
- Test: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts`

**Interfaces:**
- Produces:
  - `type MatchingForFulfillment = { status: string; strategy: string | null; links?: ReadonlyArray<{ skuId: string; quantity: number }> } | null | undefined`
  - `isVoidMatching(m: MatchingForFulfillment): boolean`
  - `physicalSkuLinks(m: MatchingForFulfillment): Array<{ skuId: string; quantity: number }>`
  - `isFulfillableMatching(m: MatchingForFulfillment): boolean`
  - `FulfillmentsService.create` 가 판매주문 `shipped`·`delivered` 에 대해 `null` 을 반환(워커는 기존대로 `not_required`)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/core/src/modules/product-matching/fulfillable-matching.spec.ts
import { isFulfillableMatching, isVoidMatching, physicalSkuLinks } from './fulfillable-matching';

describe('fulfillable matching', () => {
  const link = { skuId: 'sku-1', quantity: 2 };

  it.each([
    ['matched + void', { status: 'matched', strategy: 'void', links: [] }, true],
    ['matched + variant + 링크', { status: 'matched', strategy: 'variant', links: [link] }, true],
    ['matched + variant + 링크 0개(숨은 미매칭)', { status: 'matched', strategy: 'variant', links: [] }, false],
    ['matched + variant + links 없음', { status: 'matched', strategy: 'variant' }, false],
    ['pending', { status: 'pending', strategy: null, links: [link] }, false],
    ['ignored', { status: 'ignored', strategy: 'variant', links: [link] }, false],
    ['매칭 없음', null, false],
  ])('%s → %s', (_label, matching, expected) => {
    expect(isFulfillableMatching(matching)).toBe(expected);
  });

  it('void 는 링크 없이도 쓸 수 있고, 물리 링크는 variant 에서만 나온다', () => {
    expect(isVoidMatching({ status: 'matched', strategy: 'void' })).toBe(true);
    expect(physicalSkuLinks({ status: 'matched', strategy: 'void', links: [link] })).toEqual([]);
    expect(physicalSkuLinks({ status: 'matched', strategy: 'variant', links: [link] })).toEqual([link]);
  });
});
```

`fulfillments.service.spec.ts` 의 `'matched + void line만 있는 sales order는 placeholder FO 없이 null을 반환한다'` 테스트 바로 위에:

```ts
  it.each(['shipped', 'delivered'])(
    '셀메이트가 %s 로 표시한 판매주문에는 FO 를 만들지 않고 null 을 반환한다 (#1016 12번)',
    async (salesOrderStatus) => {
      const { service, state, productSkuMapping, shipmentReservation } = makeService({ salesOrderStatus });

      const result = await service.create({ salesOrderId, warehouseId });

      expect(result).toBeNull();
      expect(state.fulfillmentOrders).toHaveLength(0);
      expect(state.fulfillmentOrderItems).toHaveLength(0);
      expect(productSkuMapping.getByVariant).not.toHaveBeenCalled();
      expect(shipmentReservation.reservePartial).not.toHaveBeenCalled();
    },
  );
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/fulfillable-matching.spec.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts`
Expected: FAIL — `Cannot find module './fulfillable-matching'`, 그리고 shipped/delivered 두 케이스가 FO 를 만든다

- [ ] **Step 3: 구현한다**

```ts
// apps/core/src/modules/product-matching/fulfillable-matching.ts
/**
 * «FO 를 만들 수 있는 매칭» 판정. FO 생성과 리컨실러 12번 규칙이 같이 쓴다 — 규칙이 자기 판정을 따로 가지면
 * 워커와 엇갈려 헛돌다 포기만 쌓인다(스펙 2026-10-08-order-reconciler-design §4.4-2).
 * matched + variant + 링크 0개는 쓸 수 없다(숨은 미매칭, 스펙 §1.2).
 */
export type MatchingForFulfillment =
  | { status: string; strategy: string | null; links?: ReadonlyArray<{ skuId: string; quantity: number }> }
  | null
  | undefined;

export function isVoidMatching(matching: MatchingForFulfillment): boolean {
  return matching?.status === 'matched' && matching.strategy === 'void';
}

export function physicalSkuLinks(matching: MatchingForFulfillment): Array<{ skuId: string; quantity: number }> {
  if (matching?.status !== 'matched' || matching.strategy !== 'variant') return [];
  return Array.isArray(matching.links) ? matching.links.map((l) => ({ skuId: l.skuId, quantity: l.quantity })) : [];
}

export function isFulfillableMatching(matching: MatchingForFulfillment): boolean {
  return isVoidMatching(matching) || physicalSkuLinks(matching).length > 0;
}
```

`fulfillments.service.ts`:

1. import 묶음에 `import { isVoidMatching, physicalSkuLinks } from '../../product-matching/fulfillable-matching';` 를 더한다.
2. `private isVoidMatching(matching: VariantSkuMatching): boolean { … }` 본문을 `return isVoidMatching(matching);` 로 바꾼다.
3. `private getPhysicalSkuLinks(matching: VariantSkuMatching): Array<…> { … }` 본문을 `return physicalSkuLinks(matching);` 로 바꾼다.
4. `createV2` 안, `if (existing) return this.getOne(existing.id, trx);` 바로 다음 줄에:

```ts
        // 셀메이트 과도기: 판매주문 status 의 shipped·delivered 는 셀메이트 스크립트가 쓴다(ADR-0017 — core 경로는 쓰지 않음).
        // 이미 나간 주문에 FO 를 만들면 확정 예약·draft 상자가 재고를 묶는다(10-08 실측 3,883개). 판매주문 잠금 아래에서
        // 검사해야 판정 직후 스크립트가 돈 틈까지 막힌다. FO 없이 돌아오면 워커가 backlog 를 not_required 로 닫는다.
        if (salesOrder.status === 'shipped' || salesOrder.status === 'delivered') {
          this.logger.log(
            `Skip FO creation for sales order ${dto.salesOrderId}: already ${salesOrder.status} outside core (sellmate)`,
          );
          return null;
        }
```

(`FulfillmentsService` 에는 이미 `private readonly logger` 가 있다.)

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/fulfillable-matching.spec.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts apps/core/src/modules/fulfillment/services/fulfillment-order-creation-backlog.worker.spec.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 타입체크 후 커밋**

Run: `npm run type-check`
Expected: 에러 0

```bash
git add apps/core/src/modules/product-matching/fulfillable-matching.ts apps/core/src/modules/product-matching/fulfillable-matching.spec.ts \
  apps/core/src/modules/fulfillment/services/fulfillments.service.ts apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts
git commit -m "fix(core): 셀메이트로 출고된 판매주문에는 FO 를 만들지 않는다 (#1016 12번 행)

깨우는 경로(운영자 매칭 해소·리컨실러)가 이미 나간 주문의 backlog 를 깨우면 FO·확정 예약·draft 상자가
생겨 재고를 묶었다(10-08 실측 3,883개). FO 생성의 판매주문 잠금 아래에서 shipped·delivered 를 거른다.
«FO 를 만들 수 있는 매칭» 판정을 product-matching 순수 함수로 꺼내 리컨실러와 공유한다.

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 5: backlog 주문 단위 조회·깨우기

**Files:**
- Modify: `apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.ts` (`findById` 다음 · `wakeBacklogsWaitingForVariant` 다음)
- Test: `apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.spec.ts`

**Interfaces:**
- Produces:
  - `findBySalesOrderId(salesOrderId: string, tx?: DbTx): Promise<FulfillmentOrderCreationBacklog | undefined>`
  - `requeueAwaitingMatching(salesOrderId: string, tx?: DbTx): Promise<number>` — 깨운 행 수(0 또는 1)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`fulfillment-order-creation-backlog.service.spec.ts` 의 `describe` 안 마지막에:

```ts
  it('requeueAwaitingMatching 은 그 주문의 awaiting_matching 행만 pending 으로 되돌린다 (CAS)', async () => {
    const { service, tx, updates } = makeService();

    const n = await service.requeueAwaitingMatching('so-1', tx);

    expect(n).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({
      status: 'pending',
      waitingVariantIds: [],
      failureReason: null,
      failureDetails: null,
      lockedAt: null,
    });
    const whereSql = normalizeSql(updates[0].where);
    expect(whereSql).toMatch(/"sales_order_id" = \$1/);
    expect(whereSql).toMatch(/"status" = \$2/);
  });

  it('requeueAwaitingMatching 은 정비 모드면 아무것도 하지 않는다', async () => {
    const { service, tx, updates, workflowGate } = makeService();
    workflowGate.shouldRunFoCreation.mockReturnValue(false);

    expect(await service.requeueAwaitingMatching('so-1', tx)).toBe(0);
    expect(updates).toHaveLength(0);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.spec.ts`
Expected: FAIL — `service.requeueAwaitingMatching is not a function`

- [ ] **Step 3: 구현한다**

`findById` 다음에:

```ts
  async findBySalesOrderId(salesOrderId: string, tx?: DbTx): Promise<FulfillmentOrderCreationBacklog | undefined> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsTables.fulfillmentOrderCreationBacklogs)
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId))
        .limit(1);
      return row;
    }, tx);
  }
```

`wakeBacklogsWaitingForVariant` 다음에:

```ts
  /**
   * 주문 하나의 매칭 대기를 깨운다 — 리컨실러 12번 규칙 전용(스펙 2026-10-08 §5.3). variant 단위 깨우기는 그 variant 를
   * 기다리는 모든 주문을 깨워, 주문 단위로 횟수를 세는 리컨실러가 자기 대상 밖을 건드리게 된다.
   * 다른 경로가 먼저 깨웠으면 CAS 에 걸려 0 을 낸다.
   */
  async requeueAwaitingMatching(salesOrderId: string, tx?: DbTx): Promise<number> {
    if (!this.workflowGate.shouldRunFoCreation()) {
      return 0;
    }

    return this.dbService.run(async (trx) => {
      const updated = await trx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({
          status: 'pending',
          waitingVariantIds: [],
          failureReason: null,
          failureDetails: null,
          nextAttemptAt: new Date(),
          lockedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId),
            eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'),
          ),
        )
        .returning({ id: wmsTables.fulfillmentOrderCreationBacklogs.id });
      return updated.length;
    }, tx);
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.ts apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service.spec.ts
git commit -m "feat(core): backlog 를 주문 하나 단위로 조회·깨운다 (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 6: 12번 규칙 `wake-awaiting-matching`

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts` (imports)
- Test: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 `OrderReconcileRule`, Task 3 `OrderReconcileRunner`·`OrderReconcileRepository`, Task 4 `isFulfillableMatching`, Task 5 `findBySalesOrderId`·`requeueAwaitingMatching`, 기존 `ProductSkuMappingService.getByVariant(variantId, tx?)`, `FulfillmentWorkflowGate.shouldRunFoCreation()`
- Produces: `class WakeAwaitingMatchingRule implements OrderReconcileRule` — 생성자 `(backlog: FulfillmentOrderCreationBacklogService, workflowGate: FulfillmentWorkflowGate, skuMapping: ProductSkuMappingService)`, `name = 'wake-awaiting-matching'`, `row = 12`, `mode = 'observe'`

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService, seedMatching, wireLogistics } from '../../services/__support__';
import * as f from '../../order-progress/__support__/order-progress.fixtures';
import { OrderProgressManager } from '../../order-progress/order-progress.manager';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { OrderReconcileRepository } from '../order-reconcile.repository';
import { OrderReconcileRunner } from '../order-reconcile.runner';
import { ReconcileMode } from '../order-reconcile.state';
import { WakeAwaitingMatchingRule } from './wake-awaiting-matching.rule';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const gate = (mode: 'v2' | 'maintenance') =>
  new FulfillmentWorkflowGate(
    new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode, FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z' }),
  );

/** 매칭 대기 주문 하나: 라인 variant 하나, backlog awaiting_matching(그 variant 를 기다림). */
async function seedAwaiting(tx: DbTx, waiting: unknown = undefined) {
  const order = await f.seedOrder(tx, { status: 'confirmed', createdAt: new Date('2000-01-01T00:00:00Z') });
  const [line] = await tx
    .select({ variantId: wmsTables.salesOrderLines.variantId })
    .from(wmsTables.salesOrderLines)
    .where(eq(wmsTables.salesOrderLines.salesOrderId, order.salesOrderId));
  await tx.insert(wmsTables.fulfillmentOrderCreationBacklogs).values({
    salesOrderId: order.salesOrderId,
    status: 'awaiting_matching',
    waitingVariantIds: waiting === undefined ? [line.variantId] : waiting,
    // 투영의 fo 진입 시각 추정이 backlog created_at 이다 — 아주 오래되게 해 다른 행보다 먼저 고르게 한다
    createdAt: new Date('2000-01-01T00:00:00Z'),
  });
  return { salesOrderId: order.salesOrderId, variantId: line.variantId };
}

async function backlogStatus(tx: DbTx, salesOrderId: string) {
  const [row] = await tx
    .select({ status: wmsTables.fulfillmentOrderCreationBacklogs.status })
    .from(wmsTables.fulfillmentOrderCreationBacklogs)
    .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId));
  return row?.status;
}

describeIfDb('WakeAwaitingMatchingRule (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  function wire(mode: 'v2' | 'maintenance' = 'v2') {
    const dbs = makeDbService(db);
    const w = wireLogistics(dbs);
    const rule = new WakeAwaitingMatchingRule(w.backlog, gate(mode), w.productSkuMapping);
    return { dbs, w, rule };
  }

  it('기다리던 variant 가 모두 쓸 수 있게 매칭되면 check true → act 가 pending 으로 깨운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });

      expect(await rule.check(o.salesOrderId, tx)).toBe(true);
      await rule.act(o.salesOrderId, tx);
      expect(await backlogStatus(tx, o.salesOrderId)).toBe('pending');
    });
  });

  it('하나라도 미매칭이면 not_needed(check false)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const o = await seedAwaiting(tx);
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('링크 0개 매칭을 기다리면 not_needed — 깨우면 워커가 곧장 되돌려 헛돈다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const o = await seedAwaiting(tx);
      await tx
        .insert(wmsTables.productMatchings)
        .values({ variantId: o.variantId, status: 'matched', strategy: 'variant', isResolved: true });
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('기다리는 variant 가 비었거나 배열이 아니면 not_needed', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const empty = await seedAwaiting(tx, []);
      const garbage = await seedAwaiting(tx, { not: 'an array' });
      expect(await rule.check(empty.salesOrderId, tx)).toBe(false);
      expect(await rule.check(garbage.salesOrderId, tx)).toBe(false);
    });
  });

  it('backlog 가 이미 awaiting_matching 이 아니면(투영이 늦음) not_needed', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'pending' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, o.salesOrderId));
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('정비 모드면 not_needed — 일시적 막힘은 시도로 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire('maintenance');
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('지문은 매칭을 고치면 바뀐다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      const before = await rule.fingerprint(o.salesOrderId, tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      await tx
        .update(wmsTables.productMatchings)
        .set({ updatedAt: new Date('2099-01-01T00:00:00Z') })
        .where(eq(wmsTables.productMatchings.variantId, o.variantId));
      expect(await rule.fingerprint(o.salesOrderId, tx)).not.toBe(before);
    });
  });

  it('투영 → 러너 → 규칙 끝까지: 실행 모드면 깨우고, 관찰 모드면 그대로 둔다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { dbs, w, rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      const now = new Date('2099-06-01T00:00:00.000Z');
      await new OrderProgressManager(dbs).refreshScope(sql`SELECT ${o.salesOrderId}::uuid`, now, tx);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      // 첫 배포 모드(observe): 깨우지 않는다
      const observed = await runner.runRule(rule, now, tx);
      expect(observed.wouldAct).toBeGreaterThanOrEqual(1);
      expect(await backlogStatus(tx, o.salesOrderId)).toBe('awaiting_matching');

      // 실행 모드로 바꾼 규칙(PR 로 mode 만 바뀐 상태를 흉내)
      class ActingRule extends WakeAwaitingMatchingRule {
        readonly mode: ReconcileMode = 'act';
      }
      const acting = new ActingRule(w.backlog, gate('v2'), w.productSkuMapping);
      const acted = await runner.runRule(acting, new Date('2099-06-01T00:11:00.000Z'), tx);
      expect(acted.acted).toBeGreaterThanOrEqual(1);
      expect(await backlogStatus(tx, o.salesOrderId)).toBe('pending');
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts`
Expected: FAIL — `Cannot find module './wake-awaiting-matching.rule'`

- [ ] **Step 3: 규칙을 구현한다**

```ts
// apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { isFulfillableMatching } from '../../../product-matching/fulfillable-matching';
import { ProductSkuMappingService } from '../../../product-matching/services/product-sku-mapping.service';
import { FulfillmentOrderCreationBacklogService } from '../../backlog/fulfillment-order-creation-backlog.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { OrderReconcileRule } from '../order-reconcile.rule';
import { ReconcileMode } from '../order-reconcile.state';

/**
 * #1016 12번 행: 매칭이 바뀌었는데 깨우는 신호를 놓쳐 잠든 매칭 대기 주문을 깨운다(스펙 2026-10-08 §5.4).
 * changeMatchingStrategy 등 wake 를 부르지 않는 경로가 원인이다 — 그 경로에 wake 를 더하지 않고 여기서 보장한다(D4).
 */
@Injectable()
export class WakeAwaitingMatchingRule implements OrderReconcileRule {
  readonly name = 'wake-awaiting-matching';
  readonly row = 12;
  // 첫 배포는 관찰. 거짓 양성 0건을 확인한 뒤 PR 로 'act' 로 바꾼다(스펙 §7)
  readonly mode: ReconcileMode = 'observe';
  readonly situation = { stage: 'fo' as const, states: ['awaiting_matching'] };

  constructor(
    private readonly backlog: FulfillmentOrderCreationBacklogService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly skuMapping: ProductSkuMappingService,
  ) {}

  /** 기다리는 variant 목록 + 그 매칭들의 최종 수정 시각. 운영자가 매칭을 손보면 바뀌어 횟수·포기가 리셋된다. */
  async fingerprint(salesOrderId: string, tx: DbTx): Promise<string> {
    const ids = await this.waitingVariantIds(salesOrderId, tx);
    let latest = '';
    for (const id of ids) {
      const matching = await this.skuMapping.getByVariant(id, tx);
      const at = matching?.updatedAt ? matching.updatedAt.toISOString() : '';
      if (at > latest) latest = at;
    }
    return `${ids.join(',')}|${latest}`;
  }

  async check(salesOrderId: string, tx: DbTx): Promise<boolean> {
    // 정비 모드는 몇 시간 이어질 수 있다 — 시도로 세면 포기가 잘못 찍힌다(§4.4-5)
    if (!this.workflowGate.shouldRunFoCreation()) return false;
    const backlog = await this.backlog.findBySalesOrderId(salesOrderId, tx);
    if (!backlog || backlog.status !== 'awaiting_matching') return false;
    const ids = parseVariantIds(backlog.waitingVariantIds);
    if (ids.length === 0) return false;
    for (const id of ids) {
      if (!isFulfillableMatching(await this.skuMapping.getByVariant(id, tx))) return false;
    }
    return true;
  }

  async act(salesOrderId: string, tx: DbTx): Promise<void> {
    await this.backlog.requeueAwaitingMatching(salesOrderId, tx);
  }

  private async waitingVariantIds(salesOrderId: string, tx: DbTx): Promise<string[]> {
    const backlog = await this.backlog.findBySalesOrderId(salesOrderId, tx);
    return backlog ? parseVariantIds(backlog.waitingVariantIds) : [];
  }
}

/** jsonb 라 형식이 보장되지 않는다 — 문자열만 골라 정렬한다(지문이 순서에 흔들리지 않게). */
function parseVariantIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string'))].sort();
}
```

레지스트리:

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts
import { Type } from '@nestjs/common';
import { OrderReconcileRule } from './order-reconcile.rule';
import { WakeAwaitingMatchingRule } from './rules/wake-awaiting-matching.rule';

/**
 * 재판정 규칙 목록(스펙 §4.1). #1016 재판정 행을 닫을 때 여기 한 줄을 더하고, 규칙이 쓰는 도메인 모듈을
 * OrderReconcileModule 의 imports 에 더한다.
 */
export const ORDER_RECONCILE_RULE_CLASSES: Type<OrderReconcileRule>[] = [
  WakeAwaitingMatchingRule, // #1016 12번
];
```

모듈 `imports: []` 를 다음으로 바꾸고 import 문 두 줄을 더한다:

```ts
import { ProductMatchingModule } from '../../product-matching/product-matching.module';
import { FulfillmentOrderCreationBacklogModule } from '../backlog/fulfillment-order-creation-backlog.module';
// …
  imports: [FulfillmentOrderCreationBacklogModule, ProductMatchingModule],
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-reconcile`
Expected: PASS (저장소 4 + 러너 5 + 규칙 8)

- [ ] **Step 5: 앱 부팅 DI 를 확인한다**

Run: `npm run build` 후 `npm run start:main:dev` 를 띄워 로그에 `Nest application successfully started` 가 나오고 `order-reconcile` 관련 DI 에러가 없는지 본다(로컬 core DB 필요). 1~2분 기다려 에러 로그 없이 지나가면 끈다.
Expected: DI 에러 0. `UnknownDependenciesException` 이 나면 모듈 imports 를 고친다.

- [ ] **Step 6: 타입체크 후 커밋**

Run: `npm run type-check`
Expected: 에러 0

```bash
git add apps/core/src/modules/fulfillment/order-reconcile
git commit -m "feat(core): 매칭 대기 주문 깨우기 규칙 — 관찰 모드로 시작 (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 7: 링크 0개 매칭을 만드는 두 명령 막기

**Files:**
- Modify: `apps/core/src/modules/product-matching/services/product-matching.service.ts` (`changeMatchingStrategy` 맨 앞)
- Test: `apps/core/src/modules/product-matching/services/product-matching.service.spec.ts`
- Modify: `apps/core/src/modules/product-matching/services/product-sku-mapping.service.ts` (`upsert` 안 `isPolicyOnlySave` 블록 다음)
- Test: `apps/core/src/modules/product-matching/services/product-sku-mapping.service.spec.ts` (`'removes existing SKU links when an existing matching is saved with empty links'` 교체)

**Interfaces:**
- Produces: `changeMatchingStrategy(id, 'variant')` → `BadRequestError`. `upsert(variantId, { links: [] , … })`(기존 링크 있음) → 매칭 `pending`/`strategy NULL`/`isResolved false`, 링크 삭제, wake 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-matching.service.spec.ts` 맨 위 import 에 `import { BadRequestError } from '@app/shared';` 를 더하고, `describe('ProductMatchingService strategy semantics', …)` 안 마지막에:

```ts
  it('variant 로의 전략 변경은 거절한다 — 링크 없이 variant 가 되면 숨은 미매칭이 생긴다 (#1016 12번)', async () => {
    const { service } = makeService();
    const tx = makeTx([[{ ...matching, status: 'matched', strategy: 'void' }]]);

    await expect(service.changeMatchingStrategy(matching.id, 'variant', tx as never)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(tx.updates).toHaveLength(0);
    expect(tx.deletes).toHaveLength(0);
  });

  it('variant → variant 요청도 거절한다 — 옛 전략 delete 가 링크를 지우던 길', async () => {
    const { service } = makeService();
    const tx = makeTx([[{ ...matching, status: 'matched', strategy: 'variant' }]]);

    await expect(service.changeMatchingStrategy(matching.id, 'variant', tx as never)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(tx.deletes).toHaveLength(0);
  });
```

`product-sku-mapping.service.spec.ts` 의 `it('removes existing SKU links when an existing matching is saved with empty links', …)` 를 통째로 다음으로 바꾼다 — 준비(`matching`·`links`·`tx`·`dbService`·`service` 구성)는 기존 그대로 두고 이름과 단언만 바꾼다:

```ts
  it('기존 링크를 빈 links 로 모두 지우면 pending 으로 내린다 — matched+variant+링크 0개를 쓰지 않는다 (#1016 12번)', async () => {
    // … (기존 준비 코드 그대로) …

    await service.upsert(variantId, {
      links: [],
      policy: {
        preStockSellable: true,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
    } as any);

    expect(tx.delete).toHaveBeenCalledWith(wmsTables.productVariantSkuLinks);
    expect(tx.insert).not.toHaveBeenCalledWith(wmsTables.productVariantSkuLinks);
    expect(updates.find((entry) => entry.table === wmsTables.productMatchings)?.set).toMatchObject({
      status: 'pending',
      strategy: null,
      isResolved: false,
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(variantId, tx);
    // pending 은 FO 를 만들 수 없는 매칭이라 깨울 대상이 없다
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).not.toHaveBeenCalled();
    expect(salesVariantPolicy).toMatchObject({ availabilityOverride: 'manual_out_of_stock' });
  });
```

(기존 테스트 본문의 `as any` 는 이 파일의 기존 관례다 — 바꾸지 않는다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching/services`
Expected: FAIL — 새 세 테스트

- [ ] **Step 3: 구현한다**

`product-matching.service.ts` import 에 `import { BadRequestError } from '@app/shared';` 를 더하고, `changeMatchingStrategy` 본문 맨 앞에:

```ts
    // variant 는 SKU 링크와 한 몸이다 — 링크 없이 전략만 바꾸면 matched+variant+링크 0개(숨은 미매칭)가 남고,
    // variant→variant 는 옛 전략 delete 가 링크를 지운다. variant 는 링크와 함께 upsert 로만 만든다(#1016 12번, 스펙 §5.5).
    // 컨트롤러가 메시지의 'required' 로 400 에 매핑한다.
    if (newStrategy === 'variant') {
      throw new BadRequestError(
        'SKU links are required for variant strategy — save the matching with links via PUT /matchings/:variantId',
      );
    }
```

`product-sku-mapping.service.ts` 의 `upsert` 안, `if (isPolicyOnlySave) { … }` 블록 바로 다음에:

```ts
        if (isClearingExistingLinks && existing) {
          // 연결을 전부 지우면 «더는 매칭되지 않음»이다. matched+variant+링크 0개는 판매·출고에서 미매칭처럼 동작하면서
          // 화면엔 매칭됨으로 보여 운영자가 고칠 기회가 없다 — pending 으로 내려 매칭 작업 목록에 다시 띄운다(#1016 12번, 스펙 §5.5).
          const now = new Date();
          await trx
            .delete(wmsTables.productVariantSkuLinks)
            .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, existing.id));
          await trx
            .update(wmsTables.productMatchings)
            .set({ status: 'pending', strategy: null, isResolved: false, updatedAt: now })
            .where(eq(wmsTables.productMatchings.id, existing.id));
          if (dto.policy !== undefined) {
            await this.upsertSalesVariantPolicy(
              trx,
              variantId,
              dto.policy,
              {
                preStockSellable: existing.preStockSellable,
                alwaysSellableZeroStock: existing.alwaysSellableZeroStock,
              },
              now,
            );
          }
          await this.productSellableQuantity.recalculateAndPublishForVariant(variantId, trx);
          return this.getByVariant(variantId, trx);
        }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/product-matching`
Expected: PASS (기존 테스트 포함)

- [ ] **Step 5: 타입체크 후 커밋**

Run: `npm run type-check`
Expected: 에러 0

```bash
git add apps/core/src/modules/product-matching/services
git commit -m "fix(core): 링크 0개 매칭을 만드는 두 길을 막는다 — variant 전략 변경 거절, 빈 링크 저장은 pending (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 8: 정체 보드 API 에 «자동 멈춤»

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/dto/order-progress-response.dto.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.board.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 `wmsTables.orderReconcileState`
- Produces:
  - `SummaryRow = { stage; state; open; stuck; gaveUp: number; oldest }`, `StageSummary.gaveUp: number`, `states[].gaveUp: number`
  - `OrderProgressItem.gaveUp: Array<{ rule: string; row: number; since: string; lastError: string | null }>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`order-progress.summary.spec.ts` 의 두 번째 테스트(«세부 상태를 단계로 합치고…»)를 다음으로 바꾸고, 나머지 테스트의 입력 행에는 `gaveUp: 0` 을 더한다:

```ts
  it('세부 상태를 단계로 합치고 최장(가장 이른) 진입 시각을 고른다', () => {
    const out = assembleSummary(
      [
        { stage: 'fo', state: 'awaiting_matching', open: 10, stuck: 9, gaveUp: 2, oldest: '2026-07-16T00:00:00.000Z' },
        { stage: 'fo', state: 'failed', open: 2, stuck: 2, gaveUp: 0, oldest: '2026-09-01T00:00:00.000Z' },
      ],
      '2026-10-06T00:00:00.000Z',
    );
    const fo = out.stages.find((s) => s.stage === 'fo')!;
    expect(fo).toEqual({
      stage: 'fo',
      open: 12,
      stuck: 11,
      gaveUp: 2,
      oldestEnteredAt: '2026-07-16T00:00:00.000Z',
      states: [
        { state: 'awaiting_matching', open: 10, stuck: 9, gaveUp: 2 },
        { state: 'failed', open: 2, stuck: 2, gaveUp: 0 },
      ],
    });
    expect(out.evaluatedAt).toBe('2026-10-06T00:00:00.000Z');
  });
```

첫 테스트의 단언에 `&& s.gaveUp === 0` 을 더한다.

`order-progress.board.integration.spec.ts` 의 `describeIfDb` 안 마지막에:

```ts
  it('리컨실러가 포기한 주문은 요약·목록에 «자동 멈춤»으로 나온다', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const dbs = makeDbService(db);
        const manager = new OrderProgressManager(dbs);
        const reader = new OrderProgressReader(dbs);
        const now = new Date('2099-01-01T00:00:00.000Z');
        const o = await f.seedOrder(tx);
        await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', new Date('2098-10-11T00:00:00.000Z'));
        await manager.refreshScope(sql`SELECT ${o.salesOrderId}::uuid`, now, tx);
        await tx.insert(wmsTables.orderReconcileState).values({
          rule: 'wake-awaiting-matching',
          salesOrderId: o.salesOrderId,
          trackingRow: 12,
          fingerprint: 'fp',
          mode: 'act',
          attempts: 5,
          lastResult: 'error',
          lastError: 'boom',
          nextCheckAt: now,
          gaveUpAt: new Date('2098-12-31T00:00:00.000Z'),
          firstSeenAt: now,
          updatedAt: now,
        });

        const page = await reader.listOrders({ stage: 'fo', sort: 'dwell', limit: 200 }, now, tx);
        const item = page.items.find((i) => i.salesOrderId === o.salesOrderId)!;
        expect(item.gaveUp).toEqual([
          { rule: 'wake-awaiting-matching', row: 12, since: '2098-12-31T00:00:00.000Z', lastError: 'boom' },
        ]);
        const summary = await reader.summary(now, tx);
        const fo = summary.stages.find((s) => s.stage === 'fo')!;
        expect(fo.gaveUp).toBeGreaterThanOrEqual(1);
        expect(fo.states.find((s) => s.state === 'awaiting_matching')!.gaveUp).toBeGreaterThanOrEqual(1);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  });
```

(파일 맨 위 import 에 `wmsTables` 를 더한다: `import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';`)

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.summary.spec.ts`
Expected: FAIL — `gaveUp` 없음

- [ ] **Step 3: 구현한다**

`order-progress.summary.ts`:

```ts
export type SummaryRow = { stage: string; state: string; open: number; stuck: number; gaveUp: number; oldest: string | null };
export type StageSummary = {
  stage: OrderProgressStage;
  open: number;
  stuck: number;
  gaveUp: number;
  oldestEnteredAt: string | null;
  states: { state: string; open: number; stuck: number; gaveUp: number }[];
};
```

`assembleSummary` 의 초기값에 `gaveUp: 0` 을 더하고(`{ stage, open: 0, stuck: 0, gaveUp: 0, oldestEnteredAt: null, states: [] }`), 루프에서 `acc.gaveUp += row.gaveUp;` 를 `acc.stuck += row.stuck;` 다음에, `acc.states.push({ state: row.state, open: row.open, stuck: row.stuck, gaveUp: row.gaveUp });` 로 바꾼다.

`order-progress.reader.ts`:

1. import 에 `inArray, isNotNull` 을 더한다(`drizzle-orm`).
2. `OrderProgressItem` 에 필드를 더한다:

```ts
  /** 리컨실러가 포기한 규칙들(스펙 2026-10-08 §6). 없으면 빈 배열 */
  gaveUp: { rule: string; row: number; since: string; lastError: string | null }[];
```

3. `summary` 의 select 에 `stuck` 다음으로:

```ts
          gaveUp: sql<number>`(count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM ${wmsTables.orderReconcileState} r
             WHERE r.sales_order_id = ${t.salesOrderId} AND r.gave_up_at IS NOT NULL
          )))::int`,
```

4. `listOrders` 의 `const page = rows.slice(0, query.limit);` 다음에:

```ts
      const r = wmsTables.orderReconcileState;
      const ids = page.map((row) => row.salesOrderId);
      const marks =
        ids.length === 0
          ? []
          : await trx
              .select({
                salesOrderId: r.salesOrderId,
                rule: r.rule,
                row: r.trackingRow,
                since: r.gaveUpAt,
                lastError: r.lastError,
              })
              .from(r)
              .where(and(inArray(r.salesOrderId, ids), isNotNull(r.gaveUpAt)))
              .orderBy(asc(r.trackingRow));
      const gaveUpBy = new Map<string, OrderProgressItem['gaveUp']>();
      for (const m of marks) {
        if (!m.since) continue;
        const list = gaveUpBy.get(m.salesOrderId) ?? [];
        list.push({ rule: m.rule, row: m.row, since: m.since.toISOString(), lastError: m.lastError });
        gaveUpBy.set(m.salesOrderId, list);
      }
```

그리고 `items: page.map((r) => ({ … stuck: isStuck(…), }))` 의 각 항목에 `gaveUp: gaveUpBy.get(r.salesOrderId) ?? [],` 를 더한다. (map 콜백 인자 이름 `r` 이 위 `const r` 와 겹치면 콜백 인자를 `row` 로 바꾼다.)

`dto/order-progress-response.dto.ts`:

```ts
export class OrderProgressStateSummaryDto {
  @ApiProperty() state!: string;
  @ApiProperty() open!: number;
  @ApiProperty() stuck!: number;
  @ApiProperty({ description: '리컨실러가 포기한 주문 수' }) gaveUp!: number;
}
```

`OrderProgressStageSummaryDto` 에 `@ApiProperty({ description: '리컨실러가 포기한 주문 수' }) gaveUp!: number;` 를 `stuck` 다음에, 그리고:

```ts
export class OrderProgressGaveUpDto {
  @ApiProperty() rule!: string;
  @ApiProperty({ description: '#1016 행 번호' }) row!: number;
  @ApiProperty() since!: string;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
}
```

을 `OrderProgressItemDto` 위에 두고, `OrderProgressItemDto` 에 `@ApiProperty({ type: [OrderProgressGaveUpDto] }) gaveUp!: OrderProgressGaveUpDto[];` 를 더한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress`
Expected: PASS

Run: `npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-progress`
Expected: PASS (기존 판정·갱신·보드 스펙 + 새 테스트)

- [ ] **Step 5: 타입체크 후 커밋**

Run: `npm run type-check`
Expected: 에러 0

```bash
git add apps/core/src/modules/fulfillment/order-progress
git commit -m "feat(core): 정체 보드 요약·목록에 리컨실러 «자동 멈춤» (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 9: admin-web 정체 보드 «자동 멈춤» 표시

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts`
- Test: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.spec.ts`
- Modify: `apps/admin-web/src/features/order/stall-board/components/stage-band.tsx`
- Modify: `apps/admin-web/src/features/order/stall-board/template/index.tsx`
- Modify: `apps/admin-web/src/features/order/stall-board/components/stage-orders.tsx`

**Interfaces:**
- Consumes: Task 8 응답의 `gaveUp`(옛 core 응답에는 없을 수 있다)
- Produces:
  - `StageSummary.gaveUp?: number`, `states[].gaveUp?: number`, `ProgressItem.gaveUp?: GaveUpMark[]`, `type GaveUpMark = { rule: string; row: number; since: string; lastError: string | null }`
  - `cardAlertText(stuck: number, gaveUp: number): string`
  - `gaveUpBadge(marks: GaveUpMark[] | undefined): { text: string; title: string } | null`
  - `BandCell.gaveUp: number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`order-progress.shape.spec.ts` 끝에(파일 맨 위 import 에 `cardAlertText, gaveUpBadge` 를 더한다):

```ts
describe('자동 멈춤 표시 (#1016 12번)', () => {
  it('카드 경고 문구 — 0 이면 안 보인다', () => {
    expect(cardAlertText(0, 0)).toBe('');
    expect(cardAlertText(3, 0)).toBe('갇힘 3');
    expect(cardAlertText(0, 1)).toBe('자동 멈춤 1');
    expect(cardAlertText(1200, 2)).toBe('갇힘 1,200 · 자동 멈춤 2');
  });

  it('행 배지 — 없으면 null, 여럿이면 행 번호를 잇고 마지막 오류를 title 에', () => {
    expect(gaveUpBadge(undefined)).toBeNull();
    expect(gaveUpBadge([])).toBeNull();
    expect(
      gaveUpBadge([
        { rule: 'wake-awaiting-matching', row: 12, since: '2026-10-08T00:00:00.000Z', lastError: 'boom' },
        { rule: 'x', row: 16, since: '2026-10-08T00:00:00.000Z', lastError: null },
      ]),
    ).toEqual({ text: '자동 멈춤 · #12 #16', title: '#12 boom' });
  });

  it('옛 core 응답(gaveUp 없음)도 그대로 받는다', () => {
    const s = toProgressSummary({
      evaluatedAt: null,
      stages: [{ stage: 'fo', open: 1, stuck: 0, oldestEnteredAt: null, states: [] }],
    });
    expect(s.stages[0].gaveUp ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- order-progress.shape`
Expected: FAIL — `cardAlertText is not a function`

- [ ] **Step 3: 구현한다**

`order-progress.shape.ts` — 타입:

```ts
export interface StageSummary {
  stage: string;
  open: number;
  stuck: number;
  /** 리컨실러가 포기한 주문 수. 옛 core 응답엔 없다 */
  gaveUp?: number;
  oldestEnteredAt: string | null;
  states: { state: string; open: number; stuck: number; gaveUp?: number }[];
}
export type GaveUpMark = { rule: string; row: number; since: string; lastError: string | null };
```

`ProgressItem` 에 `gaveUp?: GaveUpMark[];` 를 `stuck` 다음에 더한다. 파일 끝에:

```ts
/** 카드의 빨간 줄 문구. 0 인 항목은 쓰지 않는다(작은 글씨 최소화). */
export function cardAlertText(stuck: number, gaveUp: number): string {
  const parts: string[] = [];
  if (stuck > 0) parts.push(`갇힘 ${stuck.toLocaleString('ko-KR')}`);
  if (gaveUp > 0) parts.push(`자동 멈춤 ${gaveUp.toLocaleString('ko-KR')}`);
  return parts.join(' · ');
}

/** 목록 행의 «자동 멈춤» 배지 — 리컨실러가 다섯 번 시도하고 멈춘 주문(스펙 2026-10-08 §6). title 은 마지막 오류. */
export function gaveUpBadge(marks: GaveUpMark[] | undefined): { text: string; title: string } | null {
  if (!marks || marks.length === 0) return null;
  return {
    text: `자동 멈춤 · ${marks.map((m) => `#${m.row}`).join(' ')}`,
    title: marks
      .filter((m) => m.lastError)
      .map((m) => `#${m.row} ${m.lastError}`)
      .join('\n'),
  };
}
```

`stage-band.tsx`:
- import 에 `cardAlertText` 를 더한다.
- `BandCell` 에 `gaveUp: number;` 를 더하고, 기본값 객체에 `gaveUp: 0,` 을 더한다.
- 빨간 줄 span 의 내용을 다음으로 바꾼다:

```tsx
        <span className="min-h-4 text-xs font-semibold text-red-600 tabular-nums">
          {!unknown ? cardAlertText(c.stuck, c.gaveUp) : ''}
        </span>
```

`template/index.tsx` 의 `cells` 세 갈래에 `gaveUp` 을 더한다: `collect` 는 `gaveUp: 0,`, 0~8 단계는 `gaveUp: s?.gaveUp ?? 0,`, 나머지는 `gaveUp: s.gaveUp ?? 0,`.

`stage-orders.tsx`:
- import 에 `gaveUpBadge` 를 더한다.
- 행 렌더링을 블록 본문으로 바꿔 배지를 한 번만 계산한다: `{items.map((r) => (` → `{items.map((r) => { const badge = gaveUpBadge(r.gaveUp); return (`, 그 map 의 닫는 `))}` → `); })}`.
- 상태 칸을 다음으로 바꾼다:

```tsx
                <td className="px-4 py-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                    {stateLabel(r.state)}
                  </span>
                  {badge && (
                    <span
                      className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600"
                      title={badge.title}
                    >
                      {badge.text}
                    </span>
                  )}
                </td>
```

- 세부 상태 칩(`props.summary.states.map(…)`)의 `⚠{s.stuck…}` 옆에는 손대지 않는다(칩은 갇힘만 — 행 배지로 충분하다).

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- order-progress.shape`
Expected: PASS

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts apps/admin-web/src/lib/api/domains/orders/order-progress.shape.spec.ts apps/admin-web/src/features/order/stall-board
git commit -m "feat(admin-web): 정체 보드에 리컨실러 «자동 멈춤» 표시 (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 10: admin-web 매칭 편집 창 저장 순서

**Files:**
- Create: `apps/admin-web/src/lib/services/matching/save-plan.ts`
- Test: `apps/admin-web/src/lib/services/matching/save-plan.spec.ts`
- Modify: `apps/admin-web/src/lib/services/matching/index.ts` (`export * from './save-plan';`)
- Modify: `apps/admin-web/src/features/matching/variants/components/editor-dialog/index.tsx` (`handleSave`)

**Interfaces:**
- Produces:
  - `type MatchingSaveStep = { kind: 'upsert'; changedLinks: boolean } | { kind: 'setStrategy'; strategy: 'void' } | { kind: 'setPriority' }`
  - `planMatchingSave(input: { currentStrategy: 'variant' | 'void' | null; strategy: 'variant' | 'void'; linkCount: number; changedLinks: boolean; changedPolicy: boolean; changedPriority: boolean }): { ok: true; steps: MatchingSaveStep[] } | { ok: false; message: string }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// apps/admin-web/src/lib/services/matching/save-plan.spec.ts
import { planMatchingSave } from './save-plan';

const none = { changedLinks: false, changedPolicy: false, changedPriority: false };

describe('planMatchingSave (#1016 12번)', () => {
  it('바뀐 게 없으면 단계 0', () => {
    expect(planMatchingSave({ currentStrategy: 'variant', strategy: 'variant', linkCount: 1, ...none })).toEqual({
      ok: true,
      steps: [],
    });
  });

  it('void → variant 는 upsert 하나 — 전략 변경 요청을 보내지 않는다', () => {
    expect(
      planMatchingSave({ currentStrategy: 'void', strategy: 'variant', linkCount: 2, ...none, changedLinks: true }),
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('void → variant 인데 링크가 없으면 막는다', () => {
    expect(planMatchingSave({ currentStrategy: 'void', strategy: 'variant', linkCount: 0, ...none })).toEqual({
      ok: false,
      message: '재고상품을 1개 이상 연결해야 합니다.',
    });
  });

  it('pending 매칭에 링크를 붙이면 upsert 하나', () => {
    expect(
      planMatchingSave({ currentStrategy: null, strategy: 'variant', linkCount: 1, ...none, changedLinks: true }),
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('variant → void 는 전략 변경 먼저, 정책은 그다음(링크 없이), 우선순위는 마지막', () => {
    expect(
      planMatchingSave({
        currentStrategy: 'variant',
        strategy: 'void',
        linkCount: 1,
        changedLinks: true,
        changedPolicy: true,
        changedPriority: true,
      }),
    ).toEqual({
      ok: true,
      steps: [{ kind: 'setStrategy', strategy: 'void' }, { kind: 'upsert', changedLinks: false }, { kind: 'setPriority' }],
    });
  });

  it('variant 유지 + 링크·정책 변경은 upsert 하나, 링크를 다 지운 저장도 그대로 보낸다(서버가 pending 으로 내린다)', () => {
    expect(
      planMatchingSave({ currentStrategy: 'variant', strategy: 'variant', linkCount: 0, ...none, changedLinks: true }),
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('void 유지 + 정책만 바뀌면 링크 없는 upsert', () => {
    expect(
      planMatchingSave({ currentStrategy: 'void', strategy: 'void', linkCount: 0, ...none, changedPolicy: true }),
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: false }] });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- save-plan`
Expected: FAIL — `Cannot find module './save-plan'`

- [ ] **Step 3: 구현한다**

```ts
// apps/admin-web/src/lib/services/matching/save-plan.ts
//
// 매칭 편집 창의 저장 순서(#1016 12번, 스펙 docs/superpowers/specs/2026-10-08-order-reconciler-design.md §5.6).
// core 는 variant 로의 전략 변경을 거절한다 — variant 는 링크와 함께 upsert 로만 만든다(upsert 가 variant 를 직접 쓴다).
// 예전엔 upsert 와 전략 변경을 동시에 보내 void→variant + 링크 추가에서 경합했다. 단계는 순서대로 실행한다.

export type MatchingSaveStep =
  | { kind: 'upsert'; changedLinks: boolean }
  | { kind: 'setStrategy'; strategy: 'void' }
  | { kind: 'setPriority' };

export function planMatchingSave(input: {
  currentStrategy: 'variant' | 'void' | null;
  strategy: 'variant' | 'void';
  linkCount: number;
  changedLinks: boolean;
  changedPolicy: boolean;
  changedPriority: boolean;
}): { ok: true; steps: MatchingSaveStep[] } | { ok: false; message: string } {
  const steps: MatchingSaveStep[] = [];
  const changedStrategy = input.strategy !== input.currentStrategy;

  if (input.strategy === 'void') {
    if (changedStrategy) steps.push({ kind: 'setStrategy', strategy: 'void' });
    // void 는 링크가 없다 — 정책만 저장한다
    if (input.changedPolicy) steps.push({ kind: 'upsert', changedLinks: false });
  } else {
    if (changedStrategy && input.linkCount === 0) {
      return { ok: false, message: '재고상품을 1개 이상 연결해야 합니다.' };
    }
    if (changedStrategy || input.changedLinks || input.changedPolicy) {
      steps.push({ kind: 'upsert', changedLinks: changedStrategy || input.changedLinks });
    }
  }

  if (input.changedPriority) steps.push({ kind: 'setPriority' });
  return { ok: true, steps };
}
```

`apps/admin-web/src/lib/services/matching/index.ts` 끝에 `export * from './save-plan';` 를 더한다.

`editor-dialog/index.tsx` — import 목록(`@/lib/services/matching`)에 `planMatchingSave` 를 더하고 `handleSave` 를 다음으로 바꾼다:

```tsx
  const handleSave = async () => {
    if (!matching) return;

    const currentSkuLinks = getCurrentSkuLinks(matching);
    const changedLinks = !isSameSkuLinks(links, currentSkuLinks);
    const plan = planMatchingSave({
      currentStrategy: matching.strategy ?? null,
      strategy,
      linkCount: links.length,
      changedLinks,
      changedPolicy:
        JSON.stringify(stockPolicy) !== JSON.stringify(normalizeStockPolicy(matching.stockPolicy)),
      changedPriority: priority !== matching.priority,
    });

    if (!plan.ok) {
      toast.error(plan.message);
      return;
    }
    if (plan.steps.length === 0) {
      toast.info('변경된 내용이 없습니다.');
      return;
    }

    try {
      // 순서대로 — void 전환 뒤 정책 저장, variant 는 upsert 하나(동시에 보내면 서로 덮는다)
      for (const step of plan.steps) {
        if (step.kind === 'upsert') {
          await upsert.mutateAsync({
            variantId: matching.variantId,
            data: buildUpsertMatchingPayload({
              masterId: matching.master?.id ?? '',
              links,
              policy: stockPolicy,
              changedLinks: step.changedLinks,
            }),
          });
        } else if (step.kind === 'setStrategy') {
          await setStrategy.mutateAsync({ id: matching.id, data: { strategy: step.strategy } });
        } else {
          await setPriority.mutateAsync({ id: matching.id, data: { priority } });
        }
      }
      toast.success('매칭을 저장했습니다.');
      onOpenChange(false);
    } catch (error) {
      // 실패해도 닫지 않는다 — 닫아버리면 저장된 것처럼 보인다.
      toast.error(
        error instanceof Error ? error.message : '매칭 저장에 실패했습니다.'
      );
    }
  };
```

(`MatchingStrategy` 는 `'void' | 'variant'` 다 — `@/lib/types/dto/matching`. pending 매칭은 런타임에 `strategy` 가 null 이라 `?? null` 로 넘긴다.)

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- save-plan`
Expected: PASS (7 tests)

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/services/matching apps/admin-web/src/features/matching/variants/components/editor-dialog/index.tsx
git commit -m "fix(admin-web): 매칭 편집 창이 링크 저장과 전략 변경을 순서대로 보낸다 (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 11: 기존 링크 0개 매칭 20건 되돌리기 스크립트

**Files:**
- Create: `scripts/ops/1016-row12-demote-zero-link-matchings.ts`

**Interfaces:**
- Consumes: 없음(라이브 DB 직접). 출력 파일 `apps/core/tmp/1016-row12-demoted-variant-ids.txt`(`.gitignore` 의 `tmp/`)

- [ ] **Step 1: 스크립트를 쓴다**

```ts
// scripts/ops/1016-row12-demote-zero-link-matchings.ts
/**
 * #1016 12번 행 일회성 정리(스펙 2026-10-08 §5.7) — «matched + variant + 링크 0개» 매칭을 pending 으로 되돌린다.
 *
 * 배경: void→variant 전략 변경과 빈 링크 upsert 가 이 상태를 만들었다(10-08 라이브 20건, 08-06~09-22, 열린 주문 0).
 * 판매·출고에선 미매칭처럼 동작하는데 화면엔 «매칭됨»이라 매칭 작업 목록에 안 나온다. 두 길은 12번 PR 이 막았다.
 * 판매 사유는 MATCHING_LINK_MISSING → MATCHING_PENDING 으로 바뀌지만 둘 다 «재고 무관 판매»라 스토어프론트는 그대로다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-row12-demote-zero-link-matchings.ts          # 조회만 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-row12-demote-zero-link-matchings.ts --apply  # 실제 적용
 * 적용 뒤 반드시 (저장소 루트에서):
 *   VARIANT_IDS=$(paste -sd, apps/core/tmp/1016-row12-demoted-variant-ids.txt) bash scripts/sellmate/run.sh live recalc-sellable .
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';
import { Resource } from 'sst';

const APPLY = process.argv.includes('--apply');
const OUT = path.resolve(__dirname, '../../apps/core/tmp/1016-row12-demoted-variant-ids.txt');

type TargetRow = { id: string; variant_id: string; updated_at: Date; open_orders: number };

async function main() {
  // `Resource` 의 타입 선언에는 `Db` 가 없다(SST 가 배포 시점에 채운다). 647 스크립트와 같은 이유로 캐스팅한다.
  const Db = (Resource as unknown as { Db: { host: string; port: number; username: string; password: string } }).Db;
  const sql = postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database: 'core',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });

  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    const targets = await sql<TargetRow[]>`
      SELECT pm.id, pm.variant_id, pm.updated_at,
             (SELECT count(*)::int FROM sales_order_lines sol
                JOIN sales_orders so ON so.id = sol.sales_order_id
               WHERE sol.variant_id = pm.variant_id AND so.status IN ('pending', 'confirmed')) AS open_orders
        FROM product_matchings pm
       WHERE pm.status = 'matched' AND pm.strategy = 'variant'
         AND NOT EXISTS (SELECT 1 FROM product_variant_sku_links l WHERE l.product_matching_id = pm.id)
       ORDER BY pm.updated_at`;

    console.log(`대상: ${targets.length}건`);
    for (const t of targets) {
      console.log(`  ${t.variant_id}  수정 ${t.updated_at.toISOString()}  열린 주문 ${t.open_orders}`);
    }

    if (!APPLY) {
      console.log('\n조회만 했다. 적용하려면 --apply 를 붙일 것.');
      return;
    }
    if (targets.length === 0) {
      console.log('\n되돌릴 것이 없다.');
      return;
    }

    // 위에서 센 바로 그 id 들만, 조건을 다시 걸어 — 그 사이 링크가 붙은 행은 건드리지 않는다
    const ids = targets.map((t) => t.id);
    const updated = await sql<{ variant_id: string }[]>`
      UPDATE product_matchings pm
         SET status = 'pending', strategy = NULL, is_resolved = false, updated_at = now()
       WHERE pm.id = ANY(${ids})
         AND pm.status = 'matched' AND pm.strategy = 'variant'
         AND NOT EXISTS (SELECT 1 FROM product_variant_sku_links l WHERE l.product_matching_id = pm.id)
      RETURNING pm.variant_id`;

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, updated.map((r) => r.variant_id).join('\n') + '\n');
    console.log(`\n되돌림: ${updated.length}건 → ${OUT}`);
    console.log('이어서 recalc-sellable 을 돌릴 것(파일 머리 주석).');
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 타입체크**

Run: `npm run type-check`
Expected: 에러 0 (`scripts/ops` 가 tsconfig 범위 밖이면 `npx tsc --noEmit --esModuleInterop --skipLibCheck scripts/ops/1016-row12-demote-zero-link-matchings.ts` 로 확인)

- [ ] **Step 3: 커밋**

```bash
git add scripts/ops/1016-row12-demote-zero-link-matchings.ts
git commit -m "chore(ops): 링크 0개 매칭을 pending 으로 되돌리는 일회성 스크립트 (#1016 12번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 12: 최종 검증

- [ ] **Step 1: 전체 게이트**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest`
Expected: 실패 0 (OOM 이면 `npx jest --maxWorkers=2`)

Run: `(cd apps/admin-web && npx tsc --noEmit) && npm run test:admin-web`
Expected: 에러 0 · 실패 0

Run: `npm run test:core:integration:local`
Expected: 새 스펙 전부 PASS. 실패가 있으면 `git stash` 없이 `origin/develop` 에서도 같은 스펙이 빨간지(기존 RED) 확인해 구분해서 보고한다

- [ ] **Step 2: 남은 운영 작업을 정리한다 (코드 아님 — PR 본문에 적는다)**

1. 배포: 마이그 1건(additive) → `db:migrate` → `sst deploy`
2. 배포 후 `scripts/ops/1016-row12-demote-zero-link-matchings.ts` dry-run → `--apply` → `recalc-sellable`
3. 관찰 기간 뒤 스펙 §7 조회문으로 `would_act` 검토 → 거짓 양성 0건이면 `mode: 'act'` PR
4. #1016 12번 행 «문서» 칸에 스펙·계획 경로, 운영 체크박스 «12번 관찰 → 실행 전환», 머지 후 «해결» 칸에 머지 커밋 해시 → 아티팩트 재게시(메모리 `order-lifecycle-audit-2026-10-05` 의 동기화 절차)
