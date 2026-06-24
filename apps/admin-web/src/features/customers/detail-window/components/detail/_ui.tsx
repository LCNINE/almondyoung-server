'use client';

import type { ReactNode } from 'react';

/** 상세정보 탭의 섹션 카드 컨테이너 */
export function SectionCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          {icon}
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 읽기 전용 라벨-값 한 줄 */
export function Field({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-28 shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-gray-900">
        {value === null || value === undefined || value === '' ? '-' : value}
      </span>
    </div>
  );
}
