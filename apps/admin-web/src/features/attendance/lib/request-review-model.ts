import { z } from 'zod';
import type {
  AttendanceRequest,
  RequestStatus,
} from '@packages/domain-types/attendance';

export type ReviewBucket = 'pending' | 'waiting' | 'completed';
export type ReviewDecision = 'approved' | 'rejected' | 'needs_information';

export const REVIEW_STATUS: Record<
  RequestStatus,
  { label: string; className: string }
> = {
  pending: { label: '검토 대기', className: 'bg-indigo-50 text-indigo-700' },
  needs_information: {
    label: '보완 대기',
    className: 'bg-amber-50 text-amber-800',
  },
  approved: { label: '승인', className: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: '반려', className: 'bg-rose-50 text-rose-700' },
  cancelled: { label: '취소', className: 'bg-slate-100 text-slate-500' },
};

export function reviewBucket(status: RequestStatus): ReviewBucket {
  if (status === 'pending') {
    return 'pending';
  }

  return status === 'needs_information' ? 'waiting' : 'completed';
}

export function reviewCounts(requests: AttendanceRequest[]) {
  const counts = { pending: 0, waiting: 0, completed: 0 };

  for (const request of requests) {
    counts[reviewBucket(request.status)] += 1;
  }

  return counts;
}

export function reviewDateLabel(date: string) {
  const value = new Date(`${date}T12:00:00+09:00`);
  const weekday = new Intl.DateTimeFormat('ko-KR', {
    weekday: 'short',
    timeZone: 'Asia/Seoul',
  }).format(value);

  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${weekday})`;
}

function timeLabel(instant: string | null | undefined, workDate: string) {
  if (!instant) {
    return '기록 없음';
  }

  const value = new Date(instant);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  const clock = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(value);

  if (date === workDate) {
    return clock;
  }

  const delta =
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${workDate}T00:00:00Z`)) /
    86400000;
  const prefix =
    delta === 1 ? '다음 날' : delta === -1 ? '전날' : reviewDateLabel(date);

  return `${prefix} ${clock}`;
}

export function reviewTimeChanges(request: AttendanceRequest) {
  return (['checkIn', 'checkOut'] as const).map((key) => {
    const before = request.original?.[key];
    const requested = !!request[key];
    const after = request[key] ?? before;

    return {
      key,
      label: key === 'checkIn' ? '출근' : '퇴근',
      before: timeLabel(before, request.workDate),
      after: timeLabel(after, request.workDate),
      changed:
        requested && (!before || Date.parse(before) !== Date.parse(after!)),
      requested,
    };
  });
}

export function requestRecordChanged(request: AttendanceRequest) {
  return (request.original?.version ?? null) !== request.targetVersion;
}

export const decisionReasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, '직원에게 전달할 사유를 입력해 주세요.')
    .max(2000, '사유는 2,000자까지 입력할 수 있어요.'),
});
