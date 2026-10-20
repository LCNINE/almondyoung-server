import type { AttendanceRequest } from '@packages/domain-types/attendance';
import {
  reviewBucket,
  reviewCounts,
  reviewTimeChanges,
  requestRecordChanged,
  reviewDateLabel,
  decisionReasonSchema,
} from './request-review-model';

const request = {
  status: 'pending',
  workDate: '2026-10-19',
  targetVersion: 3,
  original: {
    checkIn: '2026-10-19T00:12:00Z',
    checkOut: '2026-10-19T09:00:00Z',
    version: 3,
  },
  checkIn: '2026-10-19T00:00:00Z',
  checkOut: null,
} as AttendanceRequest;

it('separates pending, waiting for information and finished requests', () => {
  expect(reviewBucket('pending')).toBe('pending');
  expect(reviewBucket('needs_information')).toBe('waiting');
  expect(
    ['approved', 'rejected', 'cancelled'].map((status) =>
      reviewBucket(status as AttendanceRequest['status'])
    )
  ).toEqual(['completed', 'completed', 'completed']);
  expect(reviewCounts([request, { ...request, status: 'rejected' }])).toEqual({
    pending: 1,
    waiting: 0,
    completed: 1,
  });
});

it('keeps an omitted checkout and highlights only the requested change', () => {
  expect(reviewTimeChanges(request)).toEqual([
    {
      key: 'checkIn',
      label: '출근',
      before: '오전 9:12',
      after: '오전 9:00',
      changed: true,
      requested: true,
    },
    {
      key: 'checkOut',
      label: '퇴근',
      before: '오후 6:00',
      after: '오후 6:00',
      changed: false,
      requested: false,
    },
  ]);
});

it('distinguishes an absent original and next-day checkout', () => {
  const rows = reviewTimeChanges({
    ...request,
    original: null,
    targetVersion: null,
    checkOut: '2026-10-19T17:00:00Z',
  });

  expect(rows[0].before).toBe('기록 없음');
  expect(rows[1].after).toBe('다음 날 오전 2:00');
});

it('detects changed originals, including a newly created record', () => {
  expect(requestRecordChanged(request)).toBe(false);
  expect(
    requestRecordChanged({
      ...request,
      original: { ...request.original!, version: 4 },
    })
  ).toBe(true);
  expect(requestRecordChanged({ ...request, targetVersion: null })).toBe(true);
  expect(
    requestRecordChanged({ ...request, original: null, targetVersion: null })
  ).toBe(false);
});

it('formats a readable Korean work date', () => {
  expect(reviewDateLabel('2026-10-19')).toBe('10월 19일 (월)');
});

it('requires a trimmed reason for secondary decisions and caps it at the API limit', () => {
  expect(decisionReasonSchema.safeParse({ reason: '   ' }).success).toBe(false);
  expect(
    decisionReasonSchema.parse({ reason: '  출근 사진을 확인해 주세요.  ' })
      .reason
  ).toBe('출근 사진을 확인해 주세요.');
  expect(
    decisionReasonSchema.safeParse({ reason: '가'.repeat(2001) }).success
  ).toBe(false);
});
