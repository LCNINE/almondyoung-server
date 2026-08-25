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
import { useKeywordStatistics } from '@/lib/services/search';
import { StatisticsShell } from '../components/shell';
import { ChartCard, HorizontalBarList, KpiTile } from '../components/widgets';
import { changeRate, formatCount, formatPercent, SERIES_COLORS, useStatisticsRange } from '../shared';

export default function KeywordStatisticsTemplate() {
  const range = useStatisticsRange();
  const { data, isLoading, isError } = useKeywordStatistics({ from: range.from, to: range.to, limit: 20 });

  const zeroRate = data && data.totalSearches > 0 ? data.zeroResultSearches / data.totalSearches : null;

  return (
    <StatisticsShell filterOptions={{ channel: false, granularity: false }}>
      {isError ? (
        <p className="py-10 text-center text-sm text-red-500">
          통계를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiTile label="총 검색 수" value={formatCount(data?.totalSearches)} isLoading={isLoading} />
            <KpiTile
              label="결과 0건 검색 수"
              value={formatCount(data?.zeroResultSearches)}
              hint="수요는 있는데 결과가 없던 검색"
              isLoading={isLoading}
            />
            <KpiTile
              label="결과 0건 비율"
              value={formatPercent(zeroRate)}
              hint="결과 0건 ÷ 총 검색"
              isLoading={isLoading}
            />
          </div>

          <ChartCard
            title="검색량 추이"
            description="상품 검색 1페이지 요청 기준 · 자동완성과 2페이지 이후는 집계되지 않습니다."
            isLoading={isLoading}
            isEmpty={!data || data.series.length === 0}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data?.series ?? []} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#999" />
                <YAxis tick={{ fontSize: 11 }} stroke="#999" allowDecimals={false} />
                <Tooltip formatter={(value: number) => formatCount(value)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="검색 수"
                  stroke={SERIES_COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="zeroCount"
                  name="결과 0건"
                  stroke={SERIES_COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="인기 검색어"
            description="증감은 직전 동일 길이 기간의 검색 수 대비입니다."
            isLoading={isLoading}
            isEmpty={!data || data.top.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1.5 text-left">#</th>
                    <th className="py-1.5 text-left">검색어</th>
                    <th className="py-1.5 text-right">검색 수</th>
                    <th className="py-1.5 text-right">결과 0건</th>
                    <th className="py-1.5 text-right">전기간 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.top ?? []).map((row, index) => {
                    const rate = changeRate(row.count, row.previousCount);
                    return (
                      <tr key={row.keywordNorm} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-400">{index + 1}</td>
                        <td className="py-1.5">
                          <span className="font-medium text-gray-900">{row.keyword}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {row.zeroCount > 0 ? (
                            <span className="text-red-600">{formatCount(row.zeroCount)}</span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {rate == null ? (
                            <span className="text-gray-400">신규</span>
                          ) : (
                            <span className={rate >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                              {rate >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(rate))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="결과 0건 검색어"
              description="찾는 사람은 있는데 결과가 없던 키워드 — 상품 등록·검색 동의어 보강 후보입니다."
              isLoading={isLoading}
              isEmpty={!data || data.zeroTop.length === 0}
            >
              <HorizontalBarList
                items={(data?.zeroTop ?? []).map((row) => ({ label: row.keyword, value: row.count }))}
                formatValue={formatCount}
              />
            </ChartCard>

            <ChartCard
              title="급상승 검색어"
              description="직전 동일 길이 기간 대비 검색 수가 늘어난 키워드 · 3회 이상 검색된 것만"
              isLoading={isLoading}
              isEmpty={!data || data.rising.length === 0}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="py-1.5 text-left">검색어</th>
                      <th className="py-1.5 text-right">검색 수</th>
                      <th className="py-1.5 text-right">직전 기간</th>
                      <th className="py-1.5 text-right">증가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.rising ?? []).map((row) => (
                      <tr key={row.keywordNorm} className="border-b last:border-0">
                        <td className="py-1.5">
                          <span className="font-medium text-gray-900">{row.keyword}</span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatCount(row.previousCount)}</td>
                        <td className="py-1.5 text-right tabular-nums text-emerald-600">
                          {row.previousCount === 0 ? '신규' : `×${(row.count / row.previousCount).toFixed(1)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>
        </div>
      )}
    </StatisticsShell>
  );
}
