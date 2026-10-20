'use client';

import Link from 'next/link';
import type { ScheduleDay } from '@packages/domain-types/attendance-wage';
import { Skeleton } from '@/components/ui/skeleton';
import { usePayGroups, useWageWorkers } from '../hooks/use-attendance-wage';
import { formatWon } from './lib/wage-format';
import { panelClass, WageHeading } from './wage-ui';

const WEEKDAY_LABELS = ['', '월', '화', '수', '목', '금', '토', '일'];

export function scheduleSummary(days: readonly ScheduleDay[]): string {
  if (days.length === 0) {
    return '근무일 없음';
  }

  return [...days]
    .sort((a, b) => a.weekday - b.weekday)
    .map((day) => `${WEEKDAY_LABELS[day.weekday]} ${day.start}~${day.end}`)
    .join(', ');
}

export function WageWorkers() {
  const workers = useWageWorkers();
  const groups = usePayGroups();
  const groupName = new Map(
    (groups.data ?? []).map((group) => [group.id, group.name])
  );
  const missing = (workers.data ?? []).filter(
    (worker) => worker.isStaff && !worker.onRoster
  ).length;

  return (
    <section className="min-w-0 space-y-6">
      <WageHeading
        title="근무자·시급"
        description="급여를 계산할 사람의 명단이에요. 사람을 눌러 그룹·시급·근무 시간표를 정해 주세요."
      />
      {missing > 0 && (
        <p
          role="status"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          명단에 없는 근태 직원이 {missing}명 있어요. 이 사람들은 정산에서 «명단
          없음»으로 남아요.
        </p>
      )}
      {workers.isError ? (
        <p role="alert" className={`${panelClass} text-sm text-red-600`}>
          근무자를 불러오지 못했어요.{' '}
          <button className="underline" onClick={() => workers.refetch()}>
            다시 시도
          </button>
        </p>
      ) : workers.isPending ? (
        <Skeleton
          className="h-64 w-full rounded-2xl"
          aria-label="근무자를 불러오고 있어요."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">명단</th>
                <th className="px-4 py-3">급여 그룹</th>
                <th className="px-4 py-3">현재 시급</th>
                <th className="px-4 py-3">현재 시간표</th>
              </tr>
            </thead>
            <tbody>
              {(workers.data ?? []).map((worker) => (
                <tr key={worker.userId} className="border-t">
                  <td className="px-4 py-3">
                    <Link
                      className="font-medium text-indigo-600 underline-offset-2 hover:underline"
                      href={`/company/attendance/wage/workers/${worker.userId}`}
                    >
                      {worker.name || '이름 없음'}
                    </Link>
                    {worker.label && (
                      <span className="ml-2 text-xs text-slate-500">
                        {worker.label}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {worker.onRoster ? (
                      worker.isStaff ? (
                        '명단'
                      ) : (
                        '명단 · 근태 권한 없음'
                      )
                    ) : (
                      <span className="text-amber-700">명단 없음</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {worker.groupId
                      ? (groupName.get(worker.groupId) ?? '')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {worker.currentRate === null
                      ? '—'
                      : formatWon(worker.currentRate)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {worker.currentSchedule
                      ? scheduleSummary(worker.currentSchedule.days)
                      : '없음(유연 근무)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
