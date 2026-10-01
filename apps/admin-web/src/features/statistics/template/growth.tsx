'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { GrowthAnalysis, GrowthGranularity } from '@/lib/api/domains/analytics';
import { useGrowthAnalysis, useGrowthSummary, useProfitStatistics } from '@/lib/services/analytics';
import { useOrderRefunds } from '@/lib/services/wallet/queries';
import { cn } from '@/lib/utils/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { StatisticsShell } from '../components/shell';
import { ChartCard, KpiTile } from '../components/widgets';
import { asOfLabel, kstDaysAgo } from '../as-of';
import { formatCount, formatKrw, formatKrwAxis, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';
import { buildBriefing, type BriefingCard } from '../growth/briefing';
import { isPartialBucket } from '../growth/calendar';
import { GoalHero } from '../growth/components/GoalHero';
import { changeSignals, goalView, hasExternalChannels, monitorStats, periodView, refundMap, repeatRate90, scopedDaily } from '../growth/model';
import { buildTrust, type TrustItem } from '../growth/trust';

const GRANULARITIES: GrowthGranularity[] = ['day', 'week', 'month'];
/** 창이 다 지난 고객이 이보다 적으면 비율을 내지 않는다 — 2명 중 1명 = 50% 같은 숫자가 헤드라인처럼 보인다. */
const MIN_COHORT_MATURED = 10;

function useGrowthRange(): { from: string; to: string; granularity: GrowthGranularity } {
  const range = useStatisticsRange();
  const searchParams = useSearchParams();
  const raw = searchParams.get('granularity') as GrowthGranularity | null;
  return { from: range.from, to: range.to, granularity: raw && GRANULARITIES.includes(raw) ? raw : 'day' };
}

const won = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}억원`;
  if (abs >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
};
const signedPct = (v: number | null, digits = 1) => (v == null ? '-' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`);
const pp = (cur: number | null, prev: number | null) => {
  if (cur == null || prev == null) return '-';
  const diff = (cur - prev) * 100;
  // 반올림하면 0 인 차이에 부호를 붙이면 «−0.00%p» 처럼 없는 하락이 보인다.
  if (Math.abs(diff) < 0.005) return '±0.00%p';
  return `${diff > 0 ? '+' : ''}${diff.toFixed(2)}%p`;
};
const rate = (n: number, d: number) => (d > 0 ? n / d : null);

const TONE_CHIP: Record<string, string> = {
  good: 'border-emerald-200 bg-emerald-50',
  watch: 'border-amber-200 bg-amber-50',
  bad: 'border-red-200 bg-red-50',
  neutral: 'border-gray-200 bg-white',
  info: 'border-gray-200 bg-gray-50',
  unknown: 'border-gray-200 bg-gray-50',
};
const TONE_DOT: Record<string, string> = {
  good: 'bg-emerald-500',
  watch: 'bg-amber-500',
  bad: 'bg-red-500',
  neutral: 'bg-gray-400',
  info: 'bg-gray-400',
  unknown: 'bg-gray-300',
};
const KIND_LABEL: Record<BriefingCard['kind'], string> = { action: '할 일', look: '볼 곳', info: '상태' };

function SectionTitle({ id, title, question }: { id: string; title: string; question: string }) {
  return (
    <div id={id} className="scroll-mt-4 pt-2">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500">{question}</p>
    </div>
  );
}

