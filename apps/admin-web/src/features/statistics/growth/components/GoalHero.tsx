'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import { formatKrw, formatKrwAxis, formatPercent, SERIES_COLORS } from '../../shared';
import { addDays } from '../calendar';
import type { GoalView } from '../model';
import { planBetween } from '../pacing';
import { formatProbability } from '../probability';

function won(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}억원`;
  if (abs >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-xl font-bold tabular-nums',
          tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-gray-900',
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] leading-snug text-gray-500">{sub}</p> : null}
    </div>
  );
}

/** 누적 실적 vs 계획 누적 + 이대로 가면(점선). 축은 하나(금액). */
function cumulativeChart(view: GoalView, year: number, monthlyTargets: number[], ytdNet: Array<{ date: string; net: number }>) {
  const { pacing } = view;
  const rows: Array<{ date: string; actual: number | null; plan: number; projection: number | null }> = [];
  // 시작값 = 집계 시작 전 실적(입력분). ytdNet 은 날짜별로 이미 환불을 뺀 값이다.
  let cum = pacing.actualToDate - ytdNet.filter((d) => d.date <= pacing.asOf).reduce((s, d) => s + d.net, 0);
  const byDate = new Map(ytdNet.map((d) => [d.date, d.net]));
  const yearEnd = `${year}-12-31`;
  const step = 7;
  // 집계 첫날 이전은 날짜별 실적이 없다(입력한 합계만 있다) — 그 구간은 실적선을 비운다.
  const firstDataDay = ytdNet[0]?.date ?? pacing.planStart;
  let projection = pacing.actualToDate;
  for (let d = pacing.planStart; d <= yearEnd; d = addDays(d, 1)) {
    if (d <= pacing.asOf) cum += byDate.get(d) ?? 0;
    else projection += pacing.currentDaily;
    const isSample = d === pacing.planStart || d === pacing.asOf || d === yearEnd || (Date.parse(`${d}T00:00:00Z`) / 86_400_000) % step === 0;
    if (!isSample) continue;
    rows.push({
      date: d,
      actual: d <= pacing.asOf && d >= firstDataDay ? cum : null,
      plan: planBetween(year, monthlyTargets, pacing.planStart, d),
      projection: d >= pacing.asOf ? (d === pacing.asOf ? pacing.actualToDate : projection) : null,
    });
  }
  return rows;
}

export function GoalHero({
  view,
  year,
  monthlyTargets,
  ytdNet,
  isLoading,
  marginRate,
  scope,
  externalAvailable,
}: {
  view: GoalView | null;
  year: number;
  monthlyTargets: number[] | null;
  ytdNet: Array<{ date: string; net: number }>;
  isLoading?: boolean;
  /** 최근 90일 마진율(원가 입력분) — 목표 달성 시 예상 이익. 없으면 null */
  marginRate: number | null;
  scope: 'own_mall' | 'all_channels';
  /** 최근 1년 집계에 외부 판매채널 매출이 있는가 */
  externalAvailable: boolean;
}) {
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!view || !monthlyTargets) {
    return (
      <section className="rounded-[10px] border border-dashed border-gray-300 bg-white p-6 text-center">
        <p className="text-base font-semibold text-gray-900">{year}년 매출 목표가 아직 없습니다</p>
        <p className="mt-1 text-sm text-gray-500">목표를 넣으면 남은 금액·하루에 필요한 매출·연말 착지·달성 확률을 계산합니다.</p>
        <Link
          href="/statistics/settings#revenue-goal"
          className="mt-3 inline-flex items-center gap-1 rounded-md bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600"
        >
          목표 입력하기 <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>
    );
  }
  const { pacing, probability } = view;
  const achieved = Math.min(pacing.annualAchievement, 1);
  const chart = cumulativeChart(view, year, monthlyTargets, ytdNet);
  const behind = pacing.paceGap < 0;

  return (
    <section className="rounded-[10px] border border-gray-200 bg-white p-4" aria-labelledby="growth-goal-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="growth-goal-title" className="text-base font-semibold text-gray-900">
          {year}년 매출 목표 {won(pacing.annualTarget)}
        </h2>
        <span className="text-[11px] text-gray-400">
          {pacing.asOf}(어제)까지 · {scope === 'own_mall' ? '자사몰' : '집계된 전 판매채널'} 순매출{pacing.refundDeducted ? ' − 결제 환불' : ''} · 오늘은 아직 진행 중이라 제외
        </span>
      </div>

      {scope === 'all_channels' && !externalAvailable ? (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          이 목표는 «전 판매채널» 범위인데 최근 1년 집계에 외부 판매채널 매출이 없습니다 — 아래 달성액은 자사몰 매출과 같은 숫자입니다.
          외부 채널 매출이 목표에 들어 있다면 실제보다 낮게 나옵니다.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-3">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-gray-500">연간 달성률</span>
              <span className="text-2xl font-bold tabular-nums text-gray-900">{formatPercent(pacing.annualAchievement)}</span>
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`연간 달성률 ${formatPercent(pacing.annualAchievement)}`}>
              <div className="h-3 rounded-full" style={{ width: `${achieved * 100}%`, backgroundColor: SERIES_COLORS[0] }} />
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              {won(pacing.actualToDate)} 달성 · 남은 목표 {won(pacing.remainingAmount)}
              {pacing.missingPreCoverage ? ' · 집계 시작 전 실적 미포함' : ''}
            </p>
          </div>

          <div className={cn('rounded-lg border px-3 py-2', behind ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50')}>
            <p className={cn('text-sm font-bold', behind ? 'text-red-800' : 'text-emerald-800')}>
              계획보다 {won(Math.abs(pacing.paceGap))} {behind ? '뒤처짐' : '앞섬'}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-600">
              어제까지 계획 {won(pacing.planToDate)} 대비 진척 {pacing.paceRatio != null ? formatPercent(pacing.paceRatio) : '-'}
            </p>
            {pacing.missingPreCoverage ? (
              <p className="mt-1 text-[11px] leading-snug text-amber-800">
                집계가 {pacing.planStart}에 시작돼 그 전 실적이 빠져 있습니다. 페이스는 같은 구간끼리 비교해 정확하지만, 연간 달성률·연말 착지·달성 확률은
                그 몫만큼 낮게 나옵니다 — 설정에서 «집계 시작 전 실적»을 넣으면 바로잡힙니다.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="하루에 필요한 매출"
              value={won(pacing.requiredDaily)}
              sub={`남은 ${pacing.remainingDays}일 · 최근 ${pacing.runRateDaysUsed}일 평균 ${won(pacing.currentDaily)}`}
              tone={pacing.requiredLift != null && pacing.requiredLift > 0 ? 'bad' : 'good'}
            />
            <Stat
              label="이대로 가면 연말"
              value={won(pacing.landing)}
              sub={`목표의 ${formatPercent(pacing.landingRatio)}`}
              tone={pacing.landingRatio >= 1 ? 'good' : 'bad'}
            />
            <Stat
              label="달성 확률"
              value={probability ? formatProbability(probability.probability) : '판정 불가'}
              sub={
                probability
                  ? `최근 ${probability.blocksUsed}주의 하루하루가 반복된다고 보고 4,000번 모의${probability.lowConfidence ? ' · 남은 기간이 길어 신뢰 낮음' : ''}`
                  : '최근 4주 이상의 일매출이 필요합니다'
              }
            />
            <Stat
              label="목표 달성 시 예상 이익"
              value={marginRate != null ? won(pacing.annualTarget * marginRate) : '계산 불가'}
              sub={marginRate != null ? `최근 90일 마진율 ${formatPercent(marginRate)} 적용 · 원가 입력분 기준 근사치` : '원가가 입력된 상품이 없어 마진율이 없습니다'}
            />
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-gray-500">누적 매출 — 실적 · 계획 · 이대로 가면</p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chart} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#999" tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} stroke="#999" tickFormatter={formatKrwAxis} width={56} />
              <Tooltip formatter={(value: number) => formatKrw(value)} labelFormatter={(d: string) => d} />
              <ReferenceLine y={pacing.annualTarget} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: '목표', position: 'insideTopLeft', fontSize: 11, fill: '#6b7280' }} />
              <Line type="monotone" dataKey="plan" name={pacing.missingPreCoverage ? '계획 누적(집계 첫날부터)' : '계획 누적'} stroke="#9ca3af" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="actual" name="실적 누적" stroke={SERIES_COLORS[0]} fill={SERIES_COLORS[0]} fillOpacity={0.12} strokeWidth={2} connectNulls={false} />
              <Line type="monotone" dataKey="projection" name="이대로 가면" stroke={SERIES_COLORS[1]} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-600">
            <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4" style={{ backgroundColor: SERIES_COLORS[0] }} />실적 누적</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-0.5 w-4 bg-gray-400" />
              계획 누적{pacing.missingPreCoverage ? ` (집계 첫날 ${pacing.planStart.slice(5)}부터 — 그 전 몫은 빠져 목표선에 못 닿습니다)` : ''}
            </span>
            <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: SERIES_COLORS[1] }} />이대로 가면(최근 {pacing.runRateDaysUsed}일 평균 유지)</span>
          </div>
        </div>
      </div>
    </section>
  );
}
