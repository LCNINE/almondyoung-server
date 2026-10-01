/**
 * 퍼널 단계 귀속 — «방문 대비 구매율 변화가 어느 단계에서 났나».
 *
 * 방문 대비 구매율 = Π 단계율(방문→상품조회, 상품조회→담기, … , 결제정보→구매) 이므로 로그로 나누면
 * 단계별 몫이 정확히 합산된다: 몫ᵢ = ln(단계율ᵢ₁/단계율ᵢ₀) ÷ ln(전체₁/전체₀). (LMDI 와 같은 원리)
 * GA4 이벤트 «건수»라 같은 사람이 여러 번 담으면 단계율이 100% 를 넘을 수 있다 — 이름을 «단계율»로 쓰고
 * 퍼센트를 전환율로 부르지 않는다.
 */

export const FUNNEL_STEPS = [
  { key: 'view_item', label: '상품 조회' },
  { key: 'add_to_cart', label: '장바구니 담기' },
  { key: 'begin_checkout', label: '결제 시작' },
  { key: 'add_payment_info', label: '결제 정보 입력' },
  { key: 'purchase', label: '구매' },
] as const;

export interface FunnelStep {
  key: string;
  label: string;
  fromLabel: string;
  current: number | null;
  previous: number | null;
  /** 전체 변화 중 이 단계의 몫. 전체가 변하지 않았거나 계산 불가면 null */
  share: number | null;
}

export interface FunnelAttribution {
  steps: FunnelStep[];
  currentOverall: number | null;
  previousOverall: number | null;
  /** 몫이 가장 큰(전체와 같은 방향으로 가장 많이 움직인) 단계 */
  dominant: FunnelStep | null;
  reason?: string;
}

export function attributeFunnel(
  sessions: { current: number; previous: number },
  events: { current: Record<string, number>; previous: Record<string, number> },
): FunnelAttribution {
  const chain = (period: 'current' | 'previous') => {
    const values = [sessions[period], ...FUNNEL_STEPS.map((s) => events[period][s.key] ?? 0)];
    return values;
  };
  const cur = chain('current');
  const prev = chain('previous');
  const steps: FunnelStep[] = FUNNEL_STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    fromLabel: i === 0 ? '방문' : FUNNEL_STEPS[i - 1].label,
    current: cur[i] > 0 ? cur[i + 1] / cur[i] : null,
    previous: prev[i] > 0 ? prev[i + 1] / prev[i] : null,
    share: null,
  }));
  const currentOverall = cur[0] > 0 ? cur[cur.length - 1] / cur[0] : null;
  const previousOverall = prev[0] > 0 ? prev[prev.length - 1] / prev[0] : null;

  const positive = steps.every((s) => (s.current ?? 0) > 0 && (s.previous ?? 0) > 0);
  if (!positive || currentOverall == null || previousOverall == null) {
    return { steps, currentOverall, previousOverall, dominant: null, reason: '건수가 0 인 단계가 있어 단계별로 나눌 수 없습니다' };
  }
  const total = Math.log(currentOverall / previousOverall);
  if (total === 0) return { steps, currentOverall, previousOverall, dominant: null };
  for (const s of steps) s.share = Math.log((s.current as number) / (s.previous as number)) / total;
  const dominant = [...steps].sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0] ?? null;
  return { steps, currentOverall, previousOverall, dominant };
}
