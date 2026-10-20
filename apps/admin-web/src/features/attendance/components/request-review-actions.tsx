'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronRight, MessageSquareText, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  decisionReasonSchema,
  type ReviewDecision,
} from '../lib/request-review-model';

export function RequestReviewActions({
  pending,
  conflict,
  onDecide,
}: {
  pending: boolean;
  conflict: boolean;
  onDecide: (status: ReviewDecision, reason: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<
    'menu' | 'rejected' | 'needs_information' | null
  >(null);
  const [approvalError, setApprovalError] = useState(false);
  const lock = useRef(false);
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(decisionReasonSchema),
    defaultValues: { reason: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const busy = pending || form.formState.isSubmitting;
  const rejecting = mode === 'rejected';

  useEffect(() => {
    if (mode && mode !== 'menu') {
      form.setFocus('reason');
    }
  }, [mode, form]);

  async function submit(status: ReviewDecision, reason: string) {
    if (lock.current || pending) {
      return;
    }

    if (status === 'approved' && conflict) {
      setApprovalError(true);

      return;
    }

    lock.current = true;

    try {
      await onDecide(status, reason);
      setMode(null);
    } catch {
      // The shared mutation shows the error. Keep the reason for retrying.
    } finally {
      lock.current = false;
    }
  }

  return (
    <>
      <div className="shrink-0 border-t border-slate-100 bg-white px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6">
        {approvalError ? (
          <p role="alert" className="mb-3 text-xs leading-5 text-rose-600">
            원래 기록이 바뀌어 승인할 수 없어요. 보완 요청으로 다시 확인해
            주세요.
          </p>
        ) : (
          <p className="mb-3 text-center text-xs leading-5 text-slate-500">
            승인하면 요청한 시각으로 근무 기록이 바뀌어요.
          </p>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] gap-2.5">
          <Button
            type="button"
            disabled={busy}
            variant="secondary"
            className="h-13 rounded-2xl bg-slate-100 text-sm text-slate-700"
            onClick={() => {
              form.reset();
              setMode('menu');
            }}
          >
            다른 처리
          </Button>
          <Button
            type="button"
            disabled={busy}
            className="h-13 rounded-2xl bg-indigo-600 text-sm font-semibold hover:bg-indigo-700"
            onClick={() => void submit('approved', '')}
          >
            {pending ? '처리 중…' : '승인하고 기록 반영'}
          </Button>
        </div>
      </div>
      <Drawer
        autoFocus
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !lock.current && !busy) {
            setMode(null);
          }
        }}
      >
        <DrawerContent className="mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl">
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
            <DrawerTitle className="text-lg">
              {mode === 'menu'
                ? '어떻게 처리할까요?'
                : rejecting
                  ? '반려 사유'
                  : '보완 요청'}
            </DrawerTitle>
            <button
              type="button"
              aria-label="요청 처리 닫기"
              disabled={busy}
              onClick={() => setMode(null)}
              className="flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {mode === 'menu' ? (
            <>
              <DrawerDescription className="px-5 text-sm text-slate-500">
                직원에게 필요한 안내를 전달해요.
              </DrawerDescription>
              <div className="space-y-1 px-3 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]">
                {(['needs_information', 'rejected'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setMode(status)}
                    className="flex min-h-20 w-full items-center gap-3 rounded-2xl px-3 text-left hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <span
                      className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${status === 'rejected' ? 'bg-rose-50 text-rose-500' : 'bg-indigo-50 text-indigo-600'}`}
                    >
                      {status === 'rejected' ? (
                        <XCircle className="size-5" aria-hidden />
                      ) : (
                        <MessageSquareText className="size-5" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">
                        {status === 'rejected' ? '반려하기' : '보완 요청하기'}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {status === 'rejected'
                          ? '반영하기 어려운 이유를 알려줘요'
                          : '추가로 확인할 내용을 알려줘요'}
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 text-slate-400"
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form
              noValidate
              onSubmit={form.handleSubmit(async ({ reason }) => {
                if (mode) {
                  await submit(mode, reason);
                }
              })}
              className="flex min-h-0 flex-col"
            >
              <div className="min-h-0 overflow-y-auto px-5 pt-1 pb-5">
                <DrawerDescription className="mb-5 text-sm leading-6 text-slate-500">
                  {rejecting
                    ? '요청을 반영하기 어려운 이유를 알려 주세요.'
                    : '어떤 내용을 더 확인해야 하는지 알려 주세요.'}
                </DrawerDescription>
                <label
                  htmlFor="review-decision-reason"
                  className="mb-2 block text-sm font-semibold text-slate-800"
                >
                  직원에게 전달할 사유
                </label>
                <Textarea
                  id="review-decision-reason"
                  placeholder={
                    rejecting
                      ? '예: 첨부한 사진의 날짜가 근무일과 달라요.'
                      : '예: 출근 시각을 확인할 수 있는 사진을 첨부해 주세요.'
                  }
                  aria-invalid={!!form.formState.errors.reason}
                  aria-describedby="review-decision-error"
                  maxLength={2000}
                  disabled={busy}
                  rows={4}
                  className="min-h-32 resize-none rounded-2xl p-4 text-base leading-6"
                  {...form.register('reason')}
                />
                {form.formState.errors.reason && (
                  <p
                    id="review-decision-error"
                    role="alert"
                    className="mt-2 text-sm text-rose-600"
                  >
                    {form.formState.errors.reason.message}
                  </p>
                )}
              </div>
              <div className="shrink-0 border-t border-slate-100 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
                <Button
                  type="submit"
                  disabled={busy}
                  className={`h-13 w-full rounded-2xl text-base font-semibold ${rejecting ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                >
                  {busy
                    ? '처리 중…'
                    : rejecting
                      ? '반려하고 사유 보내기'
                      : '보완 요청 보내기'}
                </Button>
              </div>
            </form>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
