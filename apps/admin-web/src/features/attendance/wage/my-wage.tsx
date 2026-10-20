'use client';

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyWage } from '../hooks/use-attendance-wage';
import {
  currentMonth,
  formatMinutes,
  formatWon,
  ISSUE_LABELS,
} from './lib/wage-format';
import { fieldClass, panelClass } from './wage-ui';

export function MyWage() {
  const [month, setMonth] = useState(() => currentMonth(new Date()));
  const query = useMyWage(month);
  const person = query.data?.person ?? null;
  const issues = query.data?.issues ?? [];
  const issueDates = new Set(issues.map((issue) => issue.workDate));
  const worked =
    person?.days.reduce((sum, day) => sum + day.workedMinutes, 0) ?? 0;

  return (
    <section className="min-w-0 space-y-5">
      <label className="block max-w-xs text-sm text-slate-600">
        지급 달
        <input
          type="month"
          className={fieldClass}
          value={month}
          onChange={(event) => {
            if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) {
              setMonth(event.target.value);
            }
          }}
        />
      </label>
      {query.isError ? (
        <p role="alert" className={`${panelClass} text-sm text-slate-600`}>
          급여 정보를 불러오지 못했어요. 급여 명단에 없으면 관리자에게 문의해
          주세요.{' '}
          <button className="underline" onClick={() => query.refetch()}>
            다시 시도
          </button>
        </p>
      ) : !query.data ? (
        <Skeleton
          className="h-48 w-full rounded-2xl"
          aria-label="급여를 불러오고 있어요."
        />
      ) : (
        <>
          <div className={panelClass}>
            <p className="text-sm text-slate-500">
              {query.data.periodStart} ~ {query.data.periodEnd} · 지급일{' '}
              {query.data.payday}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {person?.amounts
                ? formatWon(person.amounts.total)
                : formatMinutes(worked)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {query.data.status === 'confirmed'
                ? '확정된 세전 금액이에요. 공제 후 실지급액은 급여명세서를 확인해 주세요.'
                : '아직 확정 전이에요. 지금까지의 기록으로 계산한 예상 금액이에요.'}
            </p>
            {issues.length > 0 && (
              <div
                role="status"
                className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"
              >
                <p className="font-semibold">
                  아직 계산하지 못한 날이 있어 금액이 더 바뀔 수 있어요.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {issues.map((issue) => (
                    <li key={`${issue.workDate}:${issue.kind}`}>
                      {issue.workDate ? `${issue.workDate} · ` : ''}
                      {ISSUE_LABELS[issue.kind]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {person?.amounts && (
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">기본</dt>
                <dd className="text-right">
                  {formatWon(person.amounts.regular)}
                </dd>
                <dt className="text-slate-500">연장</dt>
                <dd className="text-right">
                  {formatWon(person.amounts.overtime)}
                </dd>
                <dt className="text-slate-500">야간</dt>
                <dd className="text-right">
                  {formatWon(person.amounts.night)}
                </dd>
                <dt className="text-slate-500">주휴</dt>
                <dd className="text-right">
                  {formatWon(person.amounts.weeklyHoliday)}
                </dd>
                {person.amounts.paidLeave > 0 && (
                  <>
                    <dt className="text-slate-500">유급 부재</dt>
                    <dd className="text-right">
                      {formatWon(person.amounts.paidLeave)}
                    </dd>
                  </>
                )}
              </dl>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-3">근무일</th>
                  <th className="px-3 py-3">근무</th>
                  <th className="px-3 py-3">연장</th>
                </tr>
              </thead>
              <tbody>
                {(person?.days ?? [])
                  .filter(
                    (day) =>
                      day.workedMinutes > 0 || issueDates.has(day.workDate)
                  )
                  .map((day) => (
                    <tr key={day.workDate} className="border-t">
                      <td className="px-3 py-3">{day.workDate}</td>
                      <td className="px-3 py-3">
                        {issueDates.has(day.workDate) && day.workedMinutes === 0
                          ? '계산 못 함'
                          : formatMinutes(day.workedMinutes)}
                      </td>
                      <td className="px-3 py-3">
                        {day.overtimeRecordedMinutes === 0
                          ? '—'
                          : day.overtimeRecognizedMinutes === null
                            ? `${formatMinutes(day.overtimeRecordedMinutes)} 확인 중`
                            : formatMinutes(day.overtimeRecognizedMinutes)}
                      </td>
                    </tr>
                  ))}
                {(person?.days ?? []).every(
                  (day) =>
                    day.workedMinutes === 0 && !issueDates.has(day.workDate)
                ) && (
                  <tr>
                    <td colSpan={3} className="p-8 text-center text-slate-400">
                      이 기간에는 근무 기록이 없어요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
