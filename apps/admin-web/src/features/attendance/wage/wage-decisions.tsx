'use client';

import { useState } from 'react';
import type {
  AbsenceKind,
  WageDecisionItem,
} from '@packages/domain-types/attendance-wage';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDecideAbsence,
  useDecideOvertime,
  useWageDecisions,
} from '../hooks/use-attendance-wage';
import { currentMonth, formatMinutes } from './lib/wage-format';
import {
  fieldClass,
  panelClass,
  WageHeading,
  WagePeriodBar,
  useWagePeriod,
} from './wage-ui';

const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  excused_paid: '사유 있음 · 유급',
  excused_unpaid: '사유 있음 · 무급',
  absent: '결근',
};
const LEAVE_LABELS = {
  full: '종일',
  am: '오전 반차',
  pm: '오후 반차',
} as const;
const ABSENCE_KINDS: readonly AbsenceKind[] = [
  'excused_paid',
  'excused_unpaid',
  'absent',
];

export function WageDecisions() {
  const { groupId, setGroupId, month, setMonth } = useWagePeriod(
    currentMonth(new Date()),
    'decisions'
  );
  const query = useWageDecisions(groupId, month);
  const items = query.data?.items ?? [];
  const pending = items.filter(
    (item) => !item.overtime && !item.absence
  ).length;

  return (
    <section className="min-w-0 space-y-6">
      <WageHeading
        title="연장·부재 판정"
        description="시간표보다 길게 일한 날은 연장으로 인정할지, 시간표상 근무일인데 기록이 없는 날은 어떤 부재인지 정해 주세요. 판정 전에는 금액이 «확정 전»으로 남아요."
      />
      <WagePeriodBar
        groupId={groupId}
        onGroup={setGroupId}
        month={month}
        onMonth={setMonth}
        source="decisions"
      />
      {query.isError ? (
        <p role="alert" className={`${panelClass} text-sm text-red-600`}>
          판정할 날을 불러오지 못했어요.{' '}
          <button className="underline" onClick={() => query.refetch()}>
            다시 시도
          </button>
        </p>
      ) : query.isPending ? (
        groupId && (
          <Skeleton
            className="h-48 w-full rounded-2xl"
            aria-label="판정할 날을 불러오고 있어요."
          />
        )
      ) : items.length === 0 ? (
        <p className={`${panelClass} text-sm text-slate-500`}>
          이 기간에는 판정할 날이 없어요.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            판정할 날 {items.length}건 · 아직 안 정한 날{' '}
            <strong>{pending}건</strong>
          </p>
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={`${item.userId}:${item.workDate}:${item.kind}`}
                className={panelClass}
              >
                {item.kind === 'overtime' ? (
                  <OvertimeRow item={item} />
                ) : (
                  <AbsenceRow item={item} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function RowHeading({
  item,
  label,
}: {
  item: WageDecisionItem;
  label: string;
}) {
  return (
    <p className="mb-3 text-sm">
      <span className="font-semibold text-slate-900">{item.name}</span>
      <span className="ml-2 text-slate-500">{item.workDate}</span>
      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
        {label}
      </span>
    </p>
  );
}

function OvertimeRow({ item }: { item: WageDecisionItem }) {
  const decide = useDecideOvertime();
  const [minutes, setMinutes] = useState(
    item.overtime?.recognizedMinutes || item.recordedMinutes
  );
  const [reason, setReason] = useState(item.overtime?.reason ?? '');
  const submit = (status: 'recognized' | 'rejected') =>
    decide.mutate({
      userId: item.userId,
      workDate: item.workDate,
      status,
      recognizedMinutes: status === 'recognized' ? minutes : 0,
      recordedMinutes: item.recordedMinutes,
      reason: reason.trim() || undefined,
      version: item.overtime?.version,
    });

  return (
    <>
      <RowHeading
        item={item}
        label={`초과 ${formatMinutes(item.recordedMinutes)}`}
      />
      <p className="mb-3 text-sm text-slate-600">
        {item.overtime
          ? item.overtime.status === 'recognized'
            ? `인정됨 · ${formatMinutes(item.overtime.recognizedMinutes)}`
            : `인정하지 않음 · ${item.overtime.reason ?? ''}`
          : '아직 정하지 않았어요.'}
      </p>
      <Can run={useDecideOvertime}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="text-sm text-slate-600 sm:w-40">
            인정할 시간(분)
            <input
              type="number"
              min={1}
              max={item.recordedMinutes}
              className={fieldClass}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          <label className="flex-1 text-sm text-slate-600">
            사유(인정하지 않을 때 필수)
            <input
              className={fieldClass}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <Button
              disabled={
                decide.isPending ||
                minutes < 1 ||
                minutes > item.recordedMinutes
              }
              onClick={() => submit('recognized')}
            >
              연장 인정
            </Button>
            <Button
              variant="outline"
              disabled={decide.isPending || !reason.trim()}
              onClick={() => submit('rejected')}
            >
              인정 안 함
            </Button>
          </div>
        </div>
      </Can>
    </>
  );
}

function AbsenceRow({ item }: { item: WageDecisionItem }) {
  const decide = useDecideAbsence();
  const [reason, setReason] = useState(item.absence?.reason ?? '');

  return (
    <>
      <RowHeading
        item={item}
        label={`시간표 ${formatMinutes(item.recordedMinutes)} · 기록 없음`}
      />
      {item.leave && (
        <p className="mb-1 text-sm text-slate-600">
          본인이 등록한 휴가: {LEAVE_LABELS[item.leave]}
          {item.suggested &&
            ` · 규칙의 기본값은 «${ABSENCE_LABELS[item.suggested]}»`}
        </p>
      )}
      <p className="mb-3 text-sm text-slate-600">
        {item.absence
          ? `판정: ${ABSENCE_LABELS[item.absence.kind]}`
          : '아직 정하지 않았어요. 정하기 전에는 그 주의 주휴수당이 «확정 전»이에요.'}
      </p>
      <Can run={useDecideAbsence}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex-1 text-sm text-slate-600">
            사유(선택)
            <input
              className={fieldClass}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            {ABSENCE_KINDS.map((kind) => (
              <Button
                key={kind}
                variant={
                  (item.absence?.kind ?? item.suggested) === kind
                    ? 'default'
                    : 'outline'
                }
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({
                    userId: item.userId,
                    workDate: item.workDate,
                    kind,
                    reason: reason.trim() || undefined,
                    version: item.absence?.version,
                  })
                }
              >
                {ABSENCE_LABELS[kind]}
              </Button>
            ))}
          </div>
        </div>
      </Can>
    </>
  );
}
