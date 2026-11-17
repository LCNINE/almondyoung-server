'use client';

import { useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, daysBetweenInclusive, daysInMonth } from '../growth/calendar';
import { planBetween } from '../growth/pacing';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api/client';
import { ANALYTICS_SERVICE_BASE_URL } from '@/const/api-const';
import { useGrowthSummary } from '@/lib/services/analytics';
import {
  useOrderRefunds,
  useMembershipRevenue,
} from '@/lib/services/wallet/queries';
import { refundMap, OWN_MALL_CHANNEL } from '../growth/model';
import { kstToday } from '../as-of';
import { formatKrw, formatKrwAxis } from '../shared';
import {
  annualCompanyRevenue,
  REVENUE_CHANNELS,
  type RevenueChannel,
} from './company-revenue';
import { appendGoalEvidence, goalExportRows } from './goal-export';
import { appendCompanyRevenueEvidence } from './company-revenue-export';
import { BASES, CHANNELS, type RevenueReport } from './model';
import { CompanyMonthlyRevenue } from './CompanyMonthlyRevenue';

/** Shared annual view: every statistics tab and the home goal read the same persisted uploads. */
export function CompanyRevenueCard() {
  const [channel, setChannel] = useState<RevenueChannel>('all');
  const summaryQuery = useGrowthSummary();
  const summary = summaryQuery.data;
  const year = summary?.year ?? Number(kstToday().slice(0, 4));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const report = useQuery({
    queryKey: ['revenue-report', year],
    queryFn: async () =>
      (
        await client.get<RevenueReport>(
          `${ANALYTICS_SERVICE_BASE_URL}/statistics/revenue-report?year=${year}&includeHistory=false`
        )
      ).data,
    staleTime: 60_000,
  });
  const refundsQuery = useOrderRefunds(
    `${year ?? ''}-01-01`,
    summary?.today ?? '',
    Boolean(summary)
  );
  const membershipQuery = useMembershipRevenue(
    `${year}-01-01`,
    addDays(summary?.today ?? kstToday(), -1)
  );
  const membership =
    membershipQuery.isError || membershipQuery.data?.paymentCount === undefined
      ? null
      : membershipQuery.data;
  const loading =
    summaryQuery.isPending ||
    report.isPending ||
    membershipQuery.isPending ||
    membershipQuery.isPlaceholderData ||
    (Boolean(summary) && refundsQuery.isLoading);

  if (summaryQuery.isError || report.isError) {
    return (
      <p role="alert" className="mb-4 rounded-lg border p-4 text-sm">
        통합 매출을 불러오지 못했습니다. 일부 금액만 합산하지 않습니다.
      </p>
    );
  }
  if (loading || !summary || !report.data) {
    return (
      <p className="mb-4 rounded-lg border p-4 text-sm">
        통합 매출을 불러오는 중입니다.
      </p>
    );
  }

  const refunds = refundsQuery.isError
    ? null
    : refundMap(refundsQuery.data?.series);
  const base = summary.goal ? goalExportRows(summary, refunds) : null;
  const revenue = annualCompanyRevenue({
    today: summary.today,
    coverageStart: summary.coverageStart,
    hasIntegratedChannels: summary.channels.some(
      (item) => item !== OWN_MALL_CHANNEL
    ),
    daily: summary.ytdDaily,
    refunds,
    external: report.data.external,
    membership: membership?.series ?? null,
  });
  const { imported } = revenue;
  const registeredAt = summary.goal?.createdAt;
  const registeredDate =
    registeredAt && Number.isFinite(Date.parse(registeredAt))
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(registeredAt))
      : null;
  const registrationDaily =
    base && registeredDate && refunds !== null
      ? base.rows
          .filter((row) => row.일자 < registeredDate)
          .reduce((sum, row) => sum + row.목표반영액, 0)
      : null;

  const total = revenue.totals?.all ?? null;
  const selectedAmount = revenue.totals?.[channel] ?? null;
  const target = summary.goal?.annualTarget ?? 0;
  const selectedRatio =
    selectedAmount !== null && target > 0 ? selectedAmount / target : null;
  const remaining = total === null ? null : Math.max(target - total, 0);
  const remainingDays = daysBetweenInclusive(
    summary.today,
    `${summary.year}-12-31`
  );
  const asOf = addDays(summary.today, -1);
  let cumulative = 0;
  const chart = revenue.monthly.map((row) => {
    cumulative += row[channel];
    const monthEnd = addDays(
      `${row.month}-01`,
      daysInMonth(summary.year, Number(row.month.slice(5))) - 1
    );
    const end = row.month === revenue.currentMonth ? asOf : monthEnd;

    return {
      month: row.month,
      actual:
        row.month <= revenue.currentMonth && selectedAmount !== null
          ? cumulative
          : null,
      plan:
        channel === 'all' && summary.goal
          ? planBetween(
              summary.year,
              summary.goal.monthlyTargets,
              `${summary.year}-01-01`,
              end
            )
          : null,
    };
  });

  async function download() {
    if (!summary || !report.data) return;

    setExporting(true);
    setError('');
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      appendCompanyRevenueEvidence(
        XLSX,
        book,
        summary,
        refunds,
        report.data.external,
        channel,
        membership
      );
      if (summary.goal) appendGoalEvidence(XLSX, book, summary, refunds);
      XLSX.writeFile(book, `매출목표_${summary.year}_통합근거.xlsx`);
    } catch {
      setError('엑셀을 만들지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section
      className="mb-4 space-y-4 rounded-lg border border-gray-200 bg-white p-4"
      aria-label="회사 전체 매출 목표"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {summary.year}년 회사 매출 · 수집 자료 기준
        </h2>
        <div className="flex flex-wrap gap-3 text-sm text-orange-800">
          <button
            type="button"
            onClick={() => {
              void download();
            }}
            disabled={exporting || total === null}
          >
            {exporting ? '생성 중…' : '매출 근거 엑셀'}
          </button>
          <Link href="/statistics/sales#revenue-report">
            자료 업로드·다운로드
          </Link>
          <Link href="/statistics/settings#revenue-goal">목표 설정</Link>
        </div>
      </div>
      <p className="rounded-md bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
        현재 금액은 수집한 매출의 소계입니다. 직접 거래·OEM·서비스 매출과 은행
        입금 대조를 진행 중이므로 회사 전체 확정 매출로 보시면 안 됩니다. 상품
        매출과 멤버십 결제를 합산하며, 수수료는 매출에서 중복 차감하지 않고
        비용·정산액으로 구분합니다.
      </p>
      <div
        role="group"
        aria-label="매출 채널 선택"
        className="flex flex-wrap gap-1"
      >
        {(Object.keys(REVENUE_CHANNELS) as RevenueChannel[])
          .filter(
            (key) =>
              !['phone', 'other'].includes(key) ||
              revenue.monthly.some((row) => row[key] !== 0)
          )
          .map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={channel === key}
              onClick={() => setChannel(key)}
              className={`rounded-md px-3 py-1.5 text-sm ${channel === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {REVENUE_CHANNELS[key]}
            </button>
          ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500">
              {channel === 'all'
                ? '올해 매출 소계'
                : `올해 ${REVENUE_CHANNELS[channel]} 매출`}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {selectedAmount === null
                ? '결제·환불 확인 필요'
                : formatKrw(selectedAmount)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {channel === 'own_mall'
                ? '이전 카페24 자사몰 매출 포함'
                : '등록된 매출 자료 기준 · 잠정'}
            </p>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-gray-500">
                {channel === 'all'
                  ? '수집분 기준 목표 달성률'
                  : '회사 연간 목표 기여율'}
              </span>
              <strong className="text-xl tabular-nums">
                {selectedRatio === null
                  ? '—'
                  : `${(selectedRatio * 100).toFixed(1)}%`}
              </strong>
            </div>
            <div
              className="mt-1 h-3 overflow-hidden rounded-full bg-gray-100"
              role="img"
              aria-label={`${channel === 'all' ? '목표 달성률' : '목표 기여율'} ${selectedRatio === null ? '확인 필요' : `${(selectedRatio * 100).toFixed(1)}%`}`}
            >
              <div
                className="h-full bg-blue-500"
                style={{
                  width: `${Math.max(0, Math.min(selectedRatio ?? 0, 1)) * 100}%`,
                }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              회사 연간 목표 {target > 0 ? formatKrw(target) : '미설정'}
            </p>
          </div>
          {target > 0 && remaining !== null ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">회사 목표까지</p>
                <p className="mt-1 font-bold">{formatKrw(remaining)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">하루에 필요한 매출</p>
                <p className="mt-1 font-bold">
                  {remainingDays > 0
                    ? formatKrw(Math.ceil(remaining / remainingDays))
                    : '—'}
                </p>
                <p className="text-[11px] text-gray-500">
                  전체 채널 · 남은 {remainingDays}일
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-xs text-gray-500">
            {REVENUE_CHANNELS[channel]} 누적 매출 · 월별
          </p>
          {selectedAmount === null ? (
            <p role="alert" className="py-12 text-sm">
              결제·환불 자료 확인 후 매출과 달성률을 표시합니다.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart
                data={chart}
                margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="month"
                  tickFormatter={(value: string) =>
                    `${Number(value.slice(5))}월`
                  }
                  tick={{ fontSize: 11 }}
                />
                <YAxis tickFormatter={formatKrwAxis} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number) => formatKrw(value)}
                  labelFormatter={(value) =>
                    `${value}${value === revenue.currentMonth ? ' · 진행 중' : ''}`
                  }
                />
                <Area
                  type="linear"
                  dataKey="actual"
                  name="실적 누적"
                  stroke="#2878df"
                  fill="#2878df"
                  fillOpacity={0.12}
                  connectNulls={false}
                />
                <Line
                  type="linear"
                  dataKey="plan"
                  name="계획 누적"
                  stroke="#9ca3af"
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 flex gap-3 text-xs text-gray-500">
            <span className="text-blue-600">실적 누적</span>
            {channel === 'all' ? <span>계획 누적</span> : null}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            자사몰·멤버십 {asOf}까지 + 채널별 업로드 자료. 이번 달은 등록된
            금액까지만 반영합니다.
          </p>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        연초부터의 누적 매출입니다. 미확인 자료는 합산에서 제외하며, 채널별 반영
        기간은 아래에서 확인할 수 있습니다.
      </p>
      {base && base.preCoverageActual !== 0 ? (
        <details
          aria-label="이전 표시액과 현재 매출의 차이"
          className="space-y-2 rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-700"
        >
          <summary className="cursor-pointer text-lg font-bold text-gray-900">
            이전 표시액과 달라진 이유
          </summary>
          <div className="space-y-5 pt-3">
            <p className="font-medium text-gray-900">
              현재 금액은 메두사 자사몰 자동 집계에 카페24·스마트스토어·쿠팡 등
              합산 대상으로 등록된 자료와 멤버십 수입을 더한 매출 소계입니다.
              메두사 매출도 포함되어 있습니다. 이전 화면의 출처 미확인 수기
              보정액을 자료별 금액으로 바꾼 결과이며, 아직 세무 신고용 확정
              매출은 아닙니다.
            </p>
            <div className="space-y-2">
              <h3 className="font-bold text-gray-900">
                1. 이전 금액은 어떻게 계산했나요?
              </h3>
              <p>
                이전 화면은 수기 보정액 {formatKrw(base.preCoverageActual)}에
                메두사 집계 매출을 더했습니다. 수기 보정액은 자동 집계가
                시작되기 전의 매출을 보충하려고 입력한 값입니다.
                {registeredDate
                  ? ` 목표 등록일은 ${registeredDate}(한국시간)입니다.`
                  : ''}
                {summary.goal?.memo
                  ? ` 당시 등록 메모: “${summary.goal.memo}”.`
                  : ''}
              </p>
              {registrationDaily !== null ? (
                <p>
                  현재 자료로 등록일 전일까지 다시 계산하면, 기준 누적액{' '}
                  {formatKrw(base.preCoverageActual + registrationDaily)} −
                  메두사 실적 {formatKrw(registrationDaily)} = 수기 보정액{' '}
                  {formatKrw(base.preCoverageActual)}으로 일치합니다. 즉, 당시
                  참고한 누적 금액에 맞추기 위해 차액을 입력한 계산으로
                  설명됩니다. 다만 당시 자료를 따로 보관한 사본이 아니라 현재
                  원장으로 검산한 결과입니다.
                </p>
              ) : null}
              <p>
                그 기준 누적액이 어느 판매처·기간·취소 기준으로 집계됐는지는
                확인되지 않았습니다. 셀메이트 조회액을 참고했을 가능성은 있지만
                당시 원본과 포함 채널이 확인되지 않아 출처를 확정하지 않습니다.
                따라서 이 수기액을 실제 주문 증빙으로 확인된 매출처럼 계속
                더하지 않습니다.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-gray-900">
                2. 지금은 어떤 자료를 합산하나요?
              </h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  현재 자사몰(메두사): 전환 후 새 주문의 자동 집계 매출을
                  반영합니다. 취소·환불을 차감하며 {asOf}까지 반영합니다.
                </li>
                <li>
                  이전 자사몰(카페24): 업로드한 월별 매출 중 합산 대상으로
                  확인한 자료를 반영합니다. 메두사 전환 후에도 카페24에 남은
                  매출은 해당 월 자료에 따라 반영합니다.
                </li>
                <li>
                  스마트스토어·쿠팡: 각 판매자센터에서 받은 자료를 업로드한
                  기간까지 반영합니다. 채널마다 구매확정·결제완료 등 집계 기준이
                  다를 수 있습니다.
                </li>
                <li>
                  멤버십: 가입·등급 변경·정기결제의 실제 수금에서 성공 환불을
                  차감합니다. 청구서와 결제액을 중복 합산하지 않습니다.
                </li>
                <li>
                  전화·수동 주문 등: 기존 자사몰·다른 채널 주문과 겹치지 않는지
                  확인하고 합산 대상으로 등록한 자료만 반영합니다.
                </li>
              </ul>
              <p>
                아래 월별 표에서 메두사와 카페24를 각각 확인할 수 있습니다. 채널
                선택의 ‘자사몰’은 둘을 합친 금액입니다. 미등록 기간은 매출이
                없다는 뜻이 아니며, 진행 중인 달은 수집한 날짜까지만 포함합니다.
                ‘매출 근거 엑셀’에서 월별 금액과 합산 근거를 내려받을 수
                있습니다.
              </p>
            </div>
            {refunds !== null && total !== null ? (
              <div className="space-y-2">
                <h3 className="font-bold text-gray-900">
                  3. 이전 방식과 지금 금액은 얼마나 다른가요?
                </h3>
                <p>
                  메두사 집계 기준일을 {asOf}로 맞춰 비교한 계산입니다. 업로드
                  자료의 종료일은 채널마다 다를 수 있습니다.
                </p>
                <p>
                  이전 방식: 수기 보정액 {formatKrw(base.preCoverageActual)} +
                  메두사{' '}
                  {formatKrw(
                    base.rows.reduce((sum, row) => sum + row.목표반영액, 0)
                  )}{' '}
                  = <strong>{formatKrw(base.pacing.actualToDate)}</strong>
                </p>
                <p>
                  현재 방식: 상품 자동 집계{' '}
                  {formatKrw(revenue.dailyAmount ?? 0)} + 합산 대상 업로드 자료{' '}
                  {formatKrw(imported.amount)} + 멤버십{' '}
                  {formatKrw(membership?.totalAmount ?? 0)} ={' '}
                  <strong>{formatKrw(total)}</strong>
                </p>
                <p>
                  두 방식의 차이는{' '}
                  {formatKrw(Math.abs(base.pacing.actualToDate - total))}입니다.
                  메두사 매출을 통째로 제외해서 생긴 차이가 아니라, 출처 미확인
                  수기액을 등록된 채널 자료로 교체하면서 생긴 차이입니다. 이
                  차액 자체를 누락 매출이나 실제 매출 감소로 단정할 수는
                  없습니다.
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <h3 className="font-bold text-gray-900">
                4. 셀메이트 금액을 그대로 더하지 않는 이유는 무엇인가요?
              </h3>
              <p>
                셀메이트에는 배송 처리를 위해 메두사·카페24·다른 채널의 같은
                주문을 옮겨 입력합니다. 이를 다시 더하면 같은 매출을 두 번
                계산하게 됩니다. 주문금액에는 할인·취소·환불 반영 차이가 있고
                다른 업체의 배송대행 물량도 섞일 수 있어, 셀메이트 전체
                주문금액과 회사 매출이 그대로 일치하지는 않습니다. 배송대행
                업체의 상품 판매액은 회사 매출에 넣지 않으며, 은행 정산 입금도
                이미 잡힌 매출에 다시 더하지 않습니다.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-gray-900">
                5. 현재 금액은 어디까지 확인된 결과인가요?
              </h3>
              <p>
                현재 화면은 자동 집계와 등록 자료를 같은 월별 합계에 모아
                보여주는 잠정 결과입니다. 메두사 매출의 포함 여부와 월별 합계는
                확인했지만, 모든 매출의 누락·중복 검증이 끝났다는 의미는
                아닙니다. 전화·수동 주문의 누락·중복, 채널별 미수집 기간,
                취소·환불 중복 차감과 실제 정산 입금은 추가 대조가 필요합니다.
                확인 결과에 따라 금액이 바뀔 수 있습니다.
              </p>
              <p className="font-medium">
                아래 합산 보류 건수는 등록 자료의 합산 상태이며, 전체 검토
                완료를 뜻하지 않습니다. 보류가 0건이어도 아직 수집하지 않은
                자료나 입금 대조까지 모두 끝난 것은 아닙니다.
              </p>
            </div>
          </div>
        </details>
      ) : null}
      <CompanyMonthlyRevenue
        revenue={revenue}
        coverageStart={summary.coverageStart}
      />
      <details className="text-sm">
        <summary className="cursor-pointer">
          합산 근거 · 등록 자료 중 합산 보류 {imported.excludedCount}건
        </summary>
        <p className="my-2 text-xs leading-relaxed text-gray-600">
          자사몰은 현재 자사몰과 전환 전 카페24 자료를 합칩니다. 출처 미확인
          수기 누적액 {formatKrw(base?.preCoverageActual ?? 0)}은 제외했습니다.
          카페24 전환기·전화 주문은 중복 대조 후 반영합니다. 셀메이트에 옮겨
          입력한 주문과 은행 입금은 별도 매출로 더하지 않습니다. 채널별
          매출·환불 기준이 달라 잠정 금액이며, 기존 취소와 결제 환불의 중복 차감
          여부도 확인 중입니다. 월별 자료를 일별 실적으로 나누지 않으므로 회사
          전체 연말 예측·달성 확률·이익은 아직 계산하지 않습니다.
        </p>
        <p className="my-2 text-xs text-gray-600">
          월 합계만 있는 자료는 아래 일별·상품·고객·이익 지표에 배분하지
          않습니다. 카페24 전환기와 전화 주문은 자사몰·다른 채널과 중복 대조 후
          반영합니다. 제외한 수기액과 카페24 금액의 차이는 미확인 차이이며 누락
          매출로 간주하지 않습니다.
        </p>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th>월</th>
                <th>채널·계정</th>
                <th>기준</th>
                <th>금액</th>
                <th>반영</th>
              </tr>
            </thead>
            <tbody>
              {imported.rows.map((row) => (
                <tr
                  key={JSON.stringify([
                    row.channel,
                    row.account,
                    row.month,
                    row.basis,
                  ])}
                  className="border-t"
                >
                  <td className="py-2">{row.month}</td>
                  <td>
                    {CHANNELS[row.channel] ?? row.channel} · {row.account}
                  </td>
                  <td>{BASES[row.basis] ?? row.basis}</td>
                  <td>{formatKrw(row.amount)}</td>
                  <td>{row.included ? '잠정 합산' : row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
