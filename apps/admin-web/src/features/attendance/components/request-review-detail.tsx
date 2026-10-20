'use client';

import { useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CircleAlert,
  FileText,
  MessageSquareText,
} from 'lucide-react';
import type { AttendanceRequest } from '@packages/domain-types/attendance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  REVIEW_STATUS,
  requestRecordChanged,
  reviewDateLabel,
  reviewTimeChanges,
  type ReviewDecision,
} from '../lib/request-review-model';
import { RequestAttachmentGallery } from './request-attachment-gallery';
import { RequestHistory } from './request-history';
import { RequestReviewActions } from './request-review-actions';

export function RequestReviewDetail({
  request,
  pending,
  onClose,
  onDecide,
}: {
  request: AttendanceRequest;
  pending: boolean;
  onClose: () => void;
  onDecide: (status: ReviewDecision, reason: string) => Promise<void>;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const status = REVIEW_STATUS[request.status];
  const conflict = requestRecordChanged(request);
  const changes = reviewTimeChanges(request);
  const hasChanges = changes.some((row) => row.changed);
  const aiVisible =
    request.status !== 'cancelled' &&
    (request.aiResult || request.status === 'pending');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          title.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
        className="top-0 right-0 bottom-0 left-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 sm:left-auto sm:max-w-xl sm:border-l"
      >
        <header className="shrink-0 border-b border-slate-100 bg-white pt-[env(safe-area-inset-top)]">
          <div className="grid min-h-14 grid-cols-[44px_minmax(0,1fr)_44px] items-center px-3">
            <button
              type="button"
              aria-label="요청 목록으로 돌아가기"
              disabled={pending}
              onClick={onClose}
              className="flex size-11 items-center justify-center rounded-full text-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
            <DialogTitle
              ref={title}
              tabIndex={-1}
              className="text-center text-base font-semibold outline-none"
            >
              요청 상세
            </DialogTitle>
            <span aria-hidden />
          </div>
          <DialogDescription className="sr-only">
            기존 기록과 변경할 시각, 요청 사유를 확인하고 처리해 주세요.
          </DialogDescription>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 sm:px-6">
          <section className="pt-6 pb-7">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="min-w-0 break-words text-2xl font-bold tracking-tight text-slate-950">
                {request.name ?? '직원'}
              </h2>
              <span
                className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${status.className}`}
              >
                {status.label}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {reviewDateLabel(request.workDate)} 근무 기록
            </p>
            <p className="mt-6 text-lg font-semibold leading-7 text-slate-900">
              {hasChanges
                ? '이렇게 변경해 달라고 요청했어요'
                : '요청한 근무 시각을 확인해 주세요'}
            </p>
            <div className="mt-4 overflow-hidden rounded-2xl bg-slate-50 px-4">
              {changes.map((row) => (
                <div
                  key={row.key}
                  className="border-b border-slate-200/70 py-4 last:border-b-0"
                >
                  <span className="text-xs font-medium text-slate-500">
                    {row.label}
                  </span>
                  {row.changed ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold tabular-nums">
                      <span className="text-slate-500">{row.before}</span>
                      <ArrowRight
                        className="size-4 shrink-0 text-slate-400"
                        aria-label="에서"
                      />
                      <span className="text-indigo-600">{row.after}</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-medium tabular-nums text-slate-700">
                        {row.after}
                      </span>
                      <span className="text-xs text-slate-500">
                        {row.requested ? '변경 없음' : '기존 기록 유지'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {conflict && request.status === 'pending' && (
              <div className="mt-4 flex gap-2.5 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  요청 후 원래 기록이 변경됐어요. 승인 전에 보완 요청으로 다시
                  확인해 주세요.
                </p>
              </div>
            )}
          </section>
          <section className="border-t border-slate-100 py-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MessageSquareText
                className="size-4 text-slate-400"
                aria-hidden
              />
              요청 사유
            </h3>
            <p className="mt-3 whitespace-pre-wrap break-words text-base leading-7 text-slate-700">
              {request.reason}
            </p>
          </section>
          {request.fileIds.length > 0 && (
            <section className="border-t border-slate-100 py-6">
              <h3 className="mb-4 text-sm font-semibold text-slate-900">
                첨부 사진{' '}
                <span className="ml-1 text-slate-400">
                  {request.fileIds.length}
                </span>
              </h3>
              <RequestAttachmentGallery fileIds={request.fileIds} />
            </section>
          )}
          {request.decisionReason && (
            <section className="border-t border-slate-100 py-6">
              <h3 className="text-sm font-semibold text-slate-900">
                {request.status === 'needs_information'
                  ? '직원에게 요청한 보완 내용'
                  : '처리 사유'}
              </h3>
              <p className="mt-3 whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {request.decisionReason}
              </p>
            </section>
          )}
          {request.status === 'needs_information' && (
            <p className="mb-5 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              직원이 보완 내용을 제출하면 다시 검토할 수 있어요.
            </p>
          )}
          {aiVisible && (
            <details className="group border-t border-slate-100 py-1">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
                <FileText className="size-4 text-slate-400" aria-hidden />
                검토 보조
                <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                  AI
                </span>
                <ChevronDown
                  className="ml-auto size-4 text-slate-400 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="pb-5 text-sm leading-6 text-slate-600">
                {request.aiResult ? (
                  <>
                    <p className="whitespace-pre-wrap break-words">
                      {request.aiResult.summary}
                    </p>
                    {request.aiResult.questions.length > 0 && (
                      <ul className="mt-3 list-disc space-y-1 pl-5">
                        {request.aiResult.questions.map((question, index) => (
                          <li key={index} className="break-words">
                            {question}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 text-xs text-slate-400">
                      요청 사유와 첨부 사진을 함께 확인해 주세요.
                    </p>
                  </>
                ) : (
                  <p>
                    {request.aiStatus === 'failed'
                      ? '검토 보조 결과를 불러오지 못했어요. 요청 내용을 직접 확인해 주세요.'
                      : '아직 검토 보조 결과가 없어요. 요청 내용을 먼저 확인할 수 있어요.'}
                  </p>
                )}
              </div>
            </details>
          )}
          <RequestHistory requestId={request.id} />
        </div>
        {request.status === 'pending' ? (
          <RequestReviewActions
            pending={pending}
            conflict={conflict}
            onDecide={onDecide}
          />
        ) : (
          <div className="shrink-0 border-t border-slate-100 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="h-13 w-full rounded-2xl bg-slate-100 text-base font-semibold text-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              목록으로 돌아가기
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
