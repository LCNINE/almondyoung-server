'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ProfitSort } from '@/lib/api/domains/analytics';
import { useProfitStatistics } from '@/lib/services/analytics';
import { useFeeRates, useFeeSummary, useMembershipRevenue } from '@/lib/services/wallet/queries';
import { useCreateFeeRate, useDeleteFeeRate } from '@/lib/services/wallet/mutations';
import type { FeeSummaryDto, MembershipRevenueDto, WalletPaymentMethodType } from '@/lib/types/dto/wallet';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList, KpiTile } from '../components/widgets';
import { formatCount, formatKrw, formatKrwAxis, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

const METHOD_LABELS: Record<string, string> = {
  POINTS: '포인트',
  CARD: '카드',
  BANK_TRANSFER: '무통장입금',
  BNPL: 'BNPL',
  TOSS: '토스페이먼츠',
  NICEPAY: '나이스페이',
  TOSS_BILLING: '토스 정기결제',
  NICEPAY_BILLING: '나이스페이 정기결제',
  CMS_BATCH: '효성 CMS',
};

const METHOD_TYPES = Object.keys(METHOD_LABELS) as WalletPaymentMethodType[];

function methodLabel(methodType: string): string {
  return METHOD_LABELS[methodType] ?? methodType;
}

/** 만분율 → 표시용 퍼센트 (2.75% 같은 소수 둘째 자리 유지) */
function formatBp(bp: number | null): string {
  if (bp == null) return '미설정';
  return `${(bp / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
}

const SORT_OPTIONS: ReadonlyArray<{ value: ProfitSort; label: string }> = [
  { value: 'margin', label: '마진순' },
  { value: 'marginRate', label: '마진율순' },
  { value: 'revenue', label: '순매출순' },
  { value: 'quantity', label: '판매량순' },
];

const ORDER_OPTIONS = [
  { value: 'desc', label: '상위' },
  { value: 'asc', label: '하위' },
] as const;

const PAGE_SIZE = 50;

export default function ProfitStatisticsTemplate() {
  const range = useStatisticsRange();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sort = (searchParams.get('sort') as ProfitSort) ?? 'margin';
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const [page, setPage] = useState(1);

  // 조회 조건이 바뀌면 페이지가 범위를 벗어날 수 있다 — 1페이지로 되돌린다
  useEffect(() => {
    setPage(1);
  }, [range.from, range.to, range.channel]);

  const { data, isLoading, isError } = useProfitStatistics({
    from: range.from,
    to: range.to,
    channel: range.channel,
    sort,
    order,
    page,
    limit: PAGE_SIZE,
  });

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    setPage(1);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const totals = data?.totals;
  const prev = data?.previousTotals;
  const totalPages = data ? Math.max(1, Math.ceil(data.totalItems / PAGE_SIZE)) : 1;

  // 수수료·멤버십 수입은 wallet 원장 기준 전사 값이다 — 채널 필터와 무관.
  const feeQuery = useFeeSummary(range.from, range.to);
  const membershipQuery = useMembershipRevenue(range.from, range.to);
  const walletScopeMismatch = Boolean(range.channel);

  return (
    <StatisticsShell>
      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiTile
              label="추정 마진"
              value={formatKrw(totals?.estimatedMargin)}
              previous={
                totals && prev ? { current: totals.estimatedMargin, previous: prev.estimatedMargin } : undefined
              }
              hint="원가가 입력된 상품 기준 · 순매출 − 추정 원가"
              isLoading={isLoading}
            />
            <KpiTile
              label="마진율"
              value={formatPercent(totals?.marginRate)}
              hint="추정 마진 ÷ 계산 가능 순매출"
              isLoading={isLoading}
            />
            <KpiTile
              label="추정 원가"
              value={formatKrw(totals?.estimatedCost)}
              previous={totals && prev ? { current: totals.estimatedCost, previous: prev.estimatedCost } : undefined}
              hint="게시 공급가 × 판매수량 (취소·환불 금액 비례 보정)"
              isLoading={isLoading}
            />
            <KpiTile
              label="원가 커버리지"
              value={formatPercent(totals?.costCoverageRate)}
              hint="순매출 중 원가가 입력된 상품의 비중"
              isLoading={isLoading}
            />
          </div>

          {totals && totals.uncomputedNetRevenue > 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              원가 미입력 상품 {formatCount(totals.uncomputedProductsCount)}개(순매출{' '}
              {formatKrw(totals.uncomputedNetRevenue)})는 마진 계산에서 제외됐습니다. 상품 등록의 공급가를 채우면
              커버리지가 올라갑니다.
            </p>
          ) : null}

          <CombinedProfitSection
            commerceNetRevenue={totals?.netRevenue}
            commerceEstimatedMargin={totals?.estimatedMargin}
            fee={feeQuery.data}
            membership={membershipQuery.data}
            isLoading={isLoading || feeQuery.isLoading || membershipQuery.isLoading}
            channelFiltered={walletScopeMismatch}
          />

          <FeeSection
            fee={feeQuery.data}
            isLoading={feeQuery.isLoading}
            isError={feeQuery.isError}
          />

          <ChartCard
            title="마진 추이"
            description="마진·원가는 원가가 입력된 상품 몫만 반영합니다. 취소·환불이 발생일에 귀속되므로 순매출·마진이 음수인 날이 있을 수 있습니다."
            isLoading={isLoading}
            isEmpty={!data || data.series.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
                <YAxis tick={{ fontSize: 11 }} stroke="#999" tickFormatter={formatKrwAxis} />
                <Tooltip formatter={(value: number) => formatKrw(value)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="netRevenue"
                  name="순매출"
                  stroke={SERIES_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="estimatedMargin"
                  name="추정 마진"
                  stroke={SERIES_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="상품별 마진"
            description="기간 내 판매된 전 상품입니다. 원가 미입력 상품은 마진을 계산하지 않고 '계산 불가'로 표시합니다 — 마진 정렬에서는 항상 뒤로 갑니다."
            isLoading={isLoading}
            isEmpty={!data || data.totalItems === 0}
          >
            <div className="mb-3 flex flex-wrap items-center gap-1">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setParam('sort', option.value)}
                  className={
                    sort === option.value
                      ? 'rounded-full bg-orange-500 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50'
                  }
                >
                  {option.label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-gray-200" />
              {ORDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setParam('order', option.value)}
                  className={
                    order === option.value
                      ? 'rounded-full bg-gray-800 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">상품</th>
                    <th className="py-1.5 text-right">판매량</th>
                    <th className="py-1.5 text-right">순매출</th>
                    <th className="py-1.5 text-right">공급가</th>
                    <th className="py-1.5 text-right">추정 원가</th>
                    <th className="py-1.5 text-right">추정 마진</th>
                    <th className="py-1.5 text-right">마진율</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((row, index) => (
                    <tr key={row.masterId} className="border-b last:border-0">
                      <td className="py-1.5 text-gray-400">{(page - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="py-1.5">
                        <span className="font-medium text-gray-900">{row.name ?? row.masterId}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCount(row.quantitySold)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatKrw(row.netRevenue)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.supplyPrice == null ? <span className="text-gray-400">미입력</span> : formatKrw(row.supplyPrice)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.estimatedCost == null ? <span className="text-gray-400">-</span> : formatKrw(row.estimatedCost)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {row.estimatedMargin == null ? (
                          <span className="font-normal text-gray-400">계산 불가</span>
                        ) : (
                          <span className={row.estimatedMargin >= 0 ? undefined : 'text-red-600'}>
                            {formatKrw(row.estimatedMargin)}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatPercent(row.marginRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
              <span>
                전체 {formatCount(data?.totalItems)}개 상품 · {page}/{totalPages} 페이지
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            </div>
          </ChartCard>
        </div>
      )}
    </StatisticsShell>
  );
}

/** 수입 구성(멤버십/커머스) + 수수료까지 반영한 종합 손익 요약 */
function CombinedProfitSection({
  commerceNetRevenue,
  commerceEstimatedMargin,
  fee,
  membership,
  isLoading,
  channelFiltered,
}: {
  commerceNetRevenue: number | undefined;
  commerceEstimatedMargin: number | undefined;
  fee: FeeSummaryDto | undefined;
  membership: MembershipRevenueDto | undefined;
  isLoading: boolean;
  channelFiltered: boolean;
}) {
  const membershipAmount = membership?.totalAmount;
  const estimatedFee = fee?.totals.estimatedFee;
  const ready =
    commerceNetRevenue != null && commerceEstimatedMargin != null && membershipAmount != null && estimatedFee != null;
  const totalRevenue = ready ? commerceNetRevenue + membershipAmount : undefined;
  const combinedProfit = ready ? commerceEstimatedMargin + membershipAmount - estimatedFee : undefined;

  return (
    <ChartCard
      title="수입 구성과 종합 손익"
      description="멤버십 구독료(청구 확정일 기준)와 결제 수수료는 결제 원장 기준 전사 값입니다. 종합 이익 = 커머스 추정 마진 + 멤버십 구독료 − 추정 수수료."
      isLoading={isLoading}
      isEmpty={false}
    >
      <div className="space-y-4">
        {channelFiltered ? (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            채널 필터가 걸려 있습니다 — 커머스 순매출은 선택 채널 기준이지만 멤버십 구독료·수수료는 전
            채널 합계라서, 이 섹션의 종합 수치는 채널 필터와 정확히 대응하지 않습니다.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiTile label="총수입" value={formatKrw(totalRevenue)} hint="커머스 순매출 + 멤버십 구독료" />
          <KpiTile
            label="멤버십 구독료"
            value={formatKrw(membershipAmount)}
            hint={membership ? `PAID 인보이스 ${formatCount(membership.invoiceCount)}건` : undefined}
          />
          <KpiTile
            label="추정 결제수수료"
            value={formatKrw(estimatedFee)}
            hint={
              fee && fee.totals.uncoveredAmount > 0
                ? `요율 미설정 결제액 ${formatKrw(fee.totals.uncoveredAmount)} 제외`
                : '결제수단별 캡처 금액 × 설정 요율'
            }
          />
          <KpiTile
            label="추정 종합 이익"
            value={formatKrw(combinedProfit)}
            hint="원가 미입력·요율 미설정 몫은 빠진 근사치"
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">수입 구성</p>
          <HorizontalBarList
            items={[
              { label: '커머스 상품판매 (순매출)', value: commerceNetRevenue ?? 0 },
              { label: '멤버십 구독료', value: membershipAmount ?? 0 },
            ]}
            formatValue={formatKrw}
          />
        </div>
      </div>
    </ChartCard>
  );
}

/** 결제수단별 추정 수수료 표 + 수수료율 설정(이력) 관리 */
function FeeSection({
  fee,
  isLoading,
  isError,
}: {
  fee: FeeSummaryDto | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ChartCard
      title="결제 수수료"
      description="거래별 실 수수료 원천이 없어 결제수단별 설정 요율로 근사 계산합니다. 요율은 적용 시작일 이력으로 관리되며, 과거 기간을 조회하면 그 시점 요율이 적용됩니다."
      isLoading={isLoading}
      isEmpty={false}
    >
      {isError ? (
        <p className="py-6 text-center text-sm text-red-500">수수료 요약을 불러오지 못했습니다.</p>
      ) : (
        <div className="space-y-3">
          {fee && fee.totals.uncoveredAmount > 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              요율이 설정되지 않은 시점의 결제액 {formatKrw(fee.totals.uncoveredAmount)}은 수수료를 계산하지
              못했습니다. 아래 &lsquo;수수료율 설정&rsquo;에서 결제수단별 요율을 입력하세요.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-1.5 text-left">결제수단</th>
                  <th className="py-1.5 text-right">결제액 (캡처)</th>
                  <th className="py-1.5 text-right">건수</th>
                  <th className="py-1.5 text-right">적용 요율</th>
                  <th className="py-1.5 text-right">추정 수수료</th>
                  <th className="py-1.5 text-right">환불액</th>
                </tr>
              </thead>
              <tbody>
                {(fee?.methods ?? []).map((row) => (
                  <tr key={row.methodType} className="border-b last:border-0">
                    <td className="py-1.5 font-medium text-gray-900">{methodLabel(row.methodType)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatKrw(row.capturedAmount)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatCount(row.capturedCount)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.appliedFeeRateBp == null ? (
                        <span className="text-amber-600">미설정</span>
                      ) : (
                        formatBp(row.appliedFeeRateBp)
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.uncoveredAmount > 0 && row.coveredAmount === 0 ? (
                        <span className="text-gray-400">계산 불가</span>
                      ) : (
                        formatKrw(row.estimatedFee)
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatKrw(row.refundedAmount)}</td>
                  </tr>
                ))}
                {fee && fee.methods.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-400">
                      조회 기간에 결제가 없습니다
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              수수료율 설정 {settingsOpen ? '접기' : '열기'}
            </button>
          </div>
          {settingsOpen ? <FeeRateSettings /> : null}
        </div>
      )}
    </ChartCard>
  );
}

/** 수수료율 설정 — 변경은 새 적용일 행 추가(이력 보존), 잘못 넣은 행만 삭제 */
function FeeRateSettings() {
  const { data, isLoading, isError } = useFeeRates();
  const createFeeRate = useCreateFeeRate();
  const deleteFeeRate = useDeleteFeeRate();

  const [methodType, setMethodType] = useState<WalletPaymentMethodType>('CARD');
  const [ratePercent, setRatePercent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [memo, setMemo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    const percent = Number(ratePercent);
    if (!ratePercent || Number.isNaN(percent) || percent < 0 || percent > 100) {
      setFormError('요율은 0~100 사이 %로 입력하세요 (예: 2.9)');
      return;
    }
    if (!effectiveFrom) {
      setFormError('적용 시작일을 선택하세요');
      return;
    }
    setFormError(null);
    createFeeRate.mutate(
      {
        methodType,
        feeRateBp: Math.round(percent * 100),
        effectiveFrom,
        memo: memo.trim() || undefined,
      },
      {
        onSuccess: () => {
          setRatePercent('');
          setMemo('');
        },
        onError: () => setFormError('등록에 실패했습니다. 같은 결제수단·적용일의 요율이 이미 있는지 확인하세요.'),
      }
    );
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">결제수단</span>
          <select
            value={methodType}
            onChange={(event) => setMethodType(event.target.value as WalletPaymentMethodType)}
            className="rounded border border-gray-200 bg-white px-2 py-1.5"
          >
            {METHOD_TYPES.map((type) => (
              <option key={type} value={type}>
                {METHOD_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">요율 (%)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={ratePercent}
            onChange={(event) => setRatePercent(event.target.value)}
            placeholder="2.9"
            className="w-24 rounded border border-gray-200 bg-white px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">적용 시작일 (KST)</span>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            className="rounded border border-gray-200 bg-white px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">메모</span>
          <input
            type="text"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="예: 인하 협상 반영"
            maxLength={255}
            className="w-44 rounded border border-gray-200 bg-white px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={createFeeRate.isPending}
          className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          등록
        </button>
      </div>
      {formError ? <p className="text-xs text-red-500">{formError}</p> : null}
      <p className="text-xs text-gray-400">
        요율 변경은 기존 행 수정이 아니라 새 적용 시작일로 등록하세요 — 과거 기간 조회에 그 시점 요율이
        유지됩니다.
      </p>
      {isError ? (
        <p className="text-xs text-red-500">요율 목록을 불러오지 못했습니다.</p>
      ) : isLoading ? (
        <p className="text-xs text-gray-400">불러오는 중…</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-gray-500">
              <th className="py-1.5 text-left">결제수단</th>
              <th className="py-1.5 text-right">요율</th>
              <th className="py-1.5 text-left pl-4">적용 시작일 (KST)</th>
              <th className="py-1.5 text-left">메모</th>
              <th className="py-1.5 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((rate) => (
              <tr key={rate.id} className="border-b last:border-0">
                <td className="py-1.5">{methodLabel(rate.methodType)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatBp(rate.feeRateBp)}</td>
                <td className="py-1.5 pl-4 tabular-nums">
                  {new Date(rate.effectiveFrom).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                </td>
                <td className="py-1.5 text-gray-500">{rate.memo ?? ''}</td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => deleteFeeRate.mutate(rate.id)}
                    disabled={deleteFeeRate.isPending}
                    className="rounded border border-gray-200 px-2 py-0.5 text-gray-500 hover:bg-white disabled:opacity-40"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-gray-400">
                  등록된 요율이 없습니다 — 위에서 결제수단별 요율을 입력하세요
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}
