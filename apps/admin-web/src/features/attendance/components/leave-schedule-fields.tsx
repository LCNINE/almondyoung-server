'use client';

import { AttendanceTimeField } from './attendance-time-field';
import {
  LEAVE_LABELS,
  type LeaveType,
} from '@packages/domain-types/attendance';
import {
  changeLeaveType,
  changeStart,
  validateDraft,
  type LeaveDraft,
} from '../lib/attendance-model';

export function LeaveScheduleFields({
  day,
  id,
  normalStart,
  normalEnd,
  onChange,
  submitted,
  required = true,
  recommendation,
}: {
  day: LeaveDraft;
  id: string;
  normalStart: string;
  normalEnd: string;
  onChange: (day: LeaveDraft) => void;
  submitted: boolean;
  required?: boolean;
  recommendation?: { start: string; end: string } | null;
}) {
  const error = submitted && required ? validateDraft(day) : null;

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <p className="mb-3 text-sm font-medium">휴가 종류</p>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
          {(Object.entries(LEAVE_LABELS) as [LeaveType, string][]).map(
            ([type, label]) => (
              <button
                key={type}
                type="button"
                aria-pressed={day.type === type}
                className={`min-h-11 rounded-md px-1 py-2.5 text-xs transition-colors ${day.type === type ? 'bg-white font-semibold text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                onClick={() =>
                  onChange(changeLeaveType(day, type, normalStart, normalEnd))
                }
              >
                {label}
              </button>
            )
          )}
        </div>
      </div>
      {day.type !== 'full' && (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2">
            <AttendanceTimeField
              id={`leave-start-${id}`}
              label="출근 예정"
              required={required}
              value={day.start ?? ''}
              onChange={(value) => onChange(changeStart(day, value, normalEnd))}
            />
            <div className="min-w-0 space-y-2">
              <AttendanceTimeField
                id={`leave-end-${id}`}
                label="퇴근 예정"
                required={required}
                value={day.end ?? ''}
                onChange={(value) =>
                  onChange({ ...day, end: value, manualEnd: true })
                }
              />
              {day.type === 'am' && (
                <p className="text-xs text-indigo-600">
                  {day.manualEnd ? '직접 수정한 시각' : '자동으로 계산한 시각'}
                </p>
              )}
            </div>
          </div>
          {recommendation && (
            <button
              type="button"
              className="w-full rounded-lg bg-indigo-50 p-3 text-left text-xs text-indigo-700"
              onClick={() =>
                onChange({
                  ...day,
                  start: recommendation.start,
                  end: day.manualEnd ? day.end : recommendation.end,
                })
              }
            >
              최근 예정 시각 {recommendation.start} 적용하기
            </button>
          )}
          {day.manualEnd && day.type === 'am' && (
            <button
              type="button"
              className="min-h-11 text-left text-xs text-indigo-700"
              onClick={() =>
                onChange({ ...day, end: normalEnd, manualEnd: false })
              }
            >
              평소 퇴근 시각으로 되돌리기
            </button>
          )}
          {error && (
            <p className="text-xs text-red-600" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
