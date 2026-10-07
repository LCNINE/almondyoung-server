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
// 깨운 backlog 는 10~20초 pending·processing 에 머문다. 1분 투영이 그 순간을 잡아 행을 지우면 횟수가 리셋돼
// «깨움→되돌아옴» 반복이 포기에 닿지 못한다 — 막 act 한(또는 실패한) 행은 이만큼 «떠남»으로 보지 않는다.
export const DEPARTURE_GRACE_MIN = 10;
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

/**
 * 후보 처리 중 예외가 났을 때의 단계. fingerprint·check 가 늘 던지면 chooseStep 에 닿지 못하므로 상한을 여기서도 지킨다 —
 * 그러지 않으면 같은 예외가 256분마다 영원히 반복되고 보드에 «자동 멈춤»도 안 뜬다. 관찰 모드는 chooseStep 처럼 포기하지 않는다.
 */
export function errorStep(eff: EffectivePrior, mode: ReconcileMode): 'act' | 'give_up' {
  if (mode === 'act' && eff.gaveUpAt === null && eff.attempts >= MAX_ATTEMPTS) return 'give_up';
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
    // 포기는 실행이 아니다 — 보드가 보여 줄 «마지막으로 무슨 일이 있었나»를 덮지 않는다.
    // 다만 이번 바퀴의 예외 때문에 포기하는 것이면 그 예외가 «마지막 일»이다
    const error = input.error ?? null;
    return {
      ...head,
      attempts: eff.attempts,
      gaveUpAt: now,
      lastResult: error !== null ? 'error' : (eff.lastResult ?? 'acted'),
      lastError: error !== null ? error.slice(0, LAST_ERROR_MAX) : eff.lastError,
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
