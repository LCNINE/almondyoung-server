import type { GrowthAnalysis, GrowthSummary } from '@/lib/api/domains/analytics';
import { addDays } from './calendar';
import {
  detectRateChange,
  detectValueChange,
  detectWeeklyRateChange,
  detectWeeklyValueChange,
  type ChangeSignal,
  type RatePoint,
  type ValuePoint,
} from './changes';
import { lmdi, mixVsRate, type Decomposition, type MixRate } from './decompose';
import { attributeFunnel, type FunnelAttribution } from './funnel';
import { bestRolling7, bestRolling7Ratio, planLevers, type LeverPlan } from './levers';
import { computePacing, type Pacing } from './pacing';
import { goalProbability, type ProbabilityResult } from './probability';

/**
 * 서버 응답 → 화면 값. 컴포넌트는 그리기만 하고 계산은 여기와 각 순수 모듈에서 한다.
 * 메인 카드와 성장 탭이 같은 함수를 써서 두 화면이 같은 숫자를 말한다.
 */

export const RUN_RATE_DAYS = 28;

export interface MonitorStats {
  /** 최근 완료일 28일 일평균 */
  sessionsPerDay: number | null;
  ordersPerDay: number;
  ownNetPerDay: number;
  /** 하루 평균 구매자(서로 다른 회원) */
  buyersPerDay: number;
  /** 직전 28일 일평균 — 메인 카드의 «전 28일 대비» */
  previous: { sessionsPerDay: number | null; ordersPerDay: number; ownNetPerDay: number; buyersPerDay: number };
  best: { sessionsPerDay: number | null; conversion: number | null; aov: number | null };
  /** 완료일 기준 스파크라인(오래된 → 최근) */
  spark: Array<{ date: string; sessions: number | null; orders: number; ownNet: number }>;
}

function refundOf(refunds: Map<string, number> | null, date: string) {
  return refunds?.get(date) ?? 0;
}

export function monitorStats(summary: GrowthSummary, refunds: Map<string, number> | null): MonitorStats {
  const asOf = addDays(summary.today, -1);
  const done = summary.monitorDaily.filter((d) => d.date <= asOf);
  const ga4ok = summary.ga4Daily.status === 'ok';
  const sessionsByDate = new Map(summary.ga4Daily.points.map((p) => [p.date, p.sessions]));
  const recent = done.slice(-RUN_RATE_DAYS);
  const before = done.slice(-RUN_RATE_DAYS * 2, -RUN_RATE_DAYS);
  const avg = (rows: typeof done, pick: (d: (typeof done)[number]) => number) =>
    rows.length > 0 ? rows.reduce((s, d) => s + pick(d), 0) / rows.length : 0;
  const ownNet = (d: (typeof done)[number]) => d.ownMall - refundOf(refunds, d.date);
  const sessions = (rows: typeof done) => (ga4ok ? avg(rows, (d) => sessionsByDate.get(d.date) ?? 0) : null);

  const buyersByDate = new Map(summary.buyersDaily.map((b) => [b.date, b.buyers]));
  const buyers = (rows: typeof done) => avg(rows, (d) => buyersByDate.get(d.date) ?? 0);
  const sessionsSeries = done.map((d) => sessionsByDate.get(d.date) ?? 0);
  const ordersSeries = done.map((d) => d.ownMallOrders);
  const netSeries = done.map(ownNet);

  return {
    sessionsPerDay: sessions(recent),
    ordersPerDay: avg(recent, (d) => d.ownMallOrders),
    ownNetPerDay: avg(recent, ownNet),
    buyersPerDay: buyers(recent),
    previous: {
      sessionsPerDay: before.length > 0 ? sessions(before) : null,
      ordersPerDay: avg(before, (d) => d.ownMallOrders),
      ownNetPerDay: avg(before, ownNet),
      buyersPerDay: buyers(before),
    },
    best: {
      sessionsPerDay: ga4ok ? bestRolling7(sessionsSeries) : null,
      conversion: ga4ok ? bestRolling7Ratio(ordersSeries, sessionsSeries) : null,
      aov: bestRolling7Ratio(netSeries, ordersSeries),
    },
    spark: recent.map((d) => ({ date: d.date, sessions: ga4ok ? sessionsByDate.get(d.date) ?? 0 : null, orders: d.ownMallOrders, ownNet: ownNet(d) })),
  };
}

