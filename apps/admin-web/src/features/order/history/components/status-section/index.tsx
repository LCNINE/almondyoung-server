'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useOrderStats } from '@/lib/services/orders';
import { STALL_BOARD_RESERVE_HREF } from '@/lib/api/domains/orders/order-progress.shape';

function StatCard({
  label,
  value,
  color,
  href,
}: {
  label: string;
  value: number | undefined;
  color?: 'blue' | 'red' | 'green' | 'default';
  href?: string;
}) {
  const textColor =
    color === 'blue'
      ? 'text-blue-600'
      : color === 'red'
        ? 'text-red-500'
        : color === 'green'
          ? 'text-green-600'
          : 'text-gray-800';

  const body = (
    <>
      <span className="mb-1 whitespace-nowrap text-xs text-gray-500">{label}</span>
      <span className={`text-2xl font-bold ${textColor}`}>
        {value != null ? value.toLocaleString() : '-'}
      </span>
    </>
  );
  const box =
    'flex min-w-[100px] flex-1 flex-col items-center justify-center rounded-xl border bg-white px-4 py-3 shadow-sm';
  return href ? (
    <Link href={href} className={`${box} hover:border-slate-400`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

export function OrderStatusSection() {
  const [collapsed, setCollapsed] = useState(false);
  const { data: stats, isLoading } = useOrderStats();

  return (
    <div>
      <div className="flex items-start gap-4 p-4">
        <div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-1 text-base font-bold text-gray-800 hover:opacity-80"
          >
            주문 현황 {collapsed ? '▼' : '▲'}
          </button>
          <p className="mt-0.5 text-xs text-gray-400">최근 14일</p>
          <p className="mt-0.5 text-xs text-gray-600">
            오늘 주문수 :{' '}
            <span className="font-medium">
              {isLoading ? '...' : (stats?.todayCount ?? 0).toLocaleString()}
            </span>
          </p>
        </div>
        {!collapsed && (
          <div className="flex flex-1 flex-wrap gap-2">
            <StatCard label="출고요청" value={stats?.outboundRequested} color="blue" />
            <StatCard label="직배송" value={stats?.directShip} />
            <StatCard label="출고불가" value={stats?.cannotShip} color="red" href={STALL_BOARD_RESERVE_HREF} />
            <StatCard label="부분출고" value={stats?.partialOutbound} color="red" />
            <StatCard label="매칭대기" value={stats?.waitingMatching} />
            <StatCard label="출고완료" value={stats?.outboundComplete} color="green" />
          </div>
        )}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            주문 현황 ▼
          </button>
        )}
      </div>
    </div>
  );
}