function Briefing({ cards }: { cards: BriefingCard[] }) {
  if (cards.length === 0) {
    return <p className="rounded-[10px] border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">지금 눈에 띄는 변화가 없습니다 — 평소 흔들림 범위 안입니다.</p>;
  }
  return (
    <section aria-label="성장 브리핑" className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {cards.map((card) => (
        <div key={card.id} className={cn('rounded-lg border p-3', TONE_CHIP[card.tone])}>
          <div className="flex items-start gap-2">
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONE_DOT[card.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-gray-500">{KIND_LABEL[card.kind]}</p>
              <p className="text-sm font-semibold text-gray-900">{card.title}</p>
              <p className="mt-1 text-xs leading-snug text-gray-600">{card.evidence}</p>
              {card.href ? (
                <Link href={card.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline">
                  {card.linkLabel ?? '보기'} <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function ContributionBars({ items }: { items: Array<{ label: string; amount: number }> }) {
  const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[72px_1fr_96px] items-center gap-2 text-xs">
          <span className="text-gray-600">{item.label}</span>
          <div className="relative h-3 rounded bg-gray-100">
            <div className="absolute left-1/2 top-0 h-3 w-px bg-gray-300" aria-hidden />
            <div
              className={cn('absolute top-0 h-3 rounded', item.amount >= 0 ? 'bg-emerald-500' : 'bg-red-500')}
              style={
                item.amount >= 0
                  ? { left: '50%', width: `${(Math.abs(item.amount) / max) * 50}%` }
                  : { right: '50%', width: `${(Math.abs(item.amount) / max) * 50}%` }
              }
            />
          </div>
          <span className={cn('text-right tabular-nums font-medium', item.amount >= 0 ? 'text-emerald-700' : 'text-red-700')}>
            {item.amount >= 0 ? '+' : '−'}
            {won(Math.abs(item.amount))}
          </span>
        </div>
      ))}
    </div>
  );
}

function SplitTable({
  rows,
  labelHeader,
  showConversion = true,
}: {
  rows: GrowthAnalysis['ga4']['channels'];
  labelHeader: string;
  showConversion?: boolean;
}) {
  const total = rows.reduce((s, r) => s + r.current.sessions, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2 pr-2 font-medium">{labelHeader}</th>
            <th className="py-2 pr-2 text-right font-medium">방문</th>
            <th className="py-2 pr-2 text-right font-medium">비중</th>
            <th className="py-2 pr-2 text-right font-medium">전기간 대비</th>
            {showConversion ? <th className="py-2 pr-2 text-right font-medium">GA4 구매율</th> : null}
            {showConversion ? <th className="py-2 text-right font-medium">구매율 변화</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cr = rate(r.current.transactions, r.current.sessions);
            const pr = rate(r.previous.transactions, r.previous.sessions);
            const change = r.previous.sessions > 0 ? r.current.sessions / r.previous.sessions - 1 : null;
            return (
              <tr key={r.label} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 text-gray-800">{r.label}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatCount(r.current.sessions)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{total > 0 ? formatPercent(r.current.sessions / total) : '-'}</td>
                <td className={cn('py-1.5 pr-2 text-right tabular-nums', change == null ? 'text-gray-400' : change >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                  {change == null ? '신규' : signedPct(change)}
                </td>
                {showConversion ? <td className="py-1.5 pr-2 text-right tabular-nums">{cr == null ? '-' : `${(cr * 100).toFixed(2)}%`}</td> : null}
                {showConversion ? (
                  <td className={cn('py-1.5 text-right tabular-nums', cr != null && pr != null && cr < pr ? 'text-red-700' : 'text-gray-700')}>{pp(cr, pr)}</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 채널 누적 영역 — 상위 3개 + 기타로 접는다(색 4개 상한, dataviz 원칙). */
function channelArea(analysis: GrowthAnalysis) {
  const totals = new Map<string, number>();
  for (const r of analysis.ga4.channelSeries) totals.set(r.channel, (totals.get(r.channel) ?? 0) + r.sessions);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
  const keys = totals.size > 3 ? [...top, '기타'] : top;
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const s of analysis.ga4.series) byBucket.set(s.bucket, { bucket: s.bucket, ...Object.fromEntries(keys.map((k) => [k, 0])) });
  for (const r of analysis.ga4.channelSeries) {
    const row = byBucket.get(r.bucket);
    if (!row) continue;
    const key = top.includes(r.channel) ? r.channel : '기타';
    row[key] = Number(row[key] ?? 0) + r.sessions;
  }
  return { keys, rows: [...byBucket.values()] };
}

type LeverStatus = '잼' | '근사' | '못 잼' | '확인 필요';
const STATUS_STYLE: Record<LeverStatus, string> = {
  잼: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  근사: 'bg-amber-50 text-amber-700 border-amber-200',
  '못 잼': 'bg-gray-100 text-gray-600 border-gray-200',
  '확인 필요': 'bg-gray-100 text-gray-600 border-gray-200',
};

function LeverMap({ analysis, view }: { analysis: GrowthAnalysis | undefined; view: ReturnType<typeof periodView> | null }) {
  const ch = (pred: (label: string) => boolean) => {
    if (!analysis || analysis.ga4.status !== 'ok') return null;
    return analysis.ga4.channels.filter((c) => pred(c.label)).reduce((s, c) => s + c.current.sessions, 0);
  };
  const step = (key: string) => view?.funnel?.steps.find((s) => s.key === key)?.current ?? null;
  const rows: Array<{ axis: string; lever: string; status: LeverStatus; value: string; how: string; href?: string }> = [
    { axis: '유입', lever: '광고', status: '근사', value: ch((l) => l.startsWith('Paid')) == null ? '-' : `유료 채널 방문 ${formatCount(ch((l) => l.startsWith('Paid')))}`, how: 'GA4 유료 채널 방문. 광고비 데이터가 없어 광고 효율(ROAS·고객 획득 비용)은 못 잽니다.', href: '#growth-traffic' },
    { axis: '유입', lever: '검색 노출', status: '잼', value: ch((l) => l === 'Organic Search') == null ? '-' : `자연검색 방문 ${formatCount(ch((l) => l === 'Organic Search'))}`, how: '자연검색 방문·랜딩. 노출 수·순위는 서치콘솔 미연동이라 없습니다.', href: '/statistics/traffic' },
    { axis: '유입', lever: '콘텐츠', status: '근사', value: '랜딩 페이지별 방문', how: '어떤 페이지로 들어왔나(랜딩)로 봅니다.', href: '/statistics/traffic' },
    { axis: '유입', lever: '제휴', status: '근사', value: ch((l) => l === 'Referral') == null ? '-' : `추천 사이트 방문 ${formatCount(ch((l) => l === 'Referral'))}`, how: 'GA4 Referral 채널. 결제 도메인 복귀가 섞일 수 있습니다.', href: '#growth-traffic' },
    { axis: '유입', lever: '소개(추천)', status: '못 잼', value: '-', how: '추천 코드·추천인 제도가 없습니다. 추천 코드를 만들면 잴 수 있습니다.' },
    { axis: '전환', lever: '상품 구성', status: '잼', value: '상품별 조회→담기→구매', how: '행동 분석 탭의 상품별 표와 검색 0건 키워드.', href: '/statistics/behavior' },
    { axis: '전환', lever: '가격', status: '못 잼', value: '-', how: '가격 변경 이력이 통계로 들어오지 않습니다. 가격 변경 사건을 적재하면 차트에 표시할 수 있습니다.' },
    { axis: '전환', lever: '상세페이지', status: '잼', value: step('add_to_cart') == null ? '-' : `조회→담기 단계율 ${formatPercent(step('add_to_cart'))}`, how: '상품을 본 뒤 담는 비율.', href: '#growth-conversion' },
    { axis: '전환', lever: '신뢰(리뷰)', status: '잼', value: '평점·리뷰 수', how: '리뷰 탭.', href: '/statistics/reviews' },
    { axis: '전환', lever: '배송 조건', status: '확인 필요', value: '-', how: '무료배송 기준 등은 쇼핑몰 엔진 설정에 있어 통계로 가져오지 않았습니다(쇼핑몰 부하 금지).' },
    { axis: '전환', lever: '결제 편의성', status: '근사', value: step('purchase') == null ? '-' : `결제정보→구매 단계율 ${formatPercent(step('purchase'))}`, how: '결제 정보를 넣은 뒤 끝까지 결제하는 비율. 결제 도메인 이동으로 덜 잡힐 수 있습니다.', href: '#growth-conversion' },
    { axis: '재구매', lever: '상품 만족도', status: '잼', value: '평점·반품', how: '리뷰 탭·반품/교환.', href: '/statistics/reviews' },
    { axis: '재구매', lever: '배송·CS 경험', status: '근사', value: '-', how: '반품·문의는 있으나 출고 시각을 믿을 수 없어 배송 소요일은 못 잽니다.' },
    { axis: '재구매', lever: '재주문 편의성', status: '확인 필요', value: '-', how: '재주문 버튼 사용 데이터가 없습니다.' },
    { axis: '재구매', lever: '재구매 알림', status: '근사', value: '발송 대상의 사후 구매', how: '대조군이 없어 «효과»가 아니라 «보낸 뒤 산 비율»입니다.', href: '/messages/alimtalk/send' },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="py-2 pr-2 font-medium">축</th>
            <th className="py-2 pr-2 font-medium">개선할 대상</th>
            <th className="py-2 pr-2 font-medium">측정</th>
            <th className="py-2 pr-2 font-medium">지금 값</th>
            <th className="py-2 pr-2 font-medium">어떻게 재나</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.axis}-${r.lever}`} className="border-b border-gray-100 align-top">
              <td className="py-1.5 pr-2 text-gray-500">{r.axis}</td>
              <td className="py-1.5 pr-2 font-medium text-gray-800">{r.lever}</td>
              <td className="py-1.5 pr-2">
                <span className={cn('whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px]', STATUS_STYLE[r.status])}>{r.status}</span>
              </td>
              <td className="py-1.5 pr-2 tabular-nums text-gray-800">{r.value}</td>
              <td className="py-1.5 pr-2 text-gray-500">{r.how}</td>
              <td className="py-1.5 whitespace-nowrap">
                {r.href ? (
                  <Link href={r.href} className="text-orange-600 hover:underline">
                    보기
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Simulator({
  ownDaily,
  externalDaily,
  actualToDate,
  remainingDays,
  target,
}: {
  ownDaily: number;
  externalDaily: number;
  actualToDate: number;
  remainingDays: number;
  target: number;
}) {
  const [lifts, setLifts] = useState({ sessions: 0, conversion: 0, aov: 0 });
  const factor = (1 + lifts.sessions / 100) * (1 + lifts.conversion / 100) * (1 + lifts.aov / 100);
  const landing = actualToDate + (ownDaily * factor + externalDaily) * remainingDays;
  const sliders: Array<{ key: keyof typeof lifts; label: string }> = [
    { key: 'sessions', label: '방문' },
    { key: 'conversion', label: '주문 전환율' },
    { key: 'aov', label: '객단가' },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_260px]">
      <div className="space-y-3">
        {sliders.map((s) => (
          <label key={s.key} className="block">
            <span className="flex justify-between text-xs text-gray-600">
              <span>{s.label}</span>
              <span className="tabular-nums font-medium text-gray-900">{lifts[s.key] > 0 ? '+' : ''}{lifts[s.key]}%</span>
            </span>
            <input
              type="range"
              min={-30}
              max={100}
              step={1}
              value={lifts[s.key]}
              onChange={(e) => setLifts((prev) => ({ ...prev, [s.key]: Number(e.target.value) }))}
              className="mt-1 w-full accent-orange-500"
              aria-label={`${s.label} 변화율`}
            />
          </label>
        ))}
        <button type="button" onClick={() => setLifts({ sessions: 0, conversion: 0, aov: 0 })} className="text-xs text-gray-500 underline hover:text-gray-800">
          되돌리기
        </button>
      </div>
      <div aria-live="polite" className={cn('rounded-lg border p-3', landing >= target ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
        <p className="text-xs text-gray-600">이렇게 바뀌면 연말</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{won(landing)}</p>
        <p className="mt-1 text-xs text-gray-600">목표의 {formatPercent(target > 0 ? landing / target : 0)} · 자사몰 매출 ×{factor.toFixed(2)}</p>
        <p className="mt-2 text-[11px] leading-snug text-gray-500">오늘부터 연말까지 남은 {remainingDays}일 동안 바뀐 값이 유지되고, 외부 채널은 최근 평균 그대로라는 가정입니다.</p>
      </div>
    </div>
  );
}

function TrustPanel({ items }: { items: TrustItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={item.key} className={cn('rounded-lg border p-3', TONE_CHIP[item.tone])}>
          <div className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', TONE_DOT[item.tone])} aria-hidden />
            <span className="text-xs font-medium text-gray-700">{item.label}</span>
          </div>
          <p className="mt-1 text-lg font-bold tabular-nums text-gray-900">{item.value}</p>
          <p className="mt-1 text-[11px] leading-snug text-gray-500">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

export default function GrowthStatisticsTemplate() {
  const range = useGrowthRange();
  const summaryQuery = useGrowthSummary();
  const summary = summaryQuery.data;
  const yearStart = summary ? `${summary.year}-01-01` : '';
  const monitorFrom = summary ? summary.monitorDaily[0]?.date ?? yearStart : '';
  const refundFrom = summary ? (monitorFrom < yearStart ? monitorFrom : yearStart) : '';
  const refundsQuery = useOrderRefunds(refundFrom, summary?.today ?? '', Boolean(summary));
  const analysisQuery = useGrowthAnalysis(range);
  const analysis = analysisQuery.data;
  // 목표 달성 시 예상 이익의 마진율 — 최근 90일(어제까지). 상품 목록은 필요 없어 1행만 받는다.
  const profitQuery = useProfitStatistics({ from: kstDaysAgo(90), to: kstDaysAgo(1), limit: 1 });

  const refunds = useMemo(() => (refundsQuery.isError ? null : refundMap(refundsQuery.data?.series)), [refundsQuery.data, refundsQuery.isError]);
  const monitor = useMemo(() => (summary && !refundsQuery.isLoading ? monitorStats(summary, refunds) : null), [summary, refunds, refundsQuery.isLoading]);
  const goal = useMemo(() => (summary && monitor ? goalView(summary, refunds, monitor) : null), [summary, refunds, monitor]);
  const signals = useMemo(() => (summary && !refundsQuery.isLoading ? changeSignals(summary, refunds) : []), [summary, refunds, refundsQuery.isLoading]);
  const view = useMemo(() => (analysis ? periodView(analysis) : null), [analysis]);

  const cards = useMemo(
    () =>
      summary
        ? buildBriefing({
            hasGoal: Boolean(summary.goal),
            pacing: goal?.pacing ?? null,
            levers: goal?.levers ?? null,
            signals,
            mix: view?.mix ?? null,
            funnel: view?.funnel ?? null,
            quickRatio: summary.customers.growthAccounting.current.quickRatio,
            repurchaseDue: summary.customers.repurchaseDue,
          })
        : [],
    [summary, goal, signals, view],
  );

  const trust = useMemo(
    () =>
      analysis
        ? buildTrust({
            ga4Status: analysis.ga4.status,
            ga4Transactions: analysis.ga4.totals?.current.transactions ?? null,
            ownMallOrders: analysis.revenue.ownMall.current.orders,
            paymentReturns: analysis.ga4.paymentReturns?.current ?? null,
            memberOrders: analysis.customers.coverage.memberOrders,
            refundDeducted: summary?.goal ? goal?.pacing.refundDeducted ?? null : null,
            missingPreCoverage: goal?.pacing.missingPreCoverage ?? null,
          })
        : [],
    [analysis, summary, goal],
  );

  const ytdNet = useMemo(
    () =>
      summary
        ? scopedDaily(summary.ytdDaily, summary.goal?.scope ?? 'own_mall').map((d) => ({ date: d.date, net: d.allChannels - (refunds?.get(d.date) ?? 0) }))
        : [],
    [summary, refunds],
  );
  const repeat90 = summary ? repeatRate90(summary) : null;
  const marginRate = profitQuery.data?.totals.marginRate ?? null;
  const area = analysis && analysis.ga4.status === 'ok' ? channelArea(analysis) : null;
  const c = analysis?.customers;
  // 주·월 버킷의 양 끝이 기간에 일부만 들어오면 «*» 를 붙인다 — 날이 덜 차 급락처럼 보이는 것을 막는다.
  const tick = (b: string) => `${b.length > 7 ? b.slice(5) : b}${isPartialBucket(b, range.granularity, range.from, range.to) ? '*' : ''}`;
  const partialNote = range.granularity !== 'day' ? ' · «*» 는 기간에 일부만 들어간 주·월(날이 덜 참)' : '';
  const ga4Note =
    analysis?.ga4.status === 'disabled'
      ? 'GA4 연동 대기 중이라 방문·채널·퍼널을 표시할 수 없습니다. 주문·재구매 숫자는 그대로입니다.'
      : analysis?.ga4.status === 'failed'
        ? 'GA4 조회에 실패했습니다(잠시 후 다시 시도). 주문·재구매 숫자는 그대로입니다.'
        : null;

  return (
    <StatisticsShell filterOptions={{ channel: false, granularity: true, granularities: GRANULARITIES }}>
      <div className="space-y-4">
        <p className="text-[11px] text-gray-400">
          {summary?.dataAsOf ? `${asOfLabel(summary.dataAsOf)} · ` : ''}목표·브리핑은 기간 필터와 무관하게 «올해·최근 28일» 기준, 아래 상세는 선택한 기간 기준입니다.
        </p>

        <GoalHero
          view={goal}
          year={summary?.year ?? new Date().getFullYear()}
          monthlyTargets={summary?.goal?.monthlyTargets ?? null}
          ytdNet={ytdNet}
          isLoading={summaryQuery.isLoading || refundsQuery.isLoading}
          marginRate={marginRate}
          scope={summary?.goal?.scope ?? 'own_mall'}
          externalAvailable={summary ? hasExternalChannels(summary) : false}
        />

        {summaryQuery.isError ? (
          <p className="py-6 text-center text-sm text-red-500">성장 요약을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
        ) : summary ? (
          <Briefing cards={cards} />
        ) : (
          <Skeleton className="h-24 w-full" />
        )}

        <SectionTitle id="growth-equation" title="매출 방정식" question={`자사몰 매출 = 방문 × 주문 전환율 × 객단가 — ${range.from} ~ ${range.to}, 직전 같은 기간 대비`} />
        {analysisQuery.isError ? (
          <p className="py-6 text-center text-sm text-red-500">기간 분석을 불러오지 못했습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(0,420px)]">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiTile
                label="방문(세션)"
                value={view?.sessions ? formatCount(view.sessions.current) : '-'}
                previous={view?.sessions ?? undefined}
                hint="GA4 · 전 채널"
                isLoading={analysisQuery.isLoading}
              />
              <KpiTile
                label="주문 전환율"
                value={view?.conversion.current != null ? `${(view.conversion.current * 100).toFixed(2)}%` : '-'}
                hint={`실제 주문 ÷ GA4 방문 (근사) · ${pp(view?.conversion.current ?? null, view?.conversion.previous ?? null)}`}
                isLoading={analysisQuery.isLoading}
              />
              <KpiTile
                label="객단가"
                value={view?.aov.current != null ? formatKrw(view.aov.current) : '-'}
                previous={view?.aov.current != null && view.aov.previous != null ? { current: view.aov.current, previous: view.aov.previous } : undefined}
                hint="자사몰 순매출 ÷ 주문"
                isLoading={analysisQuery.isLoading}
              />
              <KpiTile
                label="90일 재구매율"
                value={repeat90?.current != null ? formatPercent(repeat90.current) : '-'}
                hint={repeat90 ? `첫 구매 ${formatCount(repeat90.firstBuyers)}명 중 90일 안에 다시 산 비율 · 직전 ${repeat90.previous != null ? formatPercent(repeat90.previous) : '-'}` : undefined}
                isLoading={summaryQuery.isLoading}
              />
            </div>
            <div className="rounded-[10px] border border-gray-200 bg-white p-3">
              <p className="text-xs font-medium text-gray-700">자사몰 매출 변화를 세 축으로 나누면</p>
              {view == null ? (
                <Skeleton className="mt-2 h-20 w-full" />
              ) : view.equation.ok ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {won(view.equation.previousTotal)} → {won(view.equation.currentTotal)} ({view.equation.change >= 0 ? '+' : '−'}
                    {won(Math.abs(view.equation.change))})
                  </p>
                  <div className="mt-2">
                    <ContributionBars items={view.equation.contributions.map((x) => ({ label: x.label, amount: x.amount }))} />
                  </div>
                  <p className="mt-2 text-[11px] text-gray-400">세 막대의 합이 총변화와 정확히 같습니다(LMDI 분해). 순매출은 매출 탭과 같은 정의로 결제 환불은 넣지 않았습니다.</p>
                </>
              ) : (
                <p className="mt-2 text-xs text-gray-500">{view.equation.reason}</p>
              )}
            </div>
          </div>
        )}

        <SectionTitle id="growth-traffic" title="유입량" question="얼마나 들어오고, 어디서 늘고 줄었나" />
        {ga4Note ? (
          <p className="rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">{ga4Note}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="채널별 방문 추이" description={`GA4 기본 채널 그룹 · 상위 3개 외는 «기타»로 합침${partialNote}`} isLoading={analysisQuery.isLoading} isEmpty={!area || area.rows.length === 0}>
              {area ? (
                <>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={area.rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" tickFormatter={tick} />
                      <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                      <Tooltip formatter={(value: number) => formatCount(value)} />
                      {area.keys.map((key, i) => (
                        <Area key={key} type="monotone" dataKey={key} stackId="1" stroke="#fff" strokeWidth={2} fill={SERIES_COLORS[i]} fillOpacity={0.85} name={key} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-600">
                    {area.keys.map((key, i) => (
                      <span key={key} className="inline-flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SERIES_COLORS[i] }} />
                        {key}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </ChartCard>
            <ChartCard
              title="채널별 방문·GA4 구매율"
              description={`GA4 구매율 = GA4 구매 ÷ 방문 — 채널별 비교용(수집률 배지 참고)${
                analysis?.ga4.paymentReturns && analysis.ga4.paymentReturns.current.sessions > 0
                  ? ` · Referral 에 결제사 복귀 방문 ${formatCount(analysis.ga4.paymentReturns.current.sessions)}회·구매 ${formatCount(analysis.ga4.paymentReturns.current.transactions)}건 포함`
                  : ''
              }`} isLoading={analysisQuery.isLoading} isEmpty={!analysis || analysis.ga4.channels.length === 0}>
              {analysis ? <SplitTable rows={analysis.ga4.channels} labelHeader="채널" /> : null}
            </ChartCard>
            <ChartCard title="기기별" isLoading={analysisQuery.isLoading} isEmpty={!analysis || analysis.ga4.devices.length === 0}>
              {analysis ? <SplitTable rows={analysis.ga4.devices} labelHeader="기기" /> : null}
            </ChartCard>
            <ChartCard title="신규 방문 / 재방문" description="GA4 기준(쿠키) — 로그인 회원 연결이 아닙니다" isLoading={analysisQuery.isLoading} isEmpty={!analysis || analysis.ga4.visitorTypes.length === 0}>
              {analysis ? <SplitTable rows={analysis.ga4.visitorTypes.map((r) => ({ ...r, label: r.label === 'new' ? '신규 방문' : r.label === 'returning' ? '재방문' : r.label }))} labelHeader="구분" /> : null}
            </ChartCard>
          </div>
        )}

        <SectionTitle id="growth-conversion" title="구매전환율" question="들어온 사람 중 얼마나 사나 — 어느 단계에서 새나" />
        {ga4Note ? (
          <p className="rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">{ga4Note}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="구매 단계별 단계율" description="각 단계 ÷ 직전 단계 (GA4 이벤트 건수 — 같은 사람이 여러 번 담으면 100%를 넘을 수 있음)" isLoading={analysisQuery.isLoading} isEmpty={!view?.funnel}>
              {view?.funnel ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500">
                        <th className="py-2 pr-2 font-medium">단계</th>
                        <th className="py-2 pr-2 text-right font-medium">이번</th>
                        <th className="py-2 pr-2 text-right font-medium">직전</th>
                        <th className="py-2 text-right font-medium">구매율 변화 중 몫</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.funnel.steps.map((s) => (
                        <tr key={s.key} className={cn('border-b border-gray-100', view.funnel?.dominant?.key === s.key && 'bg-amber-50')}>
                          <td className="py-1.5 pr-2 text-gray-800">{s.fromLabel} → {s.label}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{s.current != null ? formatPercent(s.current) : '-'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{s.previous != null ? formatPercent(s.previous) : '-'}</td>
                          <td className="py-1.5 text-right tabular-nums">{s.share == null ? '-' : Math.abs(s.share) < 0.0005 ? '0%' : formatPercent(s.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-gray-400">
                    방문 대비 GA4 구매 {view.funnel.previousOverall != null ? `${(view.funnel.previousOverall * 100).toFixed(2)}%` : '-'} →{' '}
                    {view.funnel.currentOverall != null ? `${(view.funnel.currentOverall * 100).toFixed(2)}%` : '-'}. 몫의 합 = 100%.
                    {view.funnel.reason ? ` ${view.funnel.reason}` : ''}
                  </p>
                </div>
              ) : null}
            </ChartCard>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <KpiTile
                  label="주문 전환율 (실제 주문 기준)"
                  value={view?.conversion.current != null ? `${(view.conversion.current * 100).toFixed(2)}%` : '-'}
                  hint={`직전 ${view?.conversion.previous != null ? `${(view.conversion.previous * 100).toFixed(2)}%` : '-'} · 분자 DB 주문, 분모 GA4 방문`}
                  isLoading={analysisQuery.isLoading}
                />
                <KpiTile
                  label="GA4 수집률"
                  value={view?.captureRate != null ? formatPercent(view.captureRate) : '-'}
                  hint="GA4 구매 ÷ 실제 주문 — 낮을수록 채널별 구매율은 참고용"
                  isLoading={analysisQuery.isLoading}
                />
              </div>
              {view?.mix ? (
                <div className={cn('rounded-[10px] border p-3', view.mix.mixDriven ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white')}>
                  <p className="text-xs font-medium text-gray-700">GA4 구매율 변화 — 유입 구성 vs 채널 안</p>
                  <p className="mt-1 text-sm text-gray-900">
                    {(view.mix.previousRate * 100).toFixed(2)}% → {(view.mix.currentRate * 100).toFixed(2)}% ({pp(view.mix.currentRate, view.mix.previousRate)})
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    유입 구성 변화 {pp(view.mix.mixEffect, 0)} · 채널 안 구매율 변화 {pp(view.mix.rateEffect, 0)}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    {view.mix.mixDriven
                      ? '채널별 구매율은 그대로인데 전체가 떨어졌습니다 — 상세페이지보다 유입 채널 구성을 먼저 보세요.'
                      : '두 효과의 합이 전체 변화와 같습니다. 채널 안 변화가 크면 그 채널의 상품·페이지를 보세요.'}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <SectionTitle id="growth-repeat" title="재구매율" question="한 번 산 고객이 다시 사나 — 고객 기반이 쌓이나 새나 (자사몰 회원 주문 기준)" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile
            label="기존 구매자 비중"
            value={c ? formatPercent(rate(c.current.returningBuyers, c.current.buyers)) : '-'}
            hint={c ? `기간 구매자 ${formatCount(c.current.buyers)}명 중 이전 구매 이력자 · 직전 ${formatPercent(rate(c.previous.returningBuyers, c.previous.buyers))}` : undefined}
            isLoading={analysisQuery.isLoading}
          />
          <KpiTile
            label="기간 내 반복 구매율"
            value={c ? formatPercent(rate(c.current.repeatBuyers, c.current.buyers)) : '-'}
            hint="기간 안에 다른 날 2번 이상 산 비율 — 기간이 짧을수록 작게 나옴"
            isLoading={analysisQuery.isLoading}
          />
          <KpiTile
            label="두 번째 구매까지"
            value={c?.timeToSecond.p50 != null ? `${Math.round(c.timeToSecond.p50)}일` : '-'}
            hint={c?.timeToSecond.p25 != null ? `가운데 절반이 ${Math.floor(c.timeToSecond.p25)}~${Math.ceil(c.timeToSecond.p75 ?? 0)}일 · 최근 1년 첫구매 ${formatCount(c.timeToSecond.n)}명` : '재구매 표본 없음'}
            isLoading={analysisQuery.isLoading}
          />
          <KpiTile
            label="재구매 매출 비중"
            value={c ? formatPercent(rate(c.current.returningBuyerRevenue, c.current.newBuyerRevenue + c.current.returningBuyerRevenue)) : '-'}
            hint="회원 매출 중 기존 구매자 몫(환불 미반영)"
            isLoading={analysisQuery.isLoading}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard title="구매 고객 — 신규 vs 기존" description={`버킷마다 그 버킷에 처음 산 고객 / 이전에 산 적 있는 고객${partialNote}`} isLoading={analysisQuery.isLoading} isEmpty={!c || c.series.length === 0}>
            {c ? (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={c.series} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" tickFormatter={tick} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                    <Tooltip formatter={(value: number) => `${formatCount(value)}명`} />
                    <Bar dataKey="newBuyers" stackId="b" name="신규" fill={SERIES_COLORS[0]} stroke="#fff" strokeWidth={1} />
                    <Bar dataKey="returningBuyers" stackId="b" name="기존" fill={SERIES_COLORS[1]} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-1 flex gap-3 text-[11px] text-gray-600">
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SERIES_COLORS[0] }} />신규</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SERIES_COLORS[1] }} />기존</span>
                </div>
              </>
            ) : null}
          </ChartCard>

          <ChartCard title="고객 기반 회계 (성장 회계)" description="이번 기간 구매 고객을 신규·유지·복귀로, 직전 기간 고객 중 이번에 안 산 고객을 이탈로" isLoading={analysisQuery.isLoading} isEmpty={!c}>
            {c ? (
              (() => {
                const g = c.growthAccounting.current;
                const items = [
                  { label: '신규', value: g.newCustomers, sign: 1 },
                  { label: '복귀', value: g.resurrected, sign: 1 },
                  { label: '유지', value: g.retained, sign: 0 },
                  { label: '이탈', value: g.churned, sign: -1 },
                ];
                const max = Math.max(...items.map((i) => i.value), 1);
                return (
                  <div>
                    <div className="space-y-1.5">
                      {items.map((i) => (
                        <div key={i.label} className="grid grid-cols-[48px_1fr_64px] items-center gap-2 text-xs">
                          <span className="text-gray-600">{i.label}</span>
                          <div className="h-3 rounded bg-gray-100">
                            <div className={cn('h-3 rounded', i.sign > 0 ? 'bg-emerald-500' : i.sign < 0 ? 'bg-red-500' : 'bg-gray-400')} style={{ width: `${(i.value / max) * 100}%` }} />
                          </div>
                          <span className="text-right tabular-nums text-gray-900">{formatCount(i.value)}명</span>
                        </div>
                      ))}
                    </div>
                    <p className={cn('mt-3 text-sm font-semibold', g.quickRatio != null && g.quickRatio < 1 ? 'text-red-700' : 'text-gray-900')}>
                      퀵 레이쇼 {g.quickRatio != null ? g.quickRatio.toFixed(2) : '계산 불가(이탈 0)'}
                      <span className="ml-2 text-xs font-normal text-gray-500">직전 기간 {c.growthAccounting.previous.quickRatio != null ? c.growthAccounting.previous.quickRatio.toFixed(2) : '-'}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">(신규 + 복귀) ÷ 이탈. 1보다 크면 고객 기반이 늘고, 작으면 줄고 있습니다.</p>
                  </div>
                );
              })()
            ) : null}
          </ChartCard>
        </div>

        <ChartCard title="첫 구매 월별 N일 재구매율" description="첫 구매 후 30·60·90일 안에 두 번째 주문(다른 날)을 한 비율. 창이 아직 안 지난 고객은 «집계 중»으로 빼고, 창이 지난 고객이 10명 미만이면 비율을 내지 않습니다" isLoading={analysisQuery.isLoading} isEmpty={!c || c.cohorts.length === 0}>
          {c ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 pr-2 font-medium">첫 구매 월</th>
                    <th className="py-2 pr-2 text-right font-medium">첫 구매 고객</th>
                    {[30, 60, 90].map((d) => (
                      <th key={d} className="py-2 pr-2 text-right font-medium">{d}일</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.cohorts.map((row) => (
                    <tr key={row.cohortMonth} className="border-b border-gray-100">
                      <td className="py-1.5 pr-2 text-gray-800">{row.cohortMonth}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{formatCount(row.size)}</td>
                      {row.windows.map((w) => (
                        <td key={w.days} className="py-1.5 pr-2 text-right tabular-nums">
                          {w.matured >= MIN_COHORT_MATURED ? (
                            formatPercent(w.repeaters / w.matured)
                          ) : w.matured > 0 ? (
                            <span className="text-gray-400">표본 적음({w.matured}명)</span>
                          ) : (
                            <span className="text-gray-400">집계 중</span>
                          )}
                          {w.immature > 0 && w.matured >= MIN_COHORT_MATURED ? <span className="ml-1 text-[10px] text-gray-400">(+{w.immature} 집계 중)</span> : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </ChartCard>

        <SectionTitle id="growth-levers" title="레버 지도" question="표의 «개선할 대상» 15개 — 우리가 잴 수 있는 것과 없는 것" />
        <div className="rounded-[10px] border border-gray-200 bg-white p-3">
          <LeverMap analysis={analysis} view={view} />
        </div>

        {goal ? (
          <>
            <SectionTitle id="growth-levers-goal" title="목표까지 — 어느 길이 가장 가까운가" question="한 축만 움직인다면 얼마나? (넷은 대체안이라 더하지 않습니다 — 재구매가 늘면 방문·전환도 같이 오릅니다)" />
            <div className="overflow-x-auto rounded-[10px] border border-gray-200 bg-white p-3">
              {goal.levers.onTrack ? (
                <p className="text-sm text-emerald-700">지금 속도면 목표에 닿습니다 — 더 올릴 축이 없습니다.</p>
              ) : (
                <table className="w-full min-w-[620px] text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-2 font-medium">길</th>
                      <th className="py-2 pr-2 text-right font-medium">지금</th>
                      <th className="py-2 pr-2 text-right font-medium">필요</th>
                      <th className="py-2 pr-2 text-right font-medium">올려야 할 폭</th>
                      <th className="py-2 pr-2 text-right font-medium">최근 최고</th>
                      <th className="py-2 font-medium">현실성</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goal.levers.levers.map((l) => {
                      const fmt = (v: number | null) =>
                        v == null ? '-' : l.key === 'conversion' ? `${(v * 100).toFixed(2)}%` : l.key === 'aov' ? formatKrw(v) : `${Math.round(v).toLocaleString('ko-KR')}${l.key === 'repeat' ? '명' : '회'}`;
                      return (
                        <tr key={l.key} className={cn('border-b border-gray-100', goal.levers.easiest === l.key && 'bg-emerald-50')}>
                          <td className="py-1.5 pr-2 font-medium text-gray-800">{l.label}만으로</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(l.current)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(l.required)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{l.lift != null ? signedPct(l.lift) : l.unavailable ?? '-'}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(l.best)}</td>
                          <td className="py-1.5 text-gray-700">
                            {l.realism === 'within' ? '최근 최고 이내' : l.realism === 'beyond' ? '최근 최고를 넘음' : '판정 불가'}
                            {goal.levers.easiest === l.key ? ' · 가장 가까운 길' : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {goal.levers.balancedLift != null && !goal.levers.onTrack ? (
                <p className="mt-2 text-xs text-gray-600">
                  세 축(방문·전환·객단가)을 같은 비율로 나눠 올린다면 각각 <b className="tabular-nums">{signedPct(goal.levers.balancedLift)}</b>씩.
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-gray-400">«최근 최고» = 최근 8주 중 7일 평균이 가장 좋았던 값(재구매는 최근 두 28일 중 큰 값). 외부 채널은 최근 평균 유지 가정.</p>
            </div>

            <SectionTitle id="growth-simulator" title="시뮬레이터" question="이렇게 바꾸면 연말에 어디에 닿나" />
            <div className="rounded-[10px] border border-gray-200 bg-white p-4">
              <Simulator
                ownDaily={goal.pacing.currentDailyOwnMall}
                externalDaily={goal.pacing.currentDailyExternal}
                actualToDate={goal.pacing.actualToDate}
                remainingDays={goal.pacing.remainingDays}
                target={goal.pacing.annualTarget}
              />
            </div>
          </>
        ) : null}

        <SectionTitle id="growth-trust" title="이 숫자를 얼마나 믿어도 되나" question="수집 한계와 모수를 숫자 옆에 정직하게" />
        {analysis ? <TrustPanel items={trust} /> : <Skeleton className="h-20 w-full" />}
      </div>
    </StatisticsShell>
  );
}

