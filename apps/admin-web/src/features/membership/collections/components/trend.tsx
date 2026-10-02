'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard } from '@/features/statistics/components/widgets';
import { SERIES_COLORS } from '@/features/statistics/shared';
import type { WeeklyPoint } from '@/lib/api/domains/membership/recovery';
import { won } from '../lib/recovery-view';

const label = (week: string) =>
  `${Number(week.slice(5, 7))}/${Number(week.slice(8, 10))}주`;

/** 그 시각이 속한 주(한국 시간 월요일 시작)의 x 축 라벨 */
function weekLabelOf(iso: string): string {
  const kst = new Date(Date.parse(iso) + 9 * 3600_000);
  const monday = new Date(
    kst.getTime() - ((kst.getUTCDay() + 6) % 7) * 86_400_000
  );
  return label(monday.toISOString().slice(0, 10));
}

/** 최근 12주 — 미납이 생긴 돈과 받은 돈(막대), 출금 실패와 재시도 회수 건수(선). 정책 시행 주에 세로선 */
export function RecoveryTrend({
  points,
  policyAt,
}: {
  points: WeeklyPoint[];
  policyAt: string | null;
}) {
  const rows = points.map((p) => ({ ...p, label: label(p.week) }));
  const policyWeek = policyAt ? weekLabelOf(policyAt) : null;
  const showPolicy =
    policyWeek != null && rows.some((r) => r.label === policyWeek);
  const empty = rows.every(
    (r) =>
      r.failedCases +
        r.recoveredCases +
        r.debtCreated +
        r.debtSettled +
        r.debtWaived ===
      0
  );
  return (
    <ChartCard
      title="최근 12주 흐름"
      description="한국 시간 월요일 시작 주 · 막대 = 미납 금액(생김/받음/면제), 선 = 출금 실패·재시도 회수 건수"
      isEmpty={empty}
      emptyText="최근 12주에 출금 실패나 미납이 없습니다"
    >
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#999" />
          <YAxis
            yAxisId="won"
            tick={{ fontSize: 11 }}
            stroke="#999"
            tickFormatter={(v: number) =>
              `${Math.round(v / 1000).toLocaleString('ko-KR')}천`
            }
          />
          <YAxis
            yAxisId="cases"
            orientation="right"
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            stroke="#999"
          />
          <Tooltip
            formatter={(value: number, name: string) =>
              name.endsWith('건') ? `${value}건` : won(value)
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {showPolicy && (
            <ReferenceLine
              yAxisId="won"
              x={policyWeek}
              stroke="#64748b"
              strokeDasharray="4 3"
              label={{
                value: '미납 정책 시행',
                position: 'insideTopLeft',
                fontSize: 11,
                fill: '#475569',
              }}
            />
          )}
          <Bar
            yAxisId="won"
            dataKey="debtCreated"
            name="미납 생김"
            fill={SERIES_COLORS[1]}
            maxBarSize={22}
            radius={[3, 3, 0, 0]}
          />
          <Bar
            yAxisId="won"
            dataKey="debtSettled"
            name="미납 받음"
            fill={SERIES_COLORS[2]}
            maxBarSize={22}
            radius={[3, 3, 0, 0]}
          />
          <Bar
            yAxisId="won"
            dataKey="debtWaived"
            name="미납 면제"
            fill="#cbd5e1"
            maxBarSize={22}
            radius={[3, 3, 0, 0]}
          />
          <Line
            yAxisId="cases"
            type="monotone"
            dataKey="failedCases"
            name="출금 실패 건"
            stroke={SERIES_COLORS[3]}
            strokeWidth={2}
            dot={{ r: 2 }}
          />
          <Line
            yAxisId="cases"
            type="monotone"
            dataKey="recoveredCases"
            name="재시도 회수 건"
            stroke={SERIES_COLORS[0]}
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
