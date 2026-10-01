import type { ChangeSignal } from './changes';
import type { MixRate } from './decompose';
import type { FunnelAttribution } from './funnel';
import type { LeverPlan } from './levers';
import type { Pacing } from './pacing';

/**
 * 성장 브리핑 카드. 판정과 처방의 선을 코드로 지킨다:
 * - kind 'action' — 산술로 확정되는 것만 «하라»로 쓴다(목표까지 하루 N원, 전환 몇 %p 면 메워짐).
 * - kind 'look'   — 변화가 «어디서» 났는지와 볼 곳. 원인을 단정하지 않는다.
 * - kind 'info'   — 상태 알림.
 * «때문»·«원인은»·«탓» 같은 단정 표현은 금지 — 스펙이 모든 카드 문구를 검사한다.
 */

export type BriefingKind = 'action' | 'look' | 'info';
export type BriefingTone = 'good' | 'watch' | 'bad' | 'neutral';

export interface BriefingCard {
  id: string;
  kind: BriefingKind;
  tone: BriefingTone;
  title: string;
  evidence: string;
  href?: string;
  linkLabel?: string;
}

export interface BriefingInput {
  hasGoal: boolean;
  pacing: Pacing | null;
  levers: LeverPlan | null;
  signals: ChangeSignal[];
  mix: MixRate | null;
  funnel: FunnelAttribution | null;
  quickRatio: number | null;
  repurchaseDue: { customers: number; fromDays: number | null; toDays: number | null } | null;
}

const won = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
  if (abs >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
};
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;

export const FORBIDDEN_PHRASES = [/때문/, /원인은/, /탓/, /로 인해/];

const LEVER_HREF: Record<string, { href: string; label: string }> = {
  sessions: { href: '/statistics/traffic', label: '유입 탭' },
  conversion: { href: '/statistics/behavior', label: '행동 분석 탭' },
  aov: { href: '/statistics/products', label: '상품 탭' },
  repeat: { href: '/statistics/insights', label: '고객 분석 탭' },
};

const SIGNAL_HREF: Record<string, { href: string; label: string }> = {
  sessions: { href: '/statistics/traffic', label: '유입 탭' },
  conversion: { href: '/statistics/behavior', label: '행동 분석 탭' },
  orders: { href: '/statistics/sales', label: '매출 탭' },
  revenue: { href: '/statistics/sales', label: '매출 탭' },
};

function formatSignalValue(s: ChangeSignal, value: number): string {
  if (s.metric === 'conversion') return pct(value, 2);
  if (s.metric === 'revenue') return won(value);
  return Math.round(value).toLocaleString('ko-KR');
}

