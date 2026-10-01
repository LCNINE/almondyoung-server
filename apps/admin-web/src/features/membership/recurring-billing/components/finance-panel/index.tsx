'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, KpiTile } from '@/features/statistics/components/widgets';
import { SERIES_COLORS } from '@/features/statistics/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMembershipInsights, useRecurringBillingFinance, useUpcomingBilling } from '@/lib/services/membership';
import {
  currentKstMonth,
  financeChartRows,
  financeTiles,
  formatRate,
  formatWon,
  monthOptions,
} from '../../lib/finance-view';

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 정기결제 «돈» — 경영자가 보는 영역. 고른 달의 청구가 얼마나 걷혔는지, 못 걷은 돈과 미납 잔액,
 * 앞으로 7일의 청구 예정을 원 단위로 보여준다. 조회가 실패해도 아래 작업함·목록은 그대로 쓴다.
 */
export function RecurringBillingFinancePanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const thisMonth = currentKstMonth();
  const requested = searchParams.get('month');
  const month = requested && MONTH_KEY.test(requested) ? requested : thisMonth;

  const finance = useRecurringBillingFinance(month);
  const insights = useMembershipInsights();
  const upcoming = useUpcomingBilling(7);

  const selected = finance.data?.months.at(-1);
  const chartRows = financeChartRows(finance.data?.months ?? []);

  const changeMonth = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === thisMonth) params.delete('month');
    else params.set('month', value);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <section aria-label="정기결제 돈" className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">
          돈 <span className="text-sm font-normal text-gray-500">— 고른 달에 청구한 멤버십 요금</span>
        </h2>
        <Select value={month} onValueChange={changeMonth}>
          <SelectTrigger className="h-9 w-[150px] bg-white" aria-label="청구 달">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions(thisMonth).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {finance.isError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          청구·수금 요약을 불러오지 못했습니다.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {(selected ? financeTiles(selected) : placeholderTiles).map((tile) => (
            <KpiTile
              key={tile.key}
              label={tile.label}
              value={tile.value}
              hint={tile.hint}
              isLoading={finance.isLoading}
            />
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile
          label="미납 잔액 (지금)"
          value={insights.data ? formatWon(insights.data.arrears.outstandingAmount) : insights.isError ? '-' : ''}
          hint={
            insights.data
              ? `${insights.data.arrears.outstandingPeople.toLocaleString('ko-KR')}명 · 납부 전까지 재가입이 막힌 금액`
              : insights.isError
                ? '불러오지 못했습니다'
                : undefined
          }
          isLoading={insights.isLoading}
        />
        <KpiTile
          label="재시도 회수율"
          value={selected ? formatRate(selected.retryRecovery.rate) : ''}
          hint={
            selected
              ? selected.retryRecovery.rate == null
                ? '이 달에 출금이 실패한 청구가 없습니다'
                : `한 번 이상 실패한 청구 중 결국 걷은 비율 · 회수 ${selected.retryRecovery.recovered}건 / 최종 실패 ${selected.retryRecovery.lost}건`
              : undefined
          }
          isLoading={finance.isLoading}
        />
        <KpiTile
          label="다음 7일 청구 예정"
          value={upcoming.data ? formatWon(upcoming.data.amount) : upcoming.isError ? '-' : ''}
          hint={
            upcoming.data
              ? `${upcoming.data.contracts.toLocaleString('ko-KR')}건 · 오늘부터 7일 · 플랜 정가 기준 추정`
              : upcoming.isError
                ? '불러오지 못했습니다'
                : undefined
          }
          isLoading={upcoming.isLoading}
        />
      </div>

      <ChartCard
        title="최근 6개월 청구 결과"
        description="첫 출금 예정일이 속한 달 기준 · 못 걷은 돈 = 출금 최종 실패 + 계좌 심사 거절"
        isLoading={finance.isLoading}
        isEmpty={chartRows.every((row) => row.paid + row.inProgress + row.lost === 0)}
        emptyText="최근 6개월에 청구가 없습니다"
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartRows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#999" />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="#999"
              tickFormatter={(value: number) => `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`}
            />
            <Tooltip formatter={(value: number) => formatWon(value)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="paid" name="수금" stackId="m" fill={SERIES_COLORS[0]} maxBarSize={36} />
            <Bar dataKey="inProgress" name="진행 중" stackId="m" fill={SERIES_COLORS[3]} maxBarSize={36} />
            <Bar dataKey="lost" name="못 걷은 돈" stackId="m" fill={SERIES_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}

const placeholderTiles = [
  { key: 'billed', label: '청구액', value: '', hint: '' },
  { key: 'paid', label: '수금액', value: '', hint: '' },
  { key: 'collectionRate', label: '수금률', value: '', hint: '' },
  { key: 'inProgress', label: '아직 진행 중', value: '', hint: '' },
  { key: 'lost', label: '못 걷은 돈', value: '', hint: '' },
];
