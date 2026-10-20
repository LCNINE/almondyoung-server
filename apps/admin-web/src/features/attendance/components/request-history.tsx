'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi } from '@/lib/api/domains/attendance';
import { ATTENDANCE_KEY } from '../hooks/use-attendance';
import { Skeleton } from '@/components/ui/skeleton';
import { REVIEW_STATUS } from '../lib/request-review-model';
import type { RequestStatus } from '@packages/domain-types/attendance';

export function RequestHistory({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'history', requestId],
    queryFn: () => attendanceApi.history(requestId),
    enabled: open,
  });
  const names: Record<string, string> = {
    'request.created': '요청 접수',
    'request.decided': '담당자 처리',
    'request.resubmitted': '보완 제출',
    'request.cancelled': '요청 취소',
    'session.corrected': '기록 반영',
  };

  return (
    <div className="border-t pt-3">
      <button
        type="button"
        aria-expanded={open}
        className="min-h-11 text-xs text-slate-400"
        onClick={() => setOpen(!open)}
      >
        처리 이력 {open ? '접기' : '보기'}
      </button>
      {open && (
        <div className="mt-3 space-y-3" aria-busy={query.isPending}>
          {query.isPending ? (
            <>
              <p role="status" className="sr-only">
                이력을 불러오고 있어요.
              </p>
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} aria-hidden="true" className="space-y-2 py-1">
                  <Skeleton className="h-4 w-full max-w-sm motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-3/4 max-w-xs motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-1/2 motion-reduce:animate-none" />
                </div>
              ))}
            </>
          ) : query.isError ? (
            <p className="text-xs text-red-600">이력을 불러오지 못했어요.</p>
          ) : (
            query.data?.map((entry) => (
              <div
                key={entry.id}
                className="break-words text-xs leading-6 text-slate-500"
              >
                <p>
                  {names[entry.kind] ?? '기록 변경'} · {entry.actor} ·{' '}
                  {new Date(entry.createdAt).toLocaleString('ko-KR')}
                </p>
                {entry.status && (
                  <p>
                    {REVIEW_STATUS[entry.status as RequestStatus]?.label ??
                      entry.status}
                  </p>
                )}
                {entry.reason && (
                  <p className="whitespace-pre-wrap">{entry.reason}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
