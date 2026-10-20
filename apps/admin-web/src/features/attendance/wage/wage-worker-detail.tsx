'use client';

import { useState } from 'react';
import Link from 'next/link';
import type {
  ScheduleDay,
  WageWorkerDetail,
  Weekday,
} from '@packages/domain-types/attendance-wage';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAddWageRate,
  useAddWorkSchedule,
  usePayGroups,
  useSaveWageWorker,
  useWageWorker,
} from '../hooks/use-attendance-wage';
import { formatWon, seoulToday } from './lib/wage-format';
import { scheduleSummary } from './wage-workers';
import { fieldClass, panelClass, WageHeading } from './wage-ui';

const WEEKDAYS: readonly { weekday: Weekday; label: string }[] = [
  { weekday: 1, label: '월' },
  { weekday: 2, label: '화' },
  { weekday: 3, label: '수' },
  { weekday: 4, label: '목' },
  { weekday: 5, label: '금' },
  { weekday: 6, label: '토' },
  { weekday: 7, label: '일' },
];

export function WageWorkerDetailView({ userId }: { userId: string }) {
  const worker = useWageWorker(userId);

  if (worker.isError) {
    return (
      <p role="alert" className={`${panelClass} text-sm text-red-600`}>
        근무자를 불러오지 못했어요.{' '}
        <button className="underline" onClick={() => worker.refetch()}>
          다시 시도
        </button>
      </p>
    );
  }

  if (!worker.data) {
    return (
      <Skeleton
        className="h-64 w-full rounded-2xl"
        aria-label="근무자를 불러오고 있어요."
      />
    );
  }

  return (
    <section className="min-w-0 space-y-6">
      <Link
        className="text-sm text-slate-500 hover:underline"
        href="/company/attendance/wage/workers"
      >
        ← 근무자 목록
      </Link>
      <WageHeading
        title={worker.data.name || '이름 없음'}
        description={
          worker.data.onRoster
            ? '급여 명단에 있어요.'
            : '아직 급여 명단에 없어요. 그룹을 정해 저장하면 명단에 들어가요.'
        }
      />
      <RosterForm
        key={`${worker.data.version ?? 'new'}`}
        worker={worker.data}
      />
      {worker.data.onRoster && (
        <>
          <RateSection worker={worker.data} />
          <ScheduleSection worker={worker.data} />
        </>
      )}
    </section>
  );
}