export function buildBriefing(input: BriefingInput): BriefingCard[] {
  const cards: BriefingCard[] = [];

  if (!input.hasGoal) {
    cards.push({
      id: 'goal-missing',
      kind: 'action',
      tone: 'neutral',
      title: '올해 매출 목표를 넣으면 남은 금액·하루 필요 매출·달성 확률을 계산합니다',
      evidence: '목표가 없어 페이스를 잴 기준이 없습니다.',
      href: '/statistics/settings',
      linkLabel: '목표 입력하기',
    });
  } else if (input.pacing) {
    const p = input.pacing;
    if (p.exceeded) {
      cards.push({ id: 'goal-done', kind: 'info', tone: 'good', title: `연간 목표를 넘었습니다 (${pct(p.annualAchievement)})`, evidence: `어제까지 ${won(p.actualToDate)} / 목표 ${won(p.annualTarget)}` });
    } else if (p.requiredLift != null && p.requiredLift > 0) {
      cards.push({
        id: 'goal-pace',
        kind: 'action',
        tone: p.requiredLift > 0.3 ? 'bad' : 'watch',
        title: `연말까지 하루 ${won(p.requiredDaily)}씩 팔아야 합니다 — 지금보다 하루 ${won(p.requiredDaily - p.currentDaily)} (${signed(p.requiredLift, 0)}) 더`,
        evidence: `남은 목표 ${won(p.remainingAmount)} · 남은 ${p.remainingDays}일 · 최근 ${p.runRateDaysUsed}일 일평균 ${won(p.currentDaily)}`,
      });
    } else {
      cards.push({
        id: 'goal-pace',
        kind: 'info',
        tone: 'good',
        title: `지금 속도면 연말 목표에 닿습니다 (이대로면 ${pct(p.landingRatio, 0)})`,
        evidence: `필요 일평균 ${won(p.requiredDaily)} ≤ 최근 일평균 ${won(p.currentDaily)}`,
      });
    }
  }

  if (input.levers && !input.levers.onTrack && input.levers.easiest) {
    const lever = input.levers.levers.find((l) => l.key === input.levers?.easiest);
    if (lever && lever.current != null && lever.required != null) {
      const fmt = (v: number) => (lever.key === 'conversion' ? pct(v, 2) : lever.key === 'aov' ? won(v) : `${Math.round(v).toLocaleString('ko-KR')}${lever.key === 'repeat' ? '명' : '회'}`);
      const link = LEVER_HREF[lever.key];
      cards.push({
        id: 'lever-easiest',
        kind: 'action',
        tone: 'watch',
        title: `${lever.label}을(를) ${fmt(lever.current)} → ${fmt(lever.required)}로 올리면 부족분이 메워집니다`,
        evidence: `네 가지 길 중 최근 최고치(${lever.best != null ? fmt(lever.best) : '-'}) 안에서 가장 적게 올리면 되는 길입니다. 다른 축은 그대로라는 가정입니다.`,
        href: link.href,
        linkLabel: link.label,
      });
    }
  }

  for (const s of input.signals.filter((x) => x.verdict === 'up' || x.verdict === 'down')) {
    const link = SIGNAL_HREF[s.metric];
    const when = s.window === 'week' ? '최근 7일' : '어제';
    const base = s.window === 'week' ? '앞선 주들' : '같은 요일 평소';
    cards.push({
      id: `signal-${s.metric}-${s.window}`,
      kind: 'look',
      tone: s.verdict === 'down' ? 'bad' : 'good',
      title: `${when} ${s.label} ${formatSignalValue(s, s.actual)} — ${base} ${s.baseline != null ? formatSignalValue(s, s.baseline) : '-'} 대비 ${s.relativeChange != null ? signed(s.relativeChange, 0) : '-'}`,
      evidence: '통계적으로도(흔들림 범위 밖) 실무적으로도(15% 이상) 큰 변화입니다.',
      href: link?.href,
      linkLabel: link?.label,
    });
  }

  if (input.mix && input.mix.mixDriven) {
    cards.push({
      id: 'mix',
      kind: 'look',
      tone: 'watch',
      title: `GA4 구매율 하락은 채널 안이 아니라 유입 구성 변화에서 났습니다 (채널별 구매율은 그대로이거나 올랐습니다)`,
      evidence: `전체 ${pct(input.mix.previousRate, 2)} → ${pct(input.mix.currentRate, 2)} · 구성 효과 ${signed(input.mix.mixEffect, 2)}p · 채널 내 효과 ${signed(input.mix.rateEffect, 2)}p. 상세페이지보다 유입 채널 구성을 먼저 보세요.`,
      href: '#growth-conversion',
      linkLabel: '채널별 구매율 보기',
    });
  }

  if (input.funnel?.dominant && input.funnel.currentOverall != null && input.funnel.previousOverall != null && input.funnel.currentOverall < input.funnel.previousOverall) {
    const d = input.funnel.dominant;
    cards.push({
      id: 'funnel',
      kind: 'look',
      tone: 'watch',
      title: `방문 대비 구매가 줄어든 몫의 ${pct(d.share ?? 0, 0)}가 «${d.fromLabel} → ${d.label}» 단계에서 났습니다`,
      // 유입 구성 변화로 설명되는 하락이면 단계율도 그 영향을 받는다(저전환 채널은 모든 단계에서 낮다) —
      // 그때 «이 단계를 먼저 보라»고 하면 믹스 카드와 반대 방향을 가리키게 된다.
      evidence: input.mix?.mixDriven
        ? `이 단계 단계율 ${d.previous != null ? pct(d.previous) : '-'} → ${d.current != null ? pct(d.current) : '-'}. 다만 이번 하락은 유입 구성 변화로 설명되므로 단계율 변화도 그 영향일 수 있습니다 — 채널 구성을 먼저 보세요.`
        : `이 단계 단계율 ${d.previous != null ? pct(d.previous) : '-'} → ${d.current != null ? pct(d.current) : '-'}. 이 단계를 먼저 보세요.`,
      href: '/statistics/behavior',
      linkLabel: '행동 분석 탭',
    });
  }

  if (input.quickRatio != null && input.quickRatio < 1) {
    cards.push({
      id: 'quick-ratio',
      kind: 'look',
      tone: 'bad',
      title: `최근 28일 떠난 고객이 새로 온·돌아온 고객보다 많습니다 (퀵 레이쇼 ${input.quickRatio.toFixed(2)})`,
      evidence: '퀵 레이쇼 = (신규 + 복귀) ÷ 이탈. 1 미만이면 구매 고객 기반이 줄고 있습니다.',
      href: '#growth-repeat',
      linkLabel: '성장 회계 보기',
    });
  }

  if (input.repurchaseDue && input.repurchaseDue.customers > 0 && input.repurchaseDue.fromDays != null && input.repurchaseDue.toDays != null) {
    cards.push({
      id: 'repurchase-due',
      kind: 'action',
      tone: 'neutral',
      title: `재구매 시기에 들어온 1회 구매 고객 ${input.repurchaseDue.customers.toLocaleString('ko-KR')}명 — 지금 알림을 보낼 시점입니다`,
      evidence: `재구매한 고객의 절반이 첫 구매 후 ${input.repurchaseDue.fromDays}~${input.repurchaseDue.toDays}일 사이에 두 번째 주문을 했습니다. 이 고객들은 그 구간에 있고 아직 다시 사지 않았습니다.`,
      href: '/messages/alimtalk/send',
      linkLabel: '알림톡 보내기',
    });
  }

  return cards;
}