export interface GoalView {
  pacing: Pacing;
  probability: ProbabilityResult | null;
  levers: LeverPlan;
}

/** 자사몰 매출 채널 값 — 서버 `OWN_MALL_CHANNEL` 과 같다. */
export const OWN_MALL_CHANNEL = 'medusa';

/** 외부 판매채널 매출이 집계에 실제로 들어오는가 — «전 채널» 목표 범위를 열지 정한다. */
export function hasExternalChannels(summary: Pick<GrowthSummary, 'channels'>): boolean {
  return summary.channels.some((c) => c !== OWN_MALL_CHANNEL);
}

/**
 * 목표 범위에 맞춘 일별 매출. 자사몰 범위면 «전 채널» 칸을 자사몰 값으로 바꿔, 아래 계산(페이싱·확률·외부 몫)이
 * 범위를 몰라도 되게 한다 — 자사몰 범위에서 외부 몫은 자연히 0 이 된다.
 */
export function scopedDaily(rows: GrowthSummary['ytdDaily'], scope: 'own_mall' | 'all_channels') {
  return scope === 'own_mall' ? rows.map((d) => ({ ...d, allChannels: d.ownMall })) : rows;
}

export function goalView(summary: GrowthSummary, refunds: Map<string, number> | null, monitor: MonitorStats): GoalView | null {
  if (!summary.goal) return null;
  const scope = summary.goal.scope ?? 'own_mall';
  const ytdDaily = scopedDaily(summary.ytdDaily, scope);
  const monitorDaily = scopedDaily(summary.monitorDaily, scope);
  const pacing = computePacing({
    today: summary.today,
    year: summary.year,
    goal: {
      annualTarget: summary.goal.annualTarget,
      monthlyTargets: summary.goal.monthlyTargets,
      preCoverageActual: summary.goal.preCoverageActual,
    },
    coverageStart: summary.coverageStart,
    ytdDaily,
    orderRefundsByDay: refunds,
    runRateDays: RUN_RATE_DAYS,
  });
  // 확률의 표본: 연초를 넘어가도 최근 8주를 쓴다(1월에도 근거가 있게).
  const asOf = pacing.asOf;
  const recentDaily = monitorDaily
    .filter((d) => d.date <= asOf)
    .map((d) => d.allChannels - refundOf(refunds, d.date));
  const probability = goalProbability({
    recentDaily,
    actualToDate: pacing.actualToDate,
    annualTarget: pacing.annualTarget,
    remainingDays: pacing.remainingDays,
  });
  const c = summary.customers;
  const levers = planLevers({
    requiredDaily: pacing.requiredDaily,
    currentDaily: pacing.currentDaily,
    ownMall: { sessionsPerDay: monitor.sessionsPerDay, ordersPerDay: monitor.ordersPerDay, netRevenuePerDay: monitor.ownNetPerDay },
    returning: {
      buyers28: c.current.returningBuyers,
      revenue28: c.current.returningBuyerRevenue,
      bestBuyers28: Math.max(c.current.returningBuyers, c.previous.returningBuyers),
    },
    best: monitor.best,
  });
  return { pacing, probability, levers };
}

/** 변화 감지 피드 — 어제(일)·최근 7일(주) 각각. 유의한 것만 카드가 된다. */
export function changeSignals(summary: GrowthSummary, refunds: Map<string, number> | null): ChangeSignal[] {
  const target = addDays(summary.today, -1);
  const done = summary.monitorDaily.filter((d) => d.date <= target);
  const orders: ValuePoint[] = done.map((d) => ({ date: d.date, value: d.ownMallOrders }));
  const revenue: ValuePoint[] = done.map((d) => ({ date: d.date, value: d.allChannels - refundOf(refunds, d.date) }));
  // 외부 채널이 집계에 없으면 «전 채널»은 자사몰과 같은 숫자다 — 그렇게 부르지 않는다.
  const revenueLabel = hasExternalChannels(summary) ? '전 채널 순매출' : '순매출';
  const signals: ChangeSignal[] = [
    detectValueChange('orders', '자사몰 주문', orders, target),
    detectValueChange('revenue', revenueLabel, revenue, target),
    detectWeeklyValueChange('orders', '자사몰 주문', orders, target),
    detectWeeklyValueChange('revenue', revenueLabel, revenue, target),
  ];
  if (summary.ga4Daily.status === 'ok') {
    const sessionsByDate = new Map(summary.ga4Daily.points.map((p) => [p.date, p.sessions]));
    const sessions: ValuePoint[] = done.map((d) => ({ date: d.date, value: sessionsByDate.get(d.date) ?? 0 }));
    const cvr: RatePoint[] = done.map((d) => ({ date: d.date, numerator: d.ownMallOrders, denominator: sessionsByDate.get(d.date) ?? 0 }));
    signals.push(
      detectValueChange('sessions', '방문', sessions, target),
      detectRateChange('conversion', '주문 전환율', cvr, target),
      detectWeeklyValueChange('sessions', '방문', sessions, target),
      detectWeeklyRateChange('conversion', '주문 전환율', cvr, target),
    );
  }
  return signals;
}

