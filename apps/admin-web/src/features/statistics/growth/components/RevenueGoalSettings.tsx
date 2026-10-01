'use client';

import { useMemo, useState } from 'react';
import { useCreateRevenueGoal, useDeleteRevenueGoal, useGrowthSummary, useRevenueGoals } from '@/lib/services/analytics';
import { formatKrw } from '../../shared';
import { kstToday } from '../../as-of';
import { hasExternalChannels, monitorStats, scopedDaily } from '../model';
import { allocateByDays, plannedAnnual, type PlanAssumptions } from '../planner';

/** 연간 목표가 이 값을 넘으면 원 단위와 만원 단위를 헷갈린 입력일 가능성이 높다(서버 상한과 같다). */
const SANITY_MAX = 1_000_000_000_000;
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

const won = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}억원`;
  if (abs >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
};

function parseWon(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 연간 매출 목표. 고정비와 같은 «관리자 입력값»이고, 수정 대신 새 행을 쌓는다(가장 늦은 행이 현재 목표).
 * 계획 도우미: 지금 우리 숫자(최근 28일)를 채워 둔 바텀업 계산 — 가정을 바꿔 보고 그 결과를 목표로 쓸 수 있다.
 */
export function RevenueGoalSettings() {
  const thisYear = Number(kstToday().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [scope, setScope] = useState<'own_mall' | 'all_channels'>('own_mall');
  const goals = useRevenueGoals(year);
  const summary = useGrowthSummary();
  const createGoal = useCreateRevenueGoal();
  const deleteGoal = useDeleteRevenueGoal();

  const [annual, setAnnual] = useState('');
  const [preCoverage, setPreCoverage] = useState('');
  const [memo, setMemo] = useState('');
  const [customMonths, setCustomMonths] = useState<string[] | null>(null);
  const [plan, setPlan] = useState<PlanAssumptions | null>(null);
  const [ordersPlan, setOrdersPlan] = useState<{ dailyOrders: number; averageOrderValue: number; externalDailyRevenue: number } | null>(null);
  const [planUsed, setPlanUsed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const monitor = useMemo(() => (summary.data ? monitorStats(summary.data, null) : null), [summary.data]);
  const defaults: PlanAssumptions | null = monitor
    ? {
        dailySessions: Math.round(monitor.sessionsPerDay ?? 0),
        orderConversionRate: monitor.sessionsPerDay ? monitor.ordersPerDay / monitor.sessionsPerDay : 0,
        averageOrderValue: monitor.ordersPerDay > 0 ? Math.round(monitor.ownNetPerDay / monitor.ordersPerDay) : 0,
        externalDailyRevenue: Math.round(
          (summary.data?.monitorDaily ?? []).slice(-29, -1).reduce((s, d) => s + d.allChannels - d.ownMall, 0) / 28,
        ),
      }
    : null;
  // GA4 가 없으면 방문을 모른다 — 0 으로 채우면 자사몰 매출이 0 인 계획이 된다. 그때는 «하루 주문 수 × 객단가»로 짠다.
  const ordersMode = monitor != null && monitor.sessionsPerDay == null;
  const assumptions = plan ?? defaults;
  const ordersAssumptions =
    ordersPlan ?? (ordersMode && defaults ? { dailyOrders: Number(monitor?.ordersPerDay.toFixed(1)), averageOrderValue: defaults.averageOrderValue, externalDailyRevenue: defaults.externalDailyRevenue } : null);
  // 올해 계획은 «어제까지 집계 실적 + 남은 날 × 하루». 집계 실적에는 결제 환불·집계 시작 전 실적이 빠져 있다.
  const today = summary.data?.today ?? kstToday();
  // «전 채널»은 외부 채널 매출이 집계에 실제로 있을 때만 고를 수 있다 — 없으면 자사몰과 같은 숫자라 고를 의미가 없다.
  const externalAvailable = summary.data ? hasExternalChannels(summary.data) : false;
  const effectiveScope = externalAvailable ? scope : 'own_mall';
  const ownOnly = effectiveScope === 'own_mall';
  const actualToYesterday = scopedDaily(summary.data?.ytdDaily ?? [], effectiveScope)
    .filter((d) => d.date < today)
    .reduce((s, d) => s + d.allChannels, 0);
  const dailyTotal = ordersMode
    ? ordersAssumptions
      ? ordersAssumptions.dailyOrders * ordersAssumptions.averageOrderValue + (ownOnly ? 0 : ordersAssumptions.externalDailyRevenue)
      : null
    : assumptions
      ? assumptions.dailySessions * assumptions.orderConversionRate * assumptions.averageOrderValue + (ownOnly ? 0 : assumptions.externalDailyRevenue)
      : null;
  const isCurrentYear = year === Number(today.slice(0, 4));
  const planAnnual = dailyTotal != null ? plannedAnnual({ year, today, dailyTotal, actualToYesterday }) : null;

  const amount = parseWon(annual);
  const validAmount = amount != null && !Number.isNaN(amount) && amount >= 1 && amount <= SANITY_MAX ? Math.round(amount) : null;
  const allocation = validAmount != null ? allocateByDays(year, validAmount) : null;
  const months = customMonths ? customMonths.map((m) => parseWon(m) ?? 0) : allocation;
  const monthSum = months ? months.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0) : 0;
  const coverageStart = summary.data?.coverageStart ?? null;
  const needsPreCoverage = coverageStart != null && coverageStart > `${year}-01-01` && coverageStart <= `${year}-12-31`;

  const submit = () => {
    if (validAmount == null) {
      setFormError(amount != null && amount > SANITY_MAX ? '입력이 너무 큽니다 — 만원이 아니라 원 단위인지 확인하세요' : '연간 목표를 원 단위 숫자로 입력하세요 (예: 1200000000)');
      return;
    }
    if (customMonths && (months?.some((m) => Number.isNaN(m) || m < 0) || monthSum !== validAmount)) {
      setFormError(`월별 목표의 합(${monthSum.toLocaleString('ko-KR')}원)이 연간 목표와 같아야 합니다`);
      return;
    }
    const pre = parseWon(preCoverage);
    if (pre != null && (Number.isNaN(pre) || pre < 0 || pre > SANITY_MAX)) {
      setFormError('집계 시작 전 실적을 원 단위 숫자로 입력하세요');
      return;
    }
    setFormError(null);
    createGoal.mutate(
      {
        year,
        scope: effectiveScope,
        annualTarget: validAmount,
        monthlyTargets: customMonths ? months ?? undefined : undefined,
        preCoverageActual: pre ?? undefined,
        // 방문·전환 가정은 GA4 가 있을 때만 저장한다(주문 기준 계획은 그 네 칸으로 표현되지 않는다).
        planAssumptions: planUsed && !ordersMode && assumptions ? { ...assumptions, externalDailyRevenue: ownOnly ? 0 : assumptions.externalDailyRevenue } : undefined,
        memo: memo.trim() || undefined,
      },
      {
        onSuccess: () => {
          setAnnual('');
          setPreCoverage('');
          setMemo('');
          setCustomMonths(null);
          setPlan(null);
          setOrdersPlan(null);
          setPlanUsed(false);
        },
        onError: () => setFormError('등록에 실패했습니다. 잠시 후 다시 시도하세요.'),
      },
    );
  };

  const field = 'rounded border border-gray-200 bg-white px-2 py-1.5 tabular-nums';
  return (
    <div className="mt-3 space-y-4">
      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500">연도</span>
            <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setCustomMonths(null); }} className={field}>
              {[thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500">목표 범위</span>
            <select
              name="goalScope"
              value={effectiveScope}
              disabled={!externalAvailable}
              onChange={(e) => setScope(e.target.value === 'all_channels' ? 'all_channels' : 'own_mall')}
              className={`${field} disabled:bg-gray-100 disabled:text-gray-500`}
              title={externalAvailable ? undefined : '외부 판매채널 매출이 집계에 들어오면 선택할 수 있습니다'}
            >
              <option value="own_mall">자사몰</option>
              <option value="all_channels">전 판매채널</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500">연간 목표 — {ownOnly ? '자사몰' : '전 판매채널'} 순매출 (원)</span>
            <input
              type="text"
              name="annualTarget"
              autoComplete="off"
              inputMode="numeric"
              value={annual}
              onChange={(e) => { setAnnual(e.target.value); setCustomMonths(null); }}
              placeholder="1200000000"
              className={`${field} w-48`}
            />
          </label>
          {needsPreCoverage ? (
            <label className="flex flex-col gap-1">
              <span className="text-gray-500">집계 시작 전 실적 (1/1~{coverageStart}) — 선택</span>
              <input type="text" name="preCoverageActual" autoComplete="off" inputMode="numeric" value={preCoverage} onChange={(e) => setPreCoverage(e.target.value)} placeholder="모르면 비워 두세요" className={`${field} w-48`} />
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-gray-500">메모</span>
            <input type="text" name="goalMemo" autoComplete="off" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={255} placeholder="예: 3분기 회의 확정" className={`${field} w-44`} />
          </label>
          <button type="button" onClick={submit} disabled={createGoal.isPending} className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            등록
          </button>
          {validAmount != null ? <span className="pb-1.5 text-gray-500">= {won(validAmount)} · 하루 평균 {won(validAmount / (year % 4 === 0 ? 366 : 365))}</span> : null}
        </div>
        {formError ? <p className="text-xs text-red-500">{formError}</p> : null}
        {!externalAvailable && summary.data ? (
          <p className="text-[11px] text-gray-500">
            지금 집계에는 자사몰 매출만 있어 목표 범위는 «자사몰»로 고정됩니다. 네이버·쿠팡 등 외부 판매채널 매출이 집계에 들어오면 «전 판매채널»을 고를 수 있습니다.
          </p>
        ) : null}

        {months ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-gray-500">월별 배분 {customMonths ? '(직접 조정 중)' : '(월 일수에 비례 — 계절성은 넣지 않았습니다)'}</span>
              <button
                type="button"
                className="text-orange-600 hover:underline"
                onClick={() => setCustomMonths(customMonths ? null : (allocation ?? []).map(String))}
              >
                {customMonths ? '일수 비례로 되돌리기' : '월별로 직접 조정'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 xl:grid-cols-12">
              {months.map((m, i) => (
                <label key={MONTHS[i]} className="flex flex-col gap-0.5 text-[11px] text-gray-500">
                  {MONTHS[i]}
                  {customMonths ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={customMonths[i]}
                      onChange={(e) => setCustomMonths((prev) => (prev ? prev.map((v, j) => (j === i ? e.target.value : v)) : prev))}
                      className="rounded border border-gray-200 bg-white px-1.5 py-1 text-xs tabular-nums text-gray-900"
                    />
                  ) : (
                    <span className="rounded border border-gray-200 bg-white px-1.5 py-1 text-xs tabular-nums text-gray-900">{won(m)}</span>
                  )}
                </label>
              ))}
            </div>
            {customMonths && validAmount != null && monthSum !== validAmount ? (
              <p className="mt-1 text-xs text-red-500">월 합계 {won(monthSum)} — 연간 목표와 {won(validAmount - monthSum)} 차이</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-3">
        <p className="text-sm font-semibold text-gray-900">계획 도우미 — 세 축으로 연매출 짜 보기</p>
        <p className="mt-0.5 text-xs text-gray-500">
          하루 매출 = 하루 방문 × 주문 전환율 × 객단가{ownOnly ? '' : ' + 외부 채널 하루 순매출'}. {isCurrentYear ? `올해는 어제까지 실제 실적 ${won(actualToYesterday)}에 남은 날을 이 하루 매출로 채웁니다(결제 환불·집계 시작 전 실적 제외).` : '그 해 전체를 이 하루 매출로 채웁니다.'} 처음 값은 최근 28일 실제 숫자입니다.
        </p>
        {ordersMode && ordersAssumptions ? (
          <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
            <p className="w-full text-[11px] text-amber-700">GA4 미연동이라 방문·전환을 알 수 없어 «하루 주문 수 × 객단가»로 계산합니다.</p>
            {(
              [
                ['dailyOrders', '하루 주문 수(자사몰)'],
                ['averageOrderValue', '객단가(원)'],
                ['externalDailyRevenue', '외부 채널 하루 순매출(원)'],
              ] as const
            ).filter(([key]) => !(ownOnly && key === 'externalDailyRevenue')).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-gray-500">{label}</span>
                <input
                  type="number"
                  step={key === 'dailyOrders' ? 0.1 : 1}
                  value={ordersAssumptions[key]}
                  onChange={(e) => setOrdersPlan({ ...ordersAssumptions, [key]: Number(e.target.value) })}
                  className={`${field} w-36`}
                />
              </label>
            ))}
            <div className="pb-1">
              <span className="text-gray-500">= </span>
              <b className="tabular-nums text-gray-900">{planAnnual != null ? won(planAnnual) : '-'}</b>
              <span className="text-gray-500"> / {year}년</span>
            </div>
            <button
              type="button"
              disabled={planAnnual == null || planAnnual < 1}
              onClick={() => { setAnnual(String(planAnnual)); setCustomMonths(null); setPlanUsed(true); }}
              className="rounded border border-orange-300 px-2.5 py-1.5 font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-40"
            >
              이 값을 목표로
            </button>
          </div>
        ) : assumptions ? (
          <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
            {(
              [
                ['dailySessions', '하루 방문', 1],
                ['orderConversionRate', '주문 전환율(%)', 100],
                ['averageOrderValue', '객단가(원)', 1],
                ['externalDailyRevenue', '외부 채널 하루 순매출(원)', 1],
              ] as const
            ).filter(([key]) => !(ownOnly && key === 'externalDailyRevenue')).map(([key, label, scale]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-gray-500">{label}</span>
                <input
                  type="number"
                  step={key === 'orderConversionRate' ? 0.01 : 1}
                  value={Number((assumptions[key] * scale).toFixed(key === 'orderConversionRate' ? 2 : 0))}
                  onChange={(e) => setPlan({ ...assumptions, [key]: Number(e.target.value) / scale })}
                  className={`${field} w-36`}
                />
              </label>
            ))}
            <div className="pb-1">
              <span className="text-gray-500">= </span>
              <b className="tabular-nums text-gray-900">{planAnnual != null ? won(planAnnual) : '-'}</b>
              <span className="text-gray-500"> / {year}년</span>
            </div>
            <button
              type="button"
              disabled={planAnnual == null || planAnnual < 1}
              onClick={() => { setAnnual(String(planAnnual)); setCustomMonths(null); setPlan(assumptions); setPlanUsed(true); }}
              className="rounded border border-orange-300 px-2.5 py-1.5 font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-40"
            >
              이 값을 목표로
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-400">최근 숫자를 불러오는 중이거나 데이터가 없습니다.</p>
        )}
        {validAmount != null && planAnnual != null && planAnnual > 0 ? (
          <p className="mt-2 text-xs text-gray-600">
            입력한 목표는 이 계획의 <b className="tabular-nums">{((validAmount / planAnnual) * 100).toFixed(0)}%</b> —{' '}
            {validAmount > planAnnual ? `가정보다 ${won(validAmount - planAnnual)} 더 팔아야 합니다` : '가정대로면 닿습니다'}
          </p>
        ) : null}
      </div>

      <div>
        <p className="mb-1 text-xs text-gray-500">{year}년 목표 이력 — 맨 위가 현재 목표. 지우면 바로 아래 행이 다시 현재 목표가 됩니다.</p>
        {goals.isError ? (
          <p className="text-xs text-red-500">목표를 불러오지 못했습니다.</p>
        ) : goals.isLoading ? (
          <p className="text-xs text-gray-400">불러오는 중…</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-1.5 text-left">등록</th>
                <th className="py-1.5 text-right">연간 목표</th>
                <th className="py-1.5 text-right">집계 전 실적</th>
                <th className="py-1.5 pl-4 text-left">메모</th>
                <th className="py-1.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {(goals.data?.history ?? []).map((g, i) => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="py-1.5 tabular-nums">
                    {g.createdAt.slice(0, 10)} {i === 0 ? <span className="ml-1 rounded bg-orange-50 px-1 text-[10px] text-orange-700">현재</span> : null}
                    <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-600">{g.scope === 'all_channels' ? '전 판매채널' : '자사몰'}</span>
                    {g.planAssumptions ? <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-600">계획 도우미</span> : null}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatKrw(g.annualTarget)}</td>
                  <td className="py-1.5 text-right tabular-nums">{g.preCoverageActual != null ? formatKrw(g.preCoverageActual) : '-'}</td>
                  <td className="py-1.5 pl-4 text-gray-500">{g.memo ?? ''}</td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => deleteGoal.mutate(g.id)}
                      disabled={deleteGoal.isPending}
                      className="rounded border border-gray-200 px-2 py-0.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {goals.data && goals.data.history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-400">
                    {year}년 목표가 없습니다 — 위에서 입력하면 성장 탭과 관리자 메인에 진척이 나타납니다
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
