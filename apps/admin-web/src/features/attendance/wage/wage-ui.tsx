'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { payPeriodFor } from '@packages/domain-types/attendance-wage';
import { useCan } from '@/hooks/use-permission';
import { usePayGroups } from '../hooks/use-attendance-wage';

export const fieldClass =
  'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export const panelClass = 'rounded-2xl border bg-white p-5 sm:p-6';

export function WageTabs() {
  const pathname = usePathname();
  const read = useCan(['attendance.wage.read']);
  const review = useCan(['attendance.request.review']);
  const ready = (state: ReturnType<typeof useCan>) =>
    state.status === 'ready' && state.allowed;
  const links = [
    ...(ready(read) ? [['정산', '/company/attendance/wage']] : []),
    ...(ready(review)
      ? [['연장·부재 판정', '/company/attendance/wage/decisions']]
      : []),
    ...(ready(read)
      ? [['근무자·시급', '/company/attendance/wage/workers']]
      : []),
    ...(ready(read)
      ? [['급여 설정', '/company/attendance/wage/settings']]
      : []),
  ];

  return (
    <nav aria-label="급여 메뉴" className="mb-6 flex gap-2 overflow-x-auto">
      {links.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className={`shrink-0 rounded-full px-4 py-2 text-sm ${pathname === href ? 'bg-slate-900 font-semibold text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function WageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-10 font-bold tracking-tight text-slate-950">
          {title}
        </h1>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** 고른 급여 그룹과 지급 달. 그룹을 아직 안 골랐으면 첫 활성 그룹이다. */
export function useWagePeriod(
  initialMonth: string,
  source: 'wage' | 'decisions' = 'wage'
) {
  const groups = usePayGroups(source);
  const [chosen, setGroupId] = useState<string | null>(null);
  const [month, setMonth] = useState(initialMonth);
  const groupId =
    chosen ?? (groups.data ?? []).find((group) => group.active)?.id ?? null;

  return { groupId, setGroupId, month, setMonth, groups: groups.data ?? [] };
}

export function WagePeriodBar({
  groupId,
  onGroup,
  month,
  onMonth,
  source = 'wage',
}: {
  groupId: string | null;
  onGroup: (id: string) => void;
  month: string;
  onMonth: (month: string) => void;
  source?: 'wage' | 'decisions';
}) {
  const groups = usePayGroups(source);
  const active = (groups.data ?? []).filter((group) => group.active);
  const selected = active.find((group) => group.id === groupId);

  if (groups.isError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        급여 그룹을 불러오지 못했어요.{' '}
        <button className="underline" onClick={() => groups.refetch()}>
          다시 시도
        </button>
      </p>
    );
  }

  if (groups.isSuccess && active.length === 0) {
    return (
      <p className={`${panelClass} text-sm text-slate-600`}>
        급여 그룹이 없어요.{' '}
        <Link
          className="font-semibold text-indigo-600 underline"
          href="/company/attendance/wage/settings"
        >
          급여 설정
        </Link>
        에서 먼저 만들어 주세요.
      </p>
    );
  }

  const period = selected ? payPeriodFor(selected, month) : null;

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="block min-w-0 space-y-1 text-sm text-slate-600 sm:w-56">
        급여 그룹
        <select
          className={fieldClass}
          value={groupId ?? ''}
          disabled={groups.isPending}
          onChange={(event) => onGroup(event.target.value)}
        >
          {active.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-0 space-y-1 text-sm text-slate-600 sm:w-48">
        지급 달
        <input
          type="month"
          className={fieldClass}
          value={month}
          onChange={(event) => {
            if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) {
              onMonth(event.target.value);
            }
          }}
        />
      </label>
      {period && (
        <p className="pb-3 text-sm text-slate-500">
          정산 기간 {period.periodStart} ~ {period.periodEnd} · 지급일{' '}
          {period.payday}
        </p>
      )}
    </div>
  );
}
