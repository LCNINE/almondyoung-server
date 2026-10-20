'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Paperclip,
} from 'lucide-react';
import { attendanceApi } from '@/lib/api/domains/attendance';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ATTENDANCE_KEY,
  useAttendance,
  useAttendanceAction,
} from '../hooks/use-attendance';
import {
  REVIEW_STATUS,
  reviewBucket,
  reviewCounts,
  reviewDateLabel,
  reviewTimeChanges,
  type ReviewBucket,
  type ReviewDecision,
} from '../lib/request-review-model';
import { RequestReviewDetail } from './request-review-detail';

const BUCKETS = [
  { value: 'pending', label: '검토 대기' },
  { value: 'waiting', label: '보완 대기' },
  { value: 'completed', label: '처리 완료' },
] as const;

export function AttendanceRequestReview({
  showHeading = true,
}: {
  showHeading?: boolean;
}) {
  const { data: me } = useAttendance();
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'requests', true],
    queryFn: () => attendanceApi.requests(true),
    enabled: !!me?.isMaster,
  });
  const [bucket, setBucket] = useState<ReviewBucket>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requests = query.data ?? [];
  const counts = reviewCounts(requests);
  const selected = requests.find((request) => request.id === selectedId);
  const decide = useAttendanceAction(
    (input: {
      id: string;
      version: number;
      status: ReviewDecision;
      reason: string;
    }) => {
      const { id, ...body } = input;

      return attendanceApi.decide(id, body);
    },
    '요청을 처리했어요.'
  );

  return (
    <section className="min-w-0" aria-busy={query.isPending}>
      <div className="pb-5">
        {showHeading && (
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            출결 요청 검토
          </h1>
        )}
        <p
          className={`${showHeading ? 'mt-2' : ''} text-sm leading-6 text-slate-500`}
        >
          {query.isPending ? (
            '요청을 확인하고 있어요.'
          ) : counts.pending ? (
            <>
              <span className="font-semibold text-slate-900">
                {counts.pending}건
              </span>
              의 요청이 검토를 기다리고 있어요.
            </>
          ) : (
            '지금은 검토할 요청이 없어요.'
          )}
        </p>
      </div>
      <Tabs
        value={bucket}
        onValueChange={(value) => setBucket(value as ReviewBucket)}
        className="gap-0"
      >
        <TabsList
          aria-label="요청 처리 상태"
          className="h-12 w-full justify-start rounded-none border-b border-slate-200 bg-transparent p-0"
        >
          {BUCKETS.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="relative h-full min-w-0 gap-1.5 rounded-none border-0 border-b-2 border-transparent px-1 text-[13px] text-slate-500 shadow-none data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-indigo-700 data-[state=active]:shadow-none sm:text-sm"
            >
              {item.label}
              <span className="text-xs tabular-nums opacity-70">
                {query.isPending ? '·' : counts[item.value]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {BUCKETS.map((item) => {
          const filtered = requests.filter(
            (request) => reviewBucket(request.status) === item.value
          );

          return (
            <TabsContent
              key={item.value}
              value={item.value}
              className="mt-0 pt-2"
            >
              {query.isPending ? (
                <div role="status" className="space-y-2 pt-2">
                  <span className="sr-only">요청을 불러오는 중이에요.</span>
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      aria-hidden
                      className="space-y-3 rounded-2xl bg-white px-4 py-5"
                    >
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-4 w-52 max-w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ))}
                </div>
              ) : query.isError ? (
                <div
                  role="alert"
                  className="rounded-2xl bg-white px-5 py-10 text-center"
                >
                  <p className="text-sm text-slate-600">
                    요청을 불러오지 못했어요.
                  </p>
                  <button
                    type="button"
                    onClick={() => void query.refetch()}
                    className="mt-4 min-h-11 rounded-xl bg-slate-100 px-5 text-sm font-semibold text-slate-700"
                  >
                    다시 불러오기
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl bg-white px-5 py-10 text-center">
                  <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-slate-50 text-slate-400">
                    {item.value === 'waiting' ? (
                      <Clock3 className="size-6" aria-hidden />
                    ) : (
                      <Check className="size-6" aria-hidden />
                    )}
                  </span>
                  <p className="text-base font-semibold text-slate-800">
                    {item.value === 'pending'
                      ? '검토할 요청이 없어요'
                      : item.value === 'waiting'
                        ? '보완을 기다리는 요청이 없어요'
                        : '아직 처리한 요청이 없어요'}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {item.value === 'pending'
                      ? '새 요청이 들어오면 여기서 확인할 수 있어요.'
                      : item.value === 'waiting'
                        ? '직원에게 보완을 요청하면 여기에 표시돼요.'
                        : '승인·반려·취소된 요청을 모아서 보여드려요.'}
                  </p>
                  {item.value === 'pending' && counts.completed > 0 && (
                    <button
                      type="button"
                      onClick={() => setBucket('completed')}
                      className="mt-5 min-h-11 rounded-xl px-4 text-sm font-semibold text-indigo-600"
                    >
                      처리한 요청 보기
                    </button>
                  )}
                </div>
              ) : (
                <ul
                  className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white"
                  aria-label={`${item.label} 요청 목록`}
                >
                  {filtered.map((request) => {
                    const status = REVIEW_STATUS[request.status];
                    const changes = reviewTimeChanges(request).filter(
                      (row) => row.changed
                    );

                    return (
                      <li key={request.id}>
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => setSelectedId(request.id)}
                          className="group flex w-full min-w-0 gap-3 px-4 py-5 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:bg-indigo-50 active:bg-slate-100 sm:px-5"
                        >
                          <span
                            aria-hidden
                            className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500"
                          >
                            {(request.name ?? '직원').slice(0, 1)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="truncate text-base font-semibold text-slate-900">
                                {request.name ?? '직원'}
                              </span>
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${status.className}`}
                              >
                                {status.label}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {reviewDateLabel(request.workDate)}
                            </span>
                            <span className="mt-3 block space-y-1">
                              {changes.length ? (
                                changes.map((row) => (
                                  <span
                                    key={row.key}
                                    className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] tabular-nums"
                                  >
                                    <span className="mr-1 text-slate-500">
                                      {row.label}
                                    </span>
                                    <span className="text-slate-500">
                                      {row.before}
                                    </span>
                                    <ArrowRight
                                      className="size-3 shrink-0 text-slate-400"
                                      aria-label="에서"
                                    />
                                    <span className="font-semibold text-slate-800">
                                      {row.after}
                                    </span>
                                  </span>
                                ))
                              ) : (
                                <span className="block text-[13px] text-slate-600">
                                  요청한 근무 시각 확인
                                </span>
                              )}
                            </span>
                            <span className="mt-2 block truncate text-xs leading-5 text-slate-500">
                              {request.reason}
                            </span>
                            {!!request.fileIds.length && (
                              <span className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
                                <Paperclip className="size-3" aria-hidden />
                                사진 {request.fileIds.length}장
                              </span>
                            )}
                          </span>
                          <ChevronRight
                            className="mt-1 size-4 shrink-0 text-slate-300"
                            aria-hidden
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
      {selected && (
        <RequestReviewDetail
          key={selected.id}
          request={selected}
          pending={decide.isPending}
          onClose={() => setSelectedId(null)}
          onDecide={async (status, reason) => {
            await decide.mutateAsync({
              id: selected.id,
              version: selected.version,
              status,
              reason,
            });
            setSelectedId(null);
          }}
        />
      )}
    </section>
  );
}
