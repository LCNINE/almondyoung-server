'use client';

import { useState } from 'react';
import { useOrderStats } from '@/lib/services/orders';

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | undefined;
  color?: 'blue' | 'red' | 'green' | 'default';
}) {
  const textColor =
    color === 'blue'
      ? 'text-blue-600'
      : color === 'red'
        ? 'text-red-500'
        : color === 'green'
          ? 'text-green-600'
          : 'text-gray-800';

  return (
    <div className="flex min-w-[100px] flex-1 flex-col items-center justify-center rounded-xl border bg-white px-4 py-3 shadow-sm">
      <span className="mb-1 whitespace-nowrap text-xs text-gray-500">{label}</span>
      <span className={`text-2xl font-bold ${textColor}`}>
        {value != null ? value.toLocaleString() : '-'}
      </span>
    </div>
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
            <StatCard label="출고불가" value={stats?.cannotShip} color="red" />
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
