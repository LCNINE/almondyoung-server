/**
 * 목표 레버 등가표 — 부족한 하루 매출을 «무엇을 얼마나 바꾸면» 메우나.
 *
 * 자사몰 매출 = 방문 × 주문 전환율 × 객단가 는 항등식이라 한 축만 움직일 때의 필요치를 정확히 낼 수 있다.
 * 재구매는 이 곱셈의 독립 인수가 아니다(재구매 고객도 방문하고 전환한다). 그래서
 * - 레버는 «대체안»이다: 넷 중 하나만 움직였을 때의 필요치. 서로 더하지 않는다.
 * - «균형안»(같은 비율로 나눠 올리기)은 곱셈 항등식의 세 인수에만 적용한다.
 * 외부 채널(네이버·쿠팡 등)은 우리 방문 데이터가 없어 현재 일평균을 유지한다고 가정한다.
 *
 * 현실성: 필요치를 «최근 관측 중 가장 좋았던 7일»과 비교한다. 이 비교는 판정이 아니라 계산이다 —
 * «우리가 실제로 낸 적 있는 수준인가»만 말한다.
 */

export type LeverKey = 'sessions' | 'conversion' | 'aov' | 'repeat';
export type Realism = 'within' | 'beyond' | 'unknown';

export interface LeverInput {
  requiredDaily: number;
  currentDaily: number;
  /** 자사몰 최근 일평균 — 방문(GA4)은 없으면 null */
  ownMall: { sessionsPerDay: number | null; ordersPerDay: number; netRevenuePerDay: number };
  /** 최근 28일 기존 구매자(재구매 고객) 수와 그들의 순매출 */
  returning: { buyers28: number; revenue28: number; bestBuyers28: number | null };
  /** 최근 관측 중 7일 평균이 가장 좋았던 값 */
  best: { sessionsPerDay: number | null; conversion: number | null; aov: number | null };
}

export interface Lever {
  key: LeverKey;
  label: string;
  current: number | null;
  required: number | null;
  /** 필요치 − 현재 */
  delta: number | null;
  /** 필요치 ÷ 현재 − 1 */
  lift: number | null;
  best: number | null;
  realism: Realism;
  /** 계산 못 한 이유 */
  unavailable?: string;
}

export interface LeverPlan {
  /** 부족한 하루 매출. 0 이하면 지금 속도로 충분하다 */
  dailyGap: number;
  onTrack: boolean;
  levers: Lever[];
  /** 방문·전환·객단가를 같은 비율로 올릴 때 각 축 필요 상승률. 방문 데이터가 없으면 null */
  balancedLift: number | null;
  /** 과거 최고 이내에서 상승률이 가장 작은 레버 */
  easiest: LeverKey | null;
}

function realism(required: number | null, best: number | null): Realism {
  if (required == null || best == null) return 'unknown';
  return required <= best ? 'within' : 'beyond';
}

export function planLevers(input: LeverInput): LeverPlan {
  const dailyGap = input.requiredDaily - input.currentDaily;
  const own = input.ownMall;
  const R = own.netRevenuePerDay;
  const onTrack = dailyGap <= 0;
  const multiplier = R > 0 ? (R + Math.max(dailyGap, 0)) / R : null;

  const conversion = own.sessionsPerDay && own.sessionsPerDay > 0 ? own.ordersPerDay / own.sessionsPerDay : null;
  const aov = own.ordersPerDay > 0 ? R / own.ordersPerDay : null;

  const scaled = (key: LeverKey, label: string, current: number | null, best: number | null, missing: string): Lever => {
    if (current == null || current <= 0 || multiplier == null) {
      return { key, label, current, required: null, delta: null, lift: null, best, realism: 'unknown', unavailable: R <= 0 ? '자사몰 매출이 0 이라 배율을 낼 수 없습니다' : missing };
    }
    const required = current * multiplier;
    return { key, label, current, required, delta: required - current, lift: multiplier - 1, best, realism: realism(required, best) };
  };

  const levers: Lever[] = [
    scaled('sessions', '방문(하루)', own.sessionsPerDay, input.best.sessionsPerDay, 'GA4 방문 데이터가 없습니다'),
    scaled('conversion', '주문 전환율', conversion, input.best.conversion, 'GA4 방문 데이터가 없어 전환율을 낼 수 없습니다'),
    scaled('aov', '객단가', aov, input.best.aov, '주문이 없어 객단가를 낼 수 없습니다'),
  ];

  // 재구매만으로: 부족분(28일치) ÷ 재구매 고객 1명이 28일에 내는 순매출 = 더 필요한 재구매 고객 수
  const perReturning = input.returning.buyers28 > 0 ? input.returning.revenue28 / input.returning.buyers28 : null;
  if (perReturning && perReturning > 0) {
    const extra = (Math.max(dailyGap, 0) * 28) / perReturning;
    const required = input.returning.buyers28 + extra;
    levers.push({
      key: 'repeat',
      label: '재구매 고객(28일)',
      current: input.returning.buyers28,
      required,
      delta: extra,
      lift: required / input.returning.buyers28 - 1,
      best: input.returning.bestBuyers28,
      realism: realism(required, input.returning.bestBuyers28),
    });
  } else {
    levers.push({ key: 'repeat', label: '재구매 고객(28일)', current: input.returning.buyers28, required: null, delta: null, lift: null, best: null, realism: 'unknown', unavailable: '최근 28일 재구매 고객이 없어 1명당 매출을 낼 수 없습니다' });
  }

  const balancedLift = multiplier != null && conversion != null ? Math.cbrt(multiplier) - 1 : null;
  const candidates = onTrack ? [] : levers.filter((l) => l.realism === 'within' && l.lift != null);
  candidates.sort((a, b) => (a.lift ?? 0) - (b.lift ?? 0));

  return { dailyGap, onTrack, levers, balancedLift, easiest: candidates[0]?.key ?? null };
}

/** 일별 값에서 «7일 평균이 가장 좋았던 값». 7일이 안 되면 null. */
export function bestRolling7(values: number[]): number | null {
  if (values.length < 7) return null;
  let best = -Infinity;
  for (let i = 0; i + 7 <= values.length; i += 1) {
    const avg = values.slice(i, i + 7).reduce((s, v) => s + v, 0) / 7;
    if (avg > best) best = avg;
  }
  return best;
}

/** 비율(분자/분모)의 «7일 합 기준» 최고치. 분모가 0 인 창은 건너뛴다. */
export function bestRolling7Ratio(numerators: number[], denominators: number[]): number | null {
  if (numerators.length < 7 || numerators.length !== denominators.length) return null;
  let best: number | null = null;
  for (let i = 0; i + 7 <= numerators.length; i += 1) {
    const n = numerators.slice(i, i + 7).reduce((s, v) => s + v, 0);
    const d = denominators.slice(i, i + 7).reduce((s, v) => s + v, 0);
    if (d <= 0) continue;
    const r = n / d;
    if (best == null || r > best) best = r;
  }
  return best;
}
