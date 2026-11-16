'use client';

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
import { formatKrw, formatKrwAxis, SERIES_COLORS } from '../shared';
import { annualCompanyRevenue, companyMonthlyRows } from './company-revenue';

const channels = [
  ['medusa', '현재 자사몰(메두사)'],
  ['cafe24', '이전 자사몰(카페24)'],
  ['naver', '스마트스토어'],
  ['coupang', '쿠팡'],
  ['phone', '전화 주문'],
  ['other', '기타 채널'],
] as const;

type Revenue = ReturnType<typeof annualCompanyRevenue>;

export function CompanyMonthlyRevenue({
  revenue,
  coverageStart,
}: {
  revenue: Revenue;
  coverageStart: string | null;
}) {
  if (revenue.totals === null) return null;

  const rows = companyMonthlyRows(revenue, coverageStart);
  const visible = channels.filter(
    ([key]) =>
      !['phone', 'other'].includes(key) || rows.some((row) => row[key] !== null)
  );

  return (
    <section
      aria-label="회사 전체 월별 채널 매출"
      className="space-y-3 border-t pt-4"
    >
      <h3 className="font-semibold">월별 채널 매출</h3>
      <p className="text-xs leading-relaxed text-gray-600">
        메두사 자동 집계와 합산 가능한 업로드 자료를 함께 표시합니다. 현재·이전
        자사몰은 구분해 보여주며, 두 금액을 합친 값이 상단 ‘자사몰’입니다. 월별
        전체 합계는 상단 회사 전체 실적과 같습니다. 미등록 자료는 0원으로
        간주하지 않으며 진행 중인 달과 전체 합계는 잠정입니다.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart
          data={rows}
          margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="month"
            tickFormatter={(value: string) => `${Number(value.slice(5))}월`}
            tick={{ fontSize: 11 }}
          />
          <YAxis tickFormatter={formatKrwAxis} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value: number) => formatKrw(value)} />
          <Legend />
          {visible.map(([key, label], index) => (
            <Line
              key={key}
              dataKey={key}
              name={label}
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">
            월별 채널 매출과 회사 전체 합계, 원 단위
          </caption>
          <thead>
            <tr className="border-b text-right">
              <th scope="col" className="p-2 text-left">
                월
              </th>
              {visible.map(([key, label]) => (
                <th scope="col" key={key} className="min-w-32 p-2">
                  {label}
                </th>
              ))}
              <th scope="col" className="min-w-32 p-2">
                전체 합계
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month} className="border-b text-right">
                <th
                  scope="row"
                  className="whitespace-nowrap p-2 text-left font-normal"
                >
                  {row.month}
                  {row.month === revenue.currentMonth ? ' · 진행 중' : ''}
                </th>
                {visible.map(([key]) => (
                  <td key={key} className="p-2 tabular-nums">
                    {row[key] === null
                      ? key === 'medusa' &&
                        coverageStart &&
                        row.month < coverageStart.slice(0, 7)
                        ? '집계 전'
                        : '미등록'
                      : formatKrw(row[key])}
                  </td>
                ))}
                <td className="p-2 font-semibold tabular-nums">
                  {row.all === null ? '—' : formatKrw(row.all)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-right font-semibold">
              <th scope="row" className="p-2 text-left">
                반영 합계
              </th>
              {visible.map(([key]) => (
                <td key={key} className="p-2 tabular-nums">
                  {formatKrw(
                    rows.reduce((sum, row) => sum + (row[key] ?? 0), 0)
                  )}
                </td>
              ))}
              <td className="p-2 tabular-nums">
                {formatKrw(revenue.totals.all)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
