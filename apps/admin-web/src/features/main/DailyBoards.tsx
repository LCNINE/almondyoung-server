'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { kstDaysAgo, kstToday } from '@/features/statistics/as-of';
import { useDailyOrderStatus } from '@/lib/services/orders';
import { useDailySignups } from '@/lib/services/users';
import { useDailyPoints } from '@/lib/services/wallet';
import { cn } from '@/lib/utils/ui';

const DAYS = 7;
const SIGNUP_COLOR = '#EC825F';

function useRange() {
  return { from: kstDaysAgo(DAYS - 1), to: kstToday() };
}

function dayLabel(bucket: string) {
  const [, month, day] = bucket.split('-');
  return `${month}월 ${day}일`;
}

function SortableDateHeader({ desc, onToggle }: { desc: boolean; onToggle: () => void }) {
  const Icon = desc ? ArrowDown : ArrowUp;
  return (
    <th className="p-2.5 text-left font-medium">
      <button type="button" onClick={onToggle} className="inline-flex cursor-pointer items-center gap-1 text-[#616161]">
        날짜 <Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}

function DayCell({ bucket, today, label }: { bucket: string; today: string; label?: string }) {
  const isToday = bucket === today;
  return (
    <td
      className={cn(
        'whitespace-nowrap px-3 py-3 font-medium text-[#616161]',
        isToday && 'border-l-[3px] border-l-[#1882C8] font-bold text-[#1C1C1C]',
      )}
    >
      {label ?? dayLabel(bucket)}
      {isToday ? (
        <span className="ml-1.5 rounded bg-[#1882C8] px-1 py-0.5 text-xs font-medium text-white">오늘</span>
      ) : null}
    </td>
  );
}

function Amount({ value, unit, bold }: { value: number | null; unit: string; bold?: boolean }) {
  if (value == null) return <span className="text-sm text-[#BDBDBD]">-</span>;
  return (
    <span className="whitespace-nowrap text-sm tabular-nums">
      <span className={cn('text-[#2B2B2B]', bold && 'font-bold')}>{value.toLocaleString('ko-KR')}</span>
      <span className="ml-0.5 text-[#757575]">{unit}</span>
    </span>
  );
}

export function MembersBoard() {
  const range = useRange();
  const today = kstToday();
  const signups = useDailySignups(range.from, range.to);
  const points = useDailyPoints(range.from, range.to);
  const [desc, setDesc] = useState(true);

  if (signups.isError && points.isError) {
    return <p className="py-6 text-center text-xs text-red-500">회원/적립금 현황을 불러오지 못했습니다.</p>;
  }

  const signupsData = signups.isError ? undefined : signups.data;
  const pointsData = points.isError ? undefined : points.data;
  const signupsByDay = signupsData ? new Map(signupsData.series.map((point) => [point.bucket, point.count])) : null;
  const earnedByDay = pointsData ? new Map(pointsData.series.map((point) => [point.bucket, point.earnedAmount])) : null;
  const buckets = (signupsData?.series ?? pointsData?.series ?? []).map((point) => point.bucket);
  const rows = buckets.map((bucket) => ({
    bucket,
    signups: signupsByDay ? (signupsByDay.get(bucket) ?? 0) : null,
    earned: earnedByDay ? (earnedByDay.get(bucket) ?? 0) : null,
  }));
  const totalSignups = signupsData ? signupsData.series.reduce((sum, point) => sum + point.count, 0) : null;
  const totalEarned = pointsData ? pointsData.series.reduce((sum, point) => sum + point.earnedAmount, 0) : null;
  const tableRows = desc ? [...rows].reverse() : rows;
  const isLoading = signups.isLoading || points.isLoading;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div>
        <p className="mb-1 text-xs text-[#757575]">단위/명</p>
        <div className="h-[316px]">
          {signups.isError ? (
            <p className="py-24 text-center text-xs text-red-500">신규 회원 가입 현황을 불러오지 못했습니다.</p>
          ) : isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={288}>
                <LineChart
                  data={rows.map((row) => ({ label: row.bucket.slice(5), signups: row.signups ?? 0 }))}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke="#EBEBEB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#757575' }} stroke="#707070" />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#757575' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ stroke: '#707070', strokeDasharray: '3 3' }}
                    formatter={(value: number) => [`${value.toLocaleString('ko-KR')}명`, '신규 회원 가입']}
                  />
                  <Line
                    type="linear"
                    dataKey="signups"
                    stroke={SIGNUP_COLOR}
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#fff', stroke: SIGNUP_COLOR, strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: '#fff', stroke: SIGNUP_COLOR, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-2 flex justify-center text-sm text-[#2B2B2B]">
                <span className="inline-flex items-center gap-1.5">
                  <LineIcon color={SIGNUP_COLOR} />
                  신규 회원 가입 현황
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <SummaryCard label="총 신규 회원 가입 현황" value={totalSignups} unit="명" isLoading={signups.isLoading} />
          <SummaryCard label="총 적립금 적용 현황" value={totalEarned} unit="원" isLoading={points.isLoading} />
        </div>
        {signups.isError || points.isError ? (
          <p className="text-xs text-[#D71952]">
            {signups.isError ? '신규 회원 가입' : '적립금'} 데이터를 불러오지 못했습니다.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#CCCCCC] bg-[#FAFAFA] text-[#616161]">
                <SortableDateHeader desc={desc} onToggle={() => setDesc((value) => !value)} />
                <th className="p-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <LineIcon color={SIGNUP_COLOR} />
                    신규 회원 가입 현황
                  </span>
                </th>
                <th className="p-2.5 text-right font-medium">적립금 적용 현황</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? <SkeletonRows rows={DAYS} cols={2} /> : null}
              {(isLoading ? [] : tableRows).map((row) => (
                <tr
                  key={row.bucket}
                  className={cn('border-b border-[#EBEBEB]', row.bucket === today && 'bg-[#FAFDFE]')}
                >
                  <DayCell bucket={row.bucket} today={today} />
                  <td className="px-3 py-3 text-right">
                    <Amount value={row.signups} unit="명" bold={(row.signups ?? 0) > 0 || row.bucket === today} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Amount value={row.earned} unit="원" bold={(row.earned ?? 0) > 0 || row.bucket === today} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  unit,
  isLoading,
}: {
  label: string;
  value: number | null;
  unit: string;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-xl bg-[#F5F8FF] p-3">
      <p className="text-[13px] text-[#616161]">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-1 h-7 w-20" />
      ) : value == null ? (
        <p className="mt-1 text-sm leading-7 text-gray-400">불러오지 못함</p>
      ) : (
        <p className="mt-1 leading-7">
          <span className="text-xl font-bold tabular-nums text-[#2B2B2B]">{value.toLocaleString('ko-KR')}</span>
          <span className="ml-0.5 text-base text-[#757575]">{unit}</span>
        </p>
      )}
    </div>
  );
}

function LineIcon({ color }: { color: string }) {
  return (
    <svg aria-hidden width="18" height="10" viewBox="0 0 18 10">
      <line x1="0" y1="5" x2="18" y2="5" stroke={color} strokeWidth="2" />
      <circle cx="9" cy="5" r="3" fill="#fff" stroke={color} strokeWidth="2" />
    </svg>
  );
}

const ORDER_COLUMNS = [
  { key: 'pending', label: '입금전' },
  { key: 'preparing', label: '상품준비중' },
  { key: 'shipping', label: '배송중' },
  { key: 'delivered', label: '배송완료' },
  { key: 'cancelled', label: '취소' },
  { key: 'exchange', label: '교환' },
  { key: 'return', label: '반품' },
  { key: 'total', label: '주문합계' },
] as const;

type OrderColumnKey = (typeof ORDER_COLUMNS)[number]['key'];

export function OrderStatusBoard() {
  const range = useRange();
  const today = kstToday();
  const { data, isLoading, isError } = useDailyOrderStatus(range.from, range.to);
  const [desc, setDesc] = useState(true);

  if (isError) return <p className="py-6 text-center text-xs text-red-500">주문처리 현황을 불러오지 못했습니다.</p>;
  const series = data?.series ?? [];
  const sum = (key: OrderColumnKey) => series.reduce((total, point) => total + point[key], 0);
  const rows = desc ? [...series].reverse() : series;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[#CCCCCC] bg-[#FAFAFA] text-[#616161]">
            <SortableDateHeader desc={desc} onToggle={() => setDesc((value) => !value)} />
            {ORDER_COLUMNS.map((column) => (
              <th key={column.key} className="whitespace-nowrap p-2.5 text-right font-medium">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? <SkeletonRows rows={DAYS + 1} cols={ORDER_COLUMNS.length} /> : null}
          {isLoading ? null : (
            <tr className="border-b border-[#EBEBEB] bg-[#F1F9FD]">
              <td className="border-l-[3px] border-l-[#1882C8] px-3 py-3 font-bold text-[#1C1C1C]">합계</td>
              {ORDER_COLUMNS.map((column) => (
                <td key={column.key} className="px-3 py-3 text-right text-sm font-bold tabular-nums text-[#2B2B2B]">
                  {sum(column.key).toLocaleString('ko-KR')}
                </td>
              ))}
            </tr>
          )}
          {rows.map((point) => (
            <tr
              key={point.bucket}
              className={cn('border-b border-[#EBEBEB]', point.bucket === today && 'bg-[#FAFDFE]')}
            >
              <DayCell bucket={point.bucket} today={today} />
              {ORDER_COLUMNS.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-3 py-3 text-right text-sm tabular-nums text-[#2B2B2B]',
                    (point[column.key] > 0 || point.bucket === today) && 'font-bold',
                  )}
                >
                  {point[column.key].toLocaleString('ko-KR')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <tr key={row} className="border-b border-[#EBEBEB]">
      <td className="px-3 py-3">
        <Skeleton className="h-5 w-20" />
      </td>
      {Array.from({ length: cols }, (_, col) => (
        <td key={col} className="px-3 py-3">
          <Skeleton className="ml-auto h-5 w-10" />
        </td>
      ))}
    </tr>
  ));
}
