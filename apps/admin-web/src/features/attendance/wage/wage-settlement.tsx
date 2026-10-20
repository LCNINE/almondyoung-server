'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  payPeriodFor,
  type SettlementResult,
} from '@packages/domain-types/attendance-wage';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { exportToExcel } from '@/lib/utils/export-excel';
import {
  useConfirmSettlement,
  useExportSettlement,
  useReopenSettlement,
  useSettlement,
  useSettlementPreview,
  useSettlements,
} from '../hooks/use-attendance-wage';
import {
  confirmBlockedReason,
  currentMonth,
  formatMinutes,
  formatWon,
  ISSUE_LABELS,
  seoulToday,
  WARNING_LABELS,
} from './lib/wage-format';
import { settlementSheetRows } from './lib/wage-sheet';
import {
  fieldClass,
  panelClass,
  WageHeading,
  WagePeriodBar,
  useWagePeriod,
} from './wage-ui';

const ISSUE_LINKS = {
  missing_checkout: '/company/attendance/review',
  no_rate: '/company/attendance/wage/workers',
  overtime_undecided: '/company/attendance/wage/decisions',
  absence_undecided: '/company/attendance/wage/decisions',
  not_on_roster: '/company/attendance/wage/workers',
  outside_employment: '/company/attendance/wage/workers',
} as const;