function RosterForm({ worker }: { worker: WageWorkerDetail }) {
  const groups = usePayGroups();
  const save = useSaveWageWorker();
  const [groupId, setGroupId] = useState(worker.groupId ?? '');
  const [hireDate, setHireDate] = useState(worker.hireDate ?? '');
  const [leaveDate, setLeaveDate] = useState(worker.leaveDate ?? '');
  const [label, setLabel] = useState(worker.label ?? '');
  const [note, setNote] = useState(worker.note ?? '');

  return (
    <section className={panelClass}>
      <h2 className="mb-4 text-base font-bold text-slate-900">명단 정보</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          급여 그룹
          <select
            className={fieldClass}
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">고르세요</option>
            {(groups.data ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          표시 라벨(예: 학생)
          <input
            className={fieldClass}
            value={label}
            maxLength={30}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="text-sm text-slate-600">
          입사일
          <input
            type="date"
            className={fieldClass}
            value={hireDate}
            onChange={(event) => setHireDate(event.target.value)}
          />
        </label>
        <label className="text-sm text-slate-600">
          퇴사일
          <input
            type="date"
            className={fieldClass}
            value={leaveDate}
            onChange={(event) => setLeaveDate(event.target.value)}
          />
        </label>
        <label className="text-sm text-slate-600 sm:col-span-2">
          메모
          <input
            className={fieldClass}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <Can run={useSaveWageWorker}>
        <Button
          className="mt-4"
          disabled={!groupId || save.isPending}
          onClick={() =>
            save.mutate({
              userId: worker.userId,
              groupId,
              hireDate: hireDate || null,
              leaveDate: leaveDate || null,
              label: label || null,
              note: note || null,
              version: worker.version ?? undefined,
            })
          }
        >
          {worker.onRoster ? '저장' : '명단에 추가'}
        </Button>
      </Can>
    </section>
  );
}

function RateSection({ worker }: { worker: WageWorkerDetail }) {
  const add = useAddWageRate();
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    seoulToday(new Date())
  );
  const [wage, setWage] = useState('');

  return (
    <section className={panelClass}>
      <h2 className="mb-1 text-base font-bold text-slate-900">시급 이력</h2>
      <p className="mb-4 text-sm text-slate-500">
        날짜별로 그날 유효한 시급으로 계산해요. 확정한 기간 안의 날짜로는 바꿀
        수 없어요.
      </p>
      <ul className="mb-4 divide-y text-sm">
        {worker.rates.length === 0 && (
          <li className="py-2 text-slate-400">아직 시급이 없어요.</li>
        )}
        {[...worker.rates].reverse().map((rate) => (
          <li key={rate.id} className="flex justify-between py-2">
            <span>{rate.effectiveFrom}부터</span>
            <span className="font-semibold">{formatWon(rate.hourlyWage)}</span>
          </li>
        ))}
      </ul>
      <Can run={useAddWageRate}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-sm text-slate-600">
            적용 시작일
            <input
              type="date"
              className={fieldClass}
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600">
            시급(원)
            <input
              type="number"
              min={1}
              className={fieldClass}
              value={wage}
              onChange={(event) => setWage(event.target.value)}
            />
          </label>
          <Button
            disabled={!effectiveFrom || !(Number(wage) > 0) || add.isPending}
            onClick={() =>
              add.mutate(
                {
                  userId: worker.userId,
                  effectiveFrom,
                  hourlyWage: Math.floor(Number(wage)),
                },
                { onSuccess: () => setWage('') }
              )
            }
          >
            시급 추가
          </Button>
        </div>
      </Can>
    </section>
  );
}

function ScheduleSection({ worker }: { worker: WageWorkerDetail }) {
  const add = useAddWorkSchedule();
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    seoulToday(new Date())
  );
  const [effectiveTo, setEffectiveTo] = useState('');
  const [days, setDays] = useState<ScheduleDay[]>([]);
  const toggle = (weekday: Weekday) =>
    setDays((current) =>
      current.some((day) => day.weekday === weekday)
        ? current.filter((day) => day.weekday !== weekday)
        : [
            ...current,
            { weekday, start: '09:00', end: '18:00', breakMinutes: 60 },
          ]
    );
  const change = (weekday: Weekday, patch: Partial<ScheduleDay>) =>
    setDays((current) =>
      current.map((day) =>
        day.weekday === weekday ? { ...day, ...patch } : day
      )
    );

  return (
    <section className={panelClass}>
      <h2 className="mb-1 text-base font-bold text-slate-900">근무 시간표</h2>
      <p className="mb-4 text-sm text-slate-500">
        시간표가 있으면 그 시간이 소정근로이고, 그보다 길게 일한 시간이 연장
        후보예요. 시간표가 없으면 하루 8시간·주 40시간을 넘는 시간이 연장
        후보예요. 종료일을 넣으면 그 기간에만 쓰고 끝나면 앞의 시간표로
        돌아가요.
      </p>
      <ul className="mb-4 divide-y text-sm">
        {worker.schedules.length === 0 && (
          <li className="py-2 text-slate-400">시간표가 없어요(유연 근무).</li>
        )}
        {[...worker.schedules].reverse().map((schedule) => (
          <li key={schedule.id} className="py-2">
            <span className="font-medium">
              {schedule.effectiveFrom} ~ {schedule.effectiveTo ?? ''}
            </span>
            <span className="ml-2 text-slate-600">
              {scheduleSummary(schedule.days)}
            </span>
          </li>
        ))}
      </ul>
      <Can run={useAddWorkSchedule}>
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="text-sm text-slate-600">
              시작일
              <input
                type="date"
                className={fieldClass}
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </label>
            <label className="text-sm text-slate-600">
              종료일(기간 한정일 때만)
              <input
                type="date"
                className={fieldClass}
                value={effectiveTo}
                onChange={(event) => setEffectiveTo(event.target.value)}
              />
            </label>
          </div>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="근무 요일"
          >
            {WEEKDAYS.map(({ weekday, label }) => (
              <button
                key={weekday}
                type="button"
                aria-pressed={days.some((day) => day.weekday === weekday)}
                onClick={() => toggle(weekday)}
                className={`size-11 rounded-full text-sm ${days.some((day) => day.weekday === weekday) ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {[...days]
            .sort((a, b) => a.weekday - b.weekday)
            .map((day) => (
              <div
                key={day.weekday}
                className="grid grid-cols-[2rem_1fr_1fr_1fr] items-end gap-2 text-sm text-slate-600"
              >
                <span className="pb-3 font-semibold">
                  {WEEKDAYS[day.weekday - 1]?.label}
                </span>
                <label>
                  시작
                  <input
                    type="time"
                    className={fieldClass}
                    value={day.start}
                    onChange={(event) =>
                      change(day.weekday, { start: event.target.value })
                    }
                  />
                </label>
                <label>
                  끝
                  <input
                    type="time"
                    className={fieldClass}
                    value={day.end}
                    onChange={(event) =>
                      change(day.weekday, { end: event.target.value })
                    }
                  />
                </label>
                <label>
                  휴게(분)
                  <input
                    type="number"
                    min={0}
                    className={fieldClass}
                    value={day.breakMinutes ?? 0}
                    onChange={(event) =>
                      change(day.weekday, {
                        breakMinutes: Math.max(
                          0,
                          Math.floor(Number(event.target.value))
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
          <Button
            disabled={!effectiveFrom || add.isPending}
            onClick={() =>
              add.mutate(
                {
                  userId: worker.userId,
                  effectiveFrom,
                  effectiveTo: effectiveTo || null,
                  days,
                },
                { onSuccess: () => setDays([]) }
              )
            }
          >
            시간표 추가
          </Button>
        </div>
      </Can>
    </section>
  );
}
