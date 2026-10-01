'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { HelpPopover } from '@/features/main/HelpPopover';
import { useGrowthSummary } from '@/lib/services/analytics';
import { useOrderRefunds } from '@/lib/services/wallet/queries';
import { cn } from '@/lib/utils/ui';
import { changeSignals, goalView, monitorStats, refundMap, repeatRate90 } from '@/features/statistics/growth/model';
import { formatProbability } from '@/features/statistics/growth/probability';

/** 메인 관례(한국 증시 색): 증가 빨강, 감소 파랑. 통계 화면과 반대다 — 섞지 않는다. */
const UP = 'text-[#D71952]';
const DOWN = 'text-[#1779BA]';

const won = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}억원`;
  if (abs >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
};
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

/** 비율 지표(전환율·재구매율)는 %p 로 — 30% → 33% 를 «+10%» 로 쓰면 «10%p 상승»으로 읽힌다. */
function Delta({ current, previous, points }: { current: number | null; previous: number | null; points?: boolean }) {
  if (current == null || previous == null || (!points && previous === 0)) return <span className="text-[#9E9E9E]">-</span>;
  if (points) {
    const diff = (current - previous) * 100;
    if (Math.abs(diff) < 0.05) return <span className="text-[#9E9E9E]">±0%p</span>;
    return (
      <span className={cn('font-bold', diff > 0 ? UP : DOWN)}>
        {diff > 0 ? '▲' : '▼'}
        {Math.abs(diff).toFixed(1)}%p
      </span>
    );
  }
  const rate = (current - previous) / previous;
  if (Math.abs(rate) < 0.005) return <span className="text-[#9E9E9E]">±0%</span>;
  return (
    <span className={cn('font-bold', rate > 0 ? UP : DOWN)}>
      {rate > 0 ? '▲' : '▼'}
      {Math.abs(Math.round(rate * 100))}%
    </span>
  );
}

function Spark({ values }: { values: Array<number | null> }) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const points = values
    .map((v, i) => (v == null ? null : `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" className="mt-1 h-6 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} fill="none" stroke="#9E9E9E" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AxisTile({
  label,
  value,
  sub,
  current,
  previous,
  spark,
  points,
}: {
  label: string;
  value: string;
  sub: string;
  current: number | null;
  previous: number | null;
  spark?: Array<number | null>;
  points?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-[#FAFAFA] px-3 py-2.5">
      <div className="flex items-center justify-between gap-1 text-[12px] text-[#757575]">
        <span className="truncate">{label}</span>
        <Delta current={current} previous={previous} points={points} />
      </div>
      <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-[#1C1C1C]">{value}</p>
      <p className="truncate text-[11px] text-[#9E9E9E]">{sub}</p>
      {spark ? <Spark values={spark} /> : null}
    </div>
  );
}

/**
 * 관리자 메인 «올해 목표» 카드. 요청은 성장 요약 1개(서버 60초 재사용) + 목표가 있을 때만 결제 환불 1개.
 * 실패해도 이 카드만 안내로 바뀌고 메인의 다른 카드는 영향받지 않는다.
 */
export function GrowthGoalCard({ className }: { className?: string }) {
  const summaryQuery = useGrowthSummary();
  const summary = summaryQuery.data;
  const hasGoal = Boolean(summary?.goal);
  const refundFrom = summary ? [`${summary.year}-01-01`, summary.monitorDaily[0]?.date ?? ''].filter(Boolean).sort()[0] : '';
  const refundsQuery = useOrderRefunds(refundFrom, summary?.today ?? '', hasGoal);
  const refunds = useMemo(() => (hasGoal && !refundsQuery.isError ? refundMap(refundsQuery.data?.series) : null), [hasGoal, refundsQuery.data, refundsQuery.isError]);
  const waitingRefunds = hasGoal && refundsQuery.isLoading;

  const monitor = useMemo(() => (summary && !waitingRefunds ? monitorStats(summary, refunds) : null), [summary, refunds, waitingRefunds]);
  const goal = useMemo(() => (summary && monitor ? goalView(summary, refunds, monitor) : null), [summary, monitor, refunds]);
  const topSignal = useMemo(() => {
    if (!summary || waitingRefunds) return null;
    const hits = changeSignals(summary, refunds).filter((s) => s.verdict === 'up' || s.verdict === 'down');
    return hits.sort((a, b) => Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0))[0] ?? null;
  }, [summary, refunds, waitingRefunds]);
  const repeat = summary ? repeatRate90(summary) : null;

  const conversion = monitor && monitor.sessionsPerDay ? monitor.ordersPerDay / monitor.sessionsPerDay : null;
  const prevConversion = monitor?.previous.sessionsPerDay ? monitor.previous.ordersPerDay / monitor.previous.sessionsPerDay : null;

  return (
    <section className={className} aria-labelledby="main-growth-title">
      <div className="px-4 pt-3.5 pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 id="main-growth-title" className="text-base font-bold text-[#1C1C1C]">
              {summary ? `${summary.year}년 매출 목표` : '매출 목표'}
            </h2>
            <HelpPopover
              label="매출 목표와 성장 3축"
              items={[
                '달성액 = 목표 범위(기본 자사몰)의 순매출(취소·환불 차감)에서 결제 환불을 뺀 값, 어제까지 기준입니다.',
                '유입·전환·재구매는 최근 28일(어제까지) 하루 평균이고, 화살표는 그 앞 28일 대비입니다.',
                '재구매율은 첫 구매 후 90일 안에 다시 산 비율(자사몰 회원)입니다.',
                '목표는 판매/통계 › 설정에서 넣습니다.',
              ]}
            />
          </div>
          <Link href="/statistics/growth" className="flex shrink-0 items-center gap-0.5 text-[13px] text-[#1779BA] hover:underline">
            자세히 보기 <ChevronRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>

        {summaryQuery.isError ? (
          <p className="mt-3 text-sm text-[#757575]">성장 요약을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
        ) : !summary || !monitor ? (
          <Skeleton className="mt-3 h-28 w-full" />
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,360px)_1fr]">
            {goal ? (
              <div className="min-w-0 rounded-xl border border-[#EBEBEB] px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] text-[#757575]">연간 달성률 · 목표 {won(goal.pacing.annualTarget)}</span>
                  <span className="text-xl font-bold tabular-nums text-[#1C1C1C]">{pct(goal.pacing.annualAchievement)}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#EBEBEB]" role="img" aria-label={`연간 달성률 ${pct(goal.pacing.annualAchievement)}`}>
                  <div className="h-2 rounded-full bg-[#1A54F5]" style={{ width: `${Math.min(goal.pacing.annualAchievement, 1) * 100}%` }} />
                </div>
                <p className={cn('mt-2 text-sm font-bold', goal.pacing.paceGap < 0 ? 'text-[#D71952]' : 'text-[#1C1C1C]')}>
                  계획보다 {won(Math.abs(goal.pacing.paceGap))} {goal.pacing.paceGap < 0 ? '뒤처짐' : '앞섬'}
                </p>
                <p className="mt-0.5 text-[12px] text-[#757575]">
                  남은 {won(goal.pacing.remainingAmount)} · 하루 {won(goal.pacing.requiredDaily)} 필요 (지금 {won(goal.pacing.currentDaily)})
                </p>
                {goal.pacing.missingPreCoverage ? (
                  <p className="mt-0.5 text-[11px] text-[#D71952]">집계 시작({goal.pacing.planStart}) 전 실적이 빠져 달성률·확률이 낮게 나옵니다 — 설정에서 입력</p>
                ) : null}
                <p className="mt-0.5 text-[12px] text-[#757575]">
                  달성 확률 {goal.probability ? formatProbability(goal.probability.probability) : '판정 불가'} · 이대로면 연말 {pct(goal.pacing.landingRatio, 0)}
                </p>
              </div>
            ) : (
              <Link
                href="/statistics/settings#revenue-goal"
                className="flex min-w-0 flex-col justify-center rounded-xl border border-dashed border-[#D9D9D9] px-3 py-3 hover:bg-[#FAFAFA]"
              >
                <span className="text-sm font-bold text-[#1C1C1C]">올해 매출 목표를 넣어 주세요</span>
                <span className="mt-0.5 text-[12px] text-[#757575]">넣으면 여기서 남은 금액·하루 필요 매출·달성 확률을 봅니다 →</span>
              </Link>
            )}

            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
              <AxisTile
                label="유입 · 하루 방문"
                value={monitor.sessionsPerDay != null ? Math.round(monitor.sessionsPerDay).toLocaleString('ko-KR') : 'GA4 미연동'}
                sub="최근 28일 평균"
                current={monitor.sessionsPerDay}
                previous={monitor.previous.sessionsPerDay}
                spark={monitor.spark.map((d) => d.sessions)}
              />
              <AxisTile
                label="구매전환율"
                value={conversion != null ? `${(conversion * 100).toFixed(2)}%` : '-'}
                sub="실제 주문 ÷ 방문"
                current={conversion}
                previous={prevConversion}
                points
                spark={monitor.spark.map((d) => (d.sessions ? d.orders / d.sessions : null))}
              />
              <AxisTile
                label="재구매율 (90일)"
                value={repeat?.current != null ? pct(repeat.current) : '-'}
                sub={`퀵 레이쇼 ${summary.customers.growthAccounting.current.quickRatio != null ? summary.customers.growthAccounting.current.quickRatio.toFixed(2) : '-'}`}
                current={repeat?.current ?? null}
                previous={repeat?.previous ?? null}
                points
              />
            </div>
          </div>
        )}

        {topSignal ? (
          <p className="mt-2 text-[12px] text-[#1C1C1C]">
            <span className="mr-1 rounded bg-[#FEF6F8] px-1.5 py-0.5 text-[11px] font-bold text-[#D71952]">변화</span>
            {topSignal.window === 'week' ? '최근 7일' : '어제'} {topSignal.label}{' '}
            <span className={cn('font-bold', topSignal.verdict === 'up' ? UP : DOWN)}>
              {topSignal.relativeChange != null ? `${topSignal.relativeChange > 0 ? '+' : ''}${Math.round(topSignal.relativeChange * 100)}%` : ''}
            </span>{' '}
            ({topSignal.window === 'week' ? '앞선 주들' : '같은 요일 평소'} 대비)
          </p>
        ) : null}
      </div>
    </section>
  );
}