export function WageSettlement() {
  const { groupId, setGroupId, month, setMonth, groups } = useWagePeriod(
    currentMonth(new Date())
  );
  const group = groups.find((entry) => entry.id === groupId);
  const period = group ? payPeriodFor(group, month) : null;
  const hourly = group?.payBasis !== 'salaried';
  const preview = useSettlementPreview(groupId, month);
  const history = useSettlements(groupId);
  // 확정 여부는 미리보기와 따로, 그룹 달력으로 정한 기간으로 찾는다.
  const confirmed = (history.data ?? []).find(
    (row) =>
      row.status === 'confirmed' && row.periodStart === period?.periodStart
  );
  const record = useSettlement(confirmed?.id ?? null);

  let body: ReactNode;

  if (!groupId) {
    body = null;
  } else if (history.isError) {
    body = (
      <Retry
        message="확정 기록을 불러오지 못했어요."
        onRetry={() => history.refetch()}
      />
    );
  } else if (history.isPending) {
    body = <Loading label="확정 여부를 확인하고 있어요." />;
  } else if (confirmed) {
    body = record.isError ? (
      <Retry
        message="확정본을 불러오지 못했어요."
        onRetry={() => record.refetch()}
      />
    ) : !record.data ? (
      <Loading label="확정본을 불러오고 있어요." />
    ) : (
      <>
        <SettlementStatus
          result={record.data.snapshot}
          hourly={hourly}
          confirmedId={confirmed.id}
          confirmedAt={confirmed.confirmedAt}
          groupId={groupId}
          month={month}
        />
        <SettlementTable result={record.data.snapshot} frozen />
      </>
    );
  } else if (preview.isError) {
    body = (
      <Retry
        message="정산을 계산하지 못했어요."
        onRetry={() => preview.refetch()}
      />
    );
  } else if (!preview.data) {
    body = <Loading label="정산을 계산하고 있어요." />;
  } else {
    body = (
      <>
        <SettlementStatus
          result={preview.data}
          hourly={hourly}
          confirmedId={null}
          confirmedAt={null}
          groupId={groupId}
          month={month}
        />
        <IssueList result={preview.data} />
        <SettlementTable result={preview.data} frozen={false} />
      </>
    );
  }

  return (
    <section className="min-w-0 space-y-6">
      <WageHeading
        title="급여 정산"
        description="출퇴근 기록과 시급·규칙으로 사람별 세전 지급액을 계산해요. 공제와 실지급은 기존처럼 처리해 주세요."
      />
      <WagePeriodBar
        groupId={groupId}
        onGroup={setGroupId}
        month={month}
        onMonth={setMonth}
      />
      {body}
      {(history.data ?? []).length > 0 && (
        <section className={panelClass}>
          <h2 className="mb-3 text-base font-bold text-slate-900">확정 기록</h2>
          <ul className="divide-y text-sm">
            {(history.data ?? []).map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap justify-between gap-2 py-2"
              >
                <span>
                  {row.periodStart} ~ {row.periodEnd}
                  {hourly ? ` · ${formatWon(row.total)}` : ' · 근무시간 통계'}
                </span>
                <span className="text-slate-500">
                  {row.status === 'confirmed'
                    ? `확정 ${row.confirmedAt.slice(0, 10)}`
                    : `다시 엶 — ${row.reopenReason ?? ''}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function Retry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p role="alert" className={`${panelClass} text-sm text-red-600`}>
      {message}{' '}
      <button className="underline" onClick={onRetry}>
        다시 시도
      </button>
    </p>
  );
}

function Loading({ label }: { label: string }) {
  return <Skeleton className="h-64 w-full rounded-2xl" aria-label={label} />;
}

function SettlementStatus({
  result,
  hourly,
  confirmedId,
  confirmedAt,
  groupId,
  month,
}: {
  result: SettlementResult;
  hourly: boolean;
  confirmedId: string | null;
  confirmedAt: string | null;
  groupId: string;
  month: string;
}) {
  const confirm = useConfirmSettlement();
  const reopen = useReopenSettlement();
  const exporter = useExportSettlement();
  const [reason, setReason] = useState('');
  const blocked = confirmBlockedReason(result, seoulToday(new Date()));

  return (
    <div
      className={`${panelClass} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}
    >
      <div>
        <p className="text-sm text-slate-500">
          {confirmedId
            ? `확정본 · ${confirmedAt?.slice(0, 10)}`
            : '미리보기 · 확정 전'}
        </p>
        <p className="text-2xl font-bold text-slate-950">
          {hourly ? formatWon(result.totals.total) : '근무시간 통계만'}
          <span className="ml-2 text-sm font-medium text-slate-400">
            {result.totals.people}명
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Can run={useExportSettlement}>
          <Button
            variant="outline"
            disabled={exporter.isPending || result.people.length === 0}
            onClick={() =>
              exporter.mutate(
                confirmedId
                  ? { id: confirmedId }
                  : { groupId, paydayMonth: month },
                {
                  onSuccess: (data) =>
                    exportToExcel(
                      settlementSheetRows(data),
                      `급여정산_${data.periodStart}_${data.periodEnd}`
                    ),
                }
              )
            }
          >
            엑셀 내려받기
          </Button>
        </Can>
        {confirmedId ? (
          <Can run={useReopenSettlement}>
            <div className="flex gap-2">
              <input
                className={`${fieldClass} sm:w-56`}
                placeholder="다시 여는 사유"
                aria-label="다시 여는 사유"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                variant="outline"
                disabled={!reason.trim() || reopen.isPending}
                onClick={() =>
                  reopen.mutate(
                    { id: confirmedId, reason },
                    { onSuccess: () => setReason('') }
                  )
                }
              >
                다시 열기
              </Button>
            </div>
          </Can>
        ) : (
          <Can run={useConfirmSettlement}>
            <div className="flex flex-col items-end gap-1">
              <Button
                disabled={!!blocked || confirm.isPending}
                onClick={() => confirm.mutate({ groupId, paydayMonth: month })}
              >
                정산 확정
              </Button>
              {blocked && (
                <span className="text-xs text-slate-500">{blocked}</span>
              )}
            </div>
          </Can>
        )}
      </div>
    </div>
  );
}

function IssueList({ result }: { result: SettlementResult }) {
  if (result.issues.length === 0) {
    return null;
  }

  const names = new Map(
    result.people.map((person) => [person.userId, person.name])
  );

  return (
    <section
      role="status"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-5"
    >
      <h2 className="mb-2 text-sm font-bold text-amber-900">
        계산하지 못한 항목 {result.issues.length}건 — 0원으로 넣지 않고 따로
        모았어요
      </h2>
      <ul className="space-y-1 text-sm text-amber-900">
        {result.issues.map((issue) => (
          <li key={`${issue.userId}:${issue.workDate}:${issue.kind}`}>
            {names.get(issue.userId) ?? '명단 밖 직원'}
            {issue.workDate ? ` · ${issue.workDate}` : ''} ·{' '}
            {ISSUE_LABELS[issue.kind]}{' '}
            <Link className="underline" href={ISSUE_LINKS[issue.kind]}>
              바로 가기
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettlementTable({
  result,
  frozen,
}: {
  result: SettlementResult;
  frozen: boolean;
}) {
  const hourly =
    result.people.some((person) => person.amounts !== null) ||
    result.people.length === 0;

  return (
    <div className="overflow-x-auto rounded-2xl border bg-white">
      {!hourly && (
        <p className="border-b px-4 py-3 text-sm text-slate-500">
          월급제 그룹은 근무시간 통계만 보여요.
        </p>
      )}
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-3">이름</th>
            <th className="px-4 py-3">근무시간</th>
            <th className="px-4 py-3">인정 연장</th>
            <th className="px-4 py-3">야간</th>
            <th className="px-4 py-3">주휴</th>
            {hourly && <th className="px-4 py-3 text-right">세전 지급액</th>}
          </tr>
        </thead>
        <tbody>
          {result.people.map((person) => {
            const sum = (pick: (day: (typeof person.days)[number]) => number) =>
              person.days.reduce((total, day) => total + pick(day), 0);

            return (
              <tr key={person.userId} className="border-t align-top">
                <td className="px-4 py-3">
                  <span className="font-medium text-slate-900">
                    {person.name}
                  </span>
                  {person.warnings.map((warning) => (
                    <span
                      key={warning}
                      className="ml-2 inline-block rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700"
                    >
                      {WARNING_LABELS[warning]}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-3">
                  {formatMinutes(sum((day) => day.workedMinutes))}
                </td>
                <td className="px-4 py-3">
                  {formatMinutes(
                    sum((day) => day.overtimeRecognizedMinutes ?? 0)
                  )}
                </td>
                <td className="px-4 py-3">
                  {formatMinutes(sum((day) => day.nightMinutes))}
                </td>
                <td className="px-4 py-3">
                  {formatMinutes(person.weeklyHolidayMinutes)}
                </td>
                {hourly && (
                  <td className="px-4 py-3 text-right">
                    {person.amounts && (
                      <span
                        className={
                          person.complete || frozen
                            ? 'font-semibold text-slate-900'
                            : 'text-slate-400'
                        }
                      >
                        {formatWon(person.amounts.total)}
                        {!person.complete && !frozen && (
                          <span className="ml-1 text-xs">(확정 전)</span>
                        )}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {result.people.length === 0 && (
            <tr>
              <td colSpan={6} className="p-10 text-center text-slate-400">
                이 그룹의 근무자 명단이 비어 있어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
