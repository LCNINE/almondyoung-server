/**
 * 변화 분해 — «매출이 왜 변했나»를 축별 금액으로 나눈다.
 *
 * LMDI(로그 평균 디비지아) 가법 분해: Y = X₁·X₂·…·Xₙ 일 때
 *   ΔY = Σ L(Y₁, Y₀) · ln(Xᵢ₁ / Xᵢ₀),   L(a, b) = (a − b) / (ln a − ln b),  L(a, a) = a
 * 잔차가 0 이라 축별 기여의 합이 총변화와 정확히 같다(Ang, 2005). 값이 0 이면 로그가 정의되지 않으므로
 * «분해 불가»로 사유와 함께 돌려준다 — 0 으로 뭉개지 않는다.
 */

export interface Factor {
  key: string;
  label: string;
  previous: number;
  current: number;
}

export type Decomposition =
  | {
      ok: true;
      previousTotal: number;
      currentTotal: number;
      change: number;
      contributions: Array<{ key: string; label: string; amount: number; share: number | null }>;
    }
  | { ok: false; reason: string };

export function logMean(a: number, b: number): number {
  if (a === b) return a;
  return (a - b) / (Math.log(a) - Math.log(b));
}

export function lmdi(factors: Factor[]): Decomposition {
  const zero = factors.find((f) => !(f.previous > 0) || !(f.current > 0));
  if (zero) {
    return { ok: false, reason: `${zero.label} 값이 0 이라 축별로 나눌 수 없습니다` };
  }
  const previousTotal = factors.reduce((p, f) => p * f.previous, 1);
  const currentTotal = factors.reduce((p, f) => p * f.current, 1);
  const weight = logMean(currentTotal, previousTotal);
  const change = currentTotal - previousTotal;
  return {
    ok: true,
    previousTotal,
    currentTotal,
    change,
    contributions: factors.map((f) => {
      const amount = weight * Math.log(f.current / f.previous);
      return { key: f.key, label: f.label, amount, share: change !== 0 ? amount / change : null };
    }),
  };
}

/**
 * 믹스 vs 비율 분해. 전체 전환율 = Σ wᵢ·rᵢ (w = 세션 비중, r = 세그먼트 전환율) 일 때
 *   Δ전체 = Σ (wᵢ₁ − wᵢ₀)·rᵢ₀  [믹스: 어떤 세그먼트로 유입이 쏠렸나]
 *         + Σ wᵢ₁·(rᵢ₁ − rᵢ₀)  [비율: 세그먼트 안에서 전환이 변했나]
 * 두 항의 합은 총변화와 정확히 같다. 전체는 떨어졌는데 비율 효과가 0 이상이면 «믹스 효과» —
 * 페이지를 고칠 일이 아니라 유입 구성이 바뀐 것이다(심슨의 역설).
 */
export interface Segment {
  label: string;
  previous: { sessions: number; conversions: number };
  current: { sessions: number; conversions: number };
}

export interface MixRate {
  previousRate: number;
  currentRate: number;
  change: number;
  mixEffect: number;
  rateEffect: number;
  /** 전체 하락의 대부분이 믹스에서 왔다 — 세그먼트 안 전환은 그대로이거나 올랐다 */
  mixDriven: boolean;
  segments: Array<{ label: string; previousWeight: number; currentWeight: number; previousRate: number | null; currentRate: number | null; mix: number; rate: number }>;
}

export function mixVsRate(segments: Segment[]): MixRate | null {
  const prevSessions = segments.reduce((s, x) => s + x.previous.sessions, 0);
  const curSessions = segments.reduce((s, x) => s + x.current.sessions, 0);
  if (prevSessions === 0 || curSessions === 0) return null;
  const rate = (c: number, s: number) => (s > 0 ? c / s : null);
  let mixEffect = 0;
  let rateEffect = 0;
  const rows = segments.map((x) => {
    const w0 = x.previous.sessions / prevSessions;
    const w1 = x.current.sessions / curSessions;
    const r0 = rate(x.previous.conversions, x.previous.sessions);
    const r1 = rate(x.current.conversions, x.current.sessions);
    // 직전 기간에 없던 세그먼트는 기준 전환율을 현재 값으로 본다(비율 효과 0) — 새 유입은 전부 믹스다.
    const base = r0 ?? r1 ?? 0;
    const mix = (w1 - w0) * base;
    const rateDelta = w1 * ((r1 ?? base) - base);
    mixEffect += mix;
    rateEffect += rateDelta;
    return { label: x.label, previousWeight: w0, currentWeight: w1, previousRate: r0, currentRate: r1, mix, rate: rateDelta };
  });
  const previousRate = segments.reduce((s, x) => s + x.previous.conversions, 0) / prevSessions;
  const currentRate = segments.reduce((s, x) => s + x.current.conversions, 0) / curSessions;
  const change = currentRate - previousRate;
  return {
    previousRate,
    currentRate,
    change,
    mixEffect,
    rateEffect,
    mixDriven: change < 0 && rateEffect >= 0,
    segments: rows,
  };
}