export interface PeriodView {
  /** 방문 × 주문 전환율 × 객단가 분해(자사몰). GA4 없으면 사유 */
  equation: Decomposition;
  sessions: { current: number; previous: number } | null;
  orders: { current: number; previous: number };
  ownNet: { current: number; previous: number };
  conversion: { current: number | null; previous: number | null };
  aov: { current: number | null; previous: number | null };
  mix: MixRate | null;
  funnel: FunnelAttribution | null;
  /** GA4 구매 ÷ DB 주문(같은 기간) */
  captureRate: number | null;
}

/** 기간 화면의 축 값과 분해. 매출 방정식은 «주문 기준»(DB 주문 ÷ GA4 방문)으로 잡는다. */
export function periodView(a: GrowthAnalysis): PeriodView {
  const own = a.revenue.ownMall;
  const ga4ok = a.ga4.status === 'ok' && a.ga4.totals != null;
  const s = ga4ok ? { current: a.ga4.totals!.current.sessions, previous: a.ga4.totals!.previous.sessions } : null;
  const orders = { current: own.current.orders, previous: own.previous.orders };
  const ownNet = { current: own.current.netRevenue, previous: own.previous.netRevenue };
  const rate = (n: number, d: number | undefined) => (d && d > 0 ? n / d : null);
  const conversion = { current: rate(orders.current, s?.current), previous: rate(orders.previous, s?.previous) };
  const aov = { current: rate(ownNet.current, orders.current), previous: rate(ownNet.previous, orders.previous) };

  const equation: Decomposition = !s
    ? { ok: false, reason: a.ga4.status === 'disabled' ? 'GA4 미연동이라 방문을 알 수 없어 나눌 수 없습니다' : 'GA4 조회 실패로 방문을 알 수 없어 나눌 수 없습니다' }
    : lmdi([
        { key: 'sessions', label: '방문', previous: s.previous, current: s.current },
        { key: 'conversion', label: '주문 전환율', previous: conversion.previous ?? 0, current: conversion.current ?? 0 },
        { key: 'aov', label: '객단가', previous: aov.previous ?? 0, current: aov.current ?? 0 },
      ]);

  const mix = ga4ok
    ? mixVsRate(
        a.ga4.channels.map((c) => ({
          label: c.label,
          previous: { sessions: c.previous.sessions, conversions: c.previous.transactions },
          current: { sessions: c.current.sessions, conversions: c.current.transactions },
        })),
      )
    : null;
  const funnel = ga4ok && a.ga4.funnel && s ? attributeFunnel(s, a.ga4.funnel) : null;
  const captureRate = ga4ok && orders.current > 0 ? a.ga4.totals!.current.transactions / orders.current : null;
  return { equation, sessions: s, orders, ownNet, conversion, aov, mix, funnel, captureRate };
}

/** 메인 카드·성장 탭의 «재구매율» 헤드라인: 90일 재구매율. 표본이 없으면 null */
export function repeatRate90(summary: Pick<GrowthSummary, 'customers'>): { current: number | null; previous: number | null; firstBuyers: number } {
  const h = summary.customers.repeatHeadline;
  return {
    current: h.current.firstBuyers > 0 ? h.current.repeaters / h.current.firstBuyers : null,
    previous: h.previous.firstBuyers > 0 ? h.previous.repeaters / h.previous.firstBuyers : null,
    firstBuyers: h.current.firstBuyers,
  };
}

export function refundMap(series: Array<{ day: string; amount: number }> | undefined | null): Map<string, number> | null {
  if (!series) return null;
  return new Map(series.map((r) => [r.day, r.amount]));
}
