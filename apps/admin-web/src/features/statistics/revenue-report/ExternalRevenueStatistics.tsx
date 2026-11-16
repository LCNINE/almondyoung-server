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
import { externalMonthlyStatistics, type ExternalRevenueRow } from './model';

export function ExternalRevenueStatistics({
  rows,
  year,
}: {
  rows: ExternalRevenueRow[];
  year: number;
}) {
  const { series, months } = externalMonthlyStatistics(rows, year);
  if (!series.length) return null;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <h3 className="font-medium">외부 채널 월별 매출</h3>
      <p className="text-sm text-gray-600">
        저장한 자료가 바로 반영됩니다. 계정·매출 기준별로 구분하며, 미등록월은
        0원으로 표시하지 않습니다. 진행 중인 달은 잠정 금액입니다. 자사몰 목표
        실적에는 합산하지 않습니다.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={months}
          margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="month"
            tickFormatter={(month: string) => `${Number(month.slice(5))}월`}
            tick={{ fontSize: 11 }}
          />
          <YAxis tickFormatter={formatKrwAxis} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value: number) => formatKrw(value)} />
          <Legend />
          {series.map((item, index) => (
            <Line
              key={item.key}
              dataKey={item.key}
              name={item.label}
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {year}년 외부 채널 월별 매출, 원 단위
          </caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="p-2">
                월
              </th>
              {series.map((item) => (
                <th
                  scope="col"
                  key={item.key}
                  className="min-w-44 p-2 text-right"
                >
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month} className="border-b last:border-0">
                <th
                  scope="row"
                  className="whitespace-nowrap p-2 text-left font-normal"
                >
                  {String(month.month)}
                </th>
                {series.map((item) => (
                  <td key={item.key} className="p-2 text-right tabular-nums">
                    {month[item.key] === null
                      ? '미등록'
                      : `${Number(month[item.key]).toLocaleString()}원`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
