'use client';

import { useMemo, useState, useEffect, useId, useRef } from 'react';
import Image from 'next/image';
import { useController, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  correctionFormSchema,
  type CorrectionFormValues,
} from '../lib/correction-form-schema';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  attendanceApi,
  type CorrectionInput,
} from '@/lib/api/domains/attendance';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';
import { ATTENDANCE_KEY, useAttendanceAction } from '../hooks/use-attendance';
import { formatAttendanceTime } from '../lib/attendance-model';
import {
  seoulDate,
  type AttendanceRequest,
  type RequestStatus,
} from '@packages/domain-types/attendance';
import { toast } from 'sonner';
import { AttendanceTimeField } from './attendance-time-field';
import { AttendanceRequestReview } from './request-review';
import { RequestHistory } from './request-history';

const PHOTO_EXAMPLE_BLUR_DATA_URL =
  'data:image/webp;base64,UklGRkoAAABXRUJQVlA4ID4AAACwAQCdASoIAAgAA8BgJZwAAvxVXVeAAPvJN4RXbCqkb/EooHAAo1sq0a0oNxsWWXY2sUzBATgwoL+Q3AAAAA==';

const labels: Record<RequestStatus, string> = {
  pending: '검토 중',
  needs_information: '추가 확인',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
};

export function CorrectionRequests({
  review = false,
  showHeading = true,
}: {
  review?: boolean;
  showHeading?: boolean;
}) {
  return review ? (
    <AttendanceRequestReview showHeading={showHeading} />
  ) : (
    <EmployeeCorrectionRequests showHeading={showHeading} />
  );
}

function EmployeeCorrectionRequests({ showHeading }: { showHeading: boolean }) {
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'requests', false],
    queryFn: () => attendanceApi.requests(false),
  });
  const [form, setForm] = useState<AttendanceRequest | 'new' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const cancel = useAttendanceAction(
    attendanceApi.cancelRequest,
    '요청을 취소했어요.'
  );

  async function showFile(id: string) {
    const response = await fetchWithRefresh(
      `/api/proxy/file/files/${id}/download?expiresIn=300`
    );

    if (!response.ok) {
      toast.error('이미지를 불러오지 못했어요.');

      return;
    }

    const data = await response.json();

    setPreview(data.signedUrl);
  }

  return (
    <section className="min-w-0 space-y-6" aria-busy={query.isPending}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {showHeading && (
            <h1 className="text-2xl font-bold">정정 / 예외 요청</h1>
          )}
          <p className="mt-2 text-sm text-slate-400">
            누락된 기록이나 위치 확인 오류를 알려 주세요.
          </p>
        </div>
        <Button className="min-h-11 sm:min-h-9" onClick={() => setForm('new')}>
          요청하기
        </Button>
      </div>
      {query.isError && (
        <p role="alert" className="text-sm text-red-600">
          요청을 불러오지 못했어요.{' '}
          <button onClick={() => query.refetch()} className="underline">
            다시 시도
          </button>
        </p>
      )}
      {query.isPending && (
        <>
          <p role="status" className="sr-only">
            요청을 불러오고 있어요.
          </p>
          {Array.from({ length: 2 }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="min-w-0 space-y-4 rounded-2xl border bg-white p-4 sm:p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Skeleton className="h-6 w-32 motion-reduce:animate-none" />
                <Skeleton className="h-6 w-20 rounded-full motion-reduce:animate-none" />
              </div>
              <Skeleton className="h-5 w-56 max-w-full motion-reduce:animate-none" />

              <div className="space-y-2 py-1">
                <Skeleton className="h-5 w-full motion-reduce:animate-none" />
                <Skeleton className="h-5 w-3/4 motion-reduce:animate-none" />
              </div>

              <Skeleton className="h-11 w-24 motion-reduce:animate-none" />
              <div className="border-t pt-3">
                <Skeleton className="h-11 w-20 motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </>
      )}
      {query.data?.map((request) => (
        <article
          key={request.id}
          className="min-w-0 space-y-4 rounded-2xl border bg-white p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="min-w-0 break-words font-semibold">
              {request.workDate}
            </h2>
            <span className="rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-500">
              {labels[request.status]}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            요청 출근 {formatAttendanceTime(request.checkIn)} / 퇴근{' '}
            {formatAttendanceTime(request.checkOut)}
          </p>

          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {request.reason}
          </p>
          {!!request.fileIds.length && (
            <div className="flex flex-wrap gap-2">
              {request.fileIds.map((id, index) => (
                <Button
                  key={id}
                  size="sm"
                  className="min-h-11 sm:min-h-8"
                  variant="outline"
                  onClick={() => showFile(id)}
                >
                  참고 이미지 {index + 1}
                </Button>
              ))}
            </div>
          )}
          {request.decisionReason && (
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="mb-1 text-xs text-slate-400">담당자 답변</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {request.decisionReason}
              </p>
            </div>
          )}

          {request.status === 'needs_information' && (
            <Button
              className="min-h-11 sm:min-h-9"
              variant="outline"
              onClick={() => setForm(request)}
            >
              보완해서 다시 요청
            </Button>
          )}
          {['pending', 'needs_information'].includes(request.status) && (
            <Button
              size="sm"
              className="min-h-11 sm:min-h-8"
              variant="ghost"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate({ id: request.id, version: request.version })
              }
            >
              요청 취소
            </Button>
          )}
          <RequestHistory requestId={request.id} />
        </article>
      ))}
      {query.isSuccess && !query.data.length && (
        <p className="rounded-xl border bg-white p-10 text-center text-sm text-slate-400">
          아직 요청이 없어요.
        </p>
      )}
      {form && (
        <CorrectionForm
          existing={form === 'new' ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-4 sm:p-6 [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center">
          <DialogHeader className="pr-10">
            <DialogTitle>참고 이미지</DialogTitle>
          </DialogHeader>
          {preview && (
            <Image
              unoptimized
              src={preview}
              width={1000}
              height={1000}
              className="max-h-[70dvh] w-full object-contain"
              alt="출결 요청에 첨부한 참고 이미지"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function localInput(instant: string | null | undefined): string {
  return instant
    ? new Date(new Date(instant).getTime() + 9 * 3600000)
        .toISOString()
        .slice(0, 16)
    : '';
}

function CorrectionDateField({
  label,
  displayLabel,
  value,
  onChange,
  required = false,
  disabled = false,
}: {
  label: string;
  displayLabel?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const pickerRef = useRef<HTMLInputElement>(null);
  const dateLabel = value
    ? value.split('-').map(Number).join('. ') + '.'
    : '날짜 선택';

  function openPicker() {
    const picker = pickerRef.current;

    if (!picker || disabled) {
      return;
    }

    try {
      if (picker.showPicker) {
        picker.showPicker();

        return;
      }
    } catch {
      // Older mobile browsers use the native input click instead.
    }

    picker.focus();
    picker.click();
  }

  return (
    <div className="group relative h-16 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-input bg-white shadow-xs focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-200">
      <button
        type="button"
        aria-label={label}
        aria-describedby={`${id}-value`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={openPicker}
        className="relative flex h-full w-full min-w-0 items-end px-3 pt-6 pr-9 pb-2.5 text-left text-sm outline-none disabled:opacity-50"
      >
        <span className="pointer-events-none absolute top-2.5 left-3 text-xs text-slate-500">
          {displayLabel ?? label}
        </span>
        <span id={`${id}-value`} className="min-w-0 truncate tabular-nums">
          {dateLabel}
        </span>
        <CalendarDays
          className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
      </button>
      <input
        ref={pickerRef}
        id={id}
        aria-label={`${label} 직접 선택`}
        type="date"
        tabIndex={-1}
        className="absolute inset-0 h-full w-full min-w-0 max-w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function correctionTimestamp(
  date: string,
  time: string,
  fallbackDate: string
): string {
  if (!time) {
    return '';
  }

  return `${date || fallbackDate}T${time}`;
}

export function CorrectionDateTimeFields({
  label,
  value,
  fallbackDate,
  onChange,
}: {
  label: string;
  value: string;
  fallbackDate: string;
  onChange: (value: string) => void;
}) {
  const [dateDraft, setDateDraft] = useState('');
  const [savedDate, time = ''] = value.split('T');
  const date = savedDate || dateDraft || fallbackDate;

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="grid min-w-0 grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3">
        <CorrectionDateField
          label={`${label} 날짜`}
          displayLabel="날짜"
          value={date}
          onChange={(next) => {
            setDateDraft(next);

            if (time) {
              onChange(
                next ? correctionTimestamp(next, time, fallbackDate) : ''
              );
            }
          }}
        />
        <AttendanceTimeField
          label={`${label} 시각`}
          displayLabel="시각"
          value={time}
          clearable
          onChange={(next) => {
            if (!next) {
              setDateDraft('');
            }

            onChange(correctionTimestamp(date, next, fallbackDate));
          }}
        />
      </div>
    </div>
  );
}

function CorrectionForm({
  existing,
  onClose,
}: {
  existing?: AttendanceRequest;
  onClose: () => void;
}) {
  const form = useForm<CorrectionFormValues>({
    resolver: zodResolver(correctionFormSchema),
    defaultValues: {
      day: existing?.workDate ?? seoulDate(new Date()),
      checkIn: localInput(existing?.checkIn),
      checkOut: localInput(existing?.checkOut),
      reason: existing?.reason ?? '',
    },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });
  const { field: dayField } = useController({
    name: 'day',
    control: form.control,
  });
  const { field: checkInField } = useController({
    name: 'checkIn',
    control: form.control,
  });
  const { field: checkOutField } = useController({
    name: 'checkOut',
    control: form.control,
  });
  const reason = useWatch({ name: 'reason', control: form.control });
  const { errors, isSubmitting } = form.formState;
  const formRef = useRef<HTMLFormElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [example, setExample] = useState(false);
  const [retained, setRetained] = useState(existing?.fileIds ?? []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const submitLock = useRef(false);
  const thumbnails = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files]
  );

  useEffect(
    () => () => thumbnails.forEach((url) => URL.revokeObjectURL(url)),
    [thumbnails]
  );

  const mutation = useAttendanceAction(async (values: CorrectionFormValues) => {
    const uploaded: string[] = [];

    for (const file of files) {
      const result = await uploadFileToFileService(file, {
        contextId: 'attendance-request-image',
        isPublic: false,
      });

      uploaded.push(result.id);
    }

    const body: CorrectionInput = {
      workDate: values.day,
      checkIn: values.checkIn
        ? new Date(values.checkIn + ':00+09:00').toISOString()
        : undefined,
      checkOut: values.checkOut
        ? new Date(values.checkOut + ':00+09:00').toISOString()
        : undefined,
      reason: values.reason,
      fileIds: [...retained, ...uploaded],
    };

    return existing
      ? attendanceApi.resubmit(existing.id, body)
      : attendanceApi.createRequest(body);
  }, '요청을 접수했어요.');

  function changeTime(name: 'checkIn' | 'checkOut', value: string) {
    form.setValue(name, value, { shouldDirty: true });

    if (form.formState.isSubmitted) {
      void form.trigger(['checkIn', 'checkOut']);
    }
  }

  function addFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);

    if (
      chosen.some(
        (file) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          file.size > 10 * 1024 * 1024
      )
    ) {
      toast.error('장당 10MB 이하의 JPG, PNG, WEBP 이미지를 첨부해 주세요.');
    } else if (chosen.length + files.length + retained.length > 3) {
      toast.error('최대 3장까지 첨부할 수 있어요.');
    } else {
      setFiles((current) => [...current, ...chosen]);
    }

    event.target.value = '';
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitLock.current && !mutation.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (submitLock.current) {
            event.preventDefault();
          }
        }}
        className="inset-x-0 top-auto bottom-0 left-0 flex h-dvh max-h-dvh w-full min-w-0 max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
      >
        <DialogHeader className="w-full min-w-0 shrink-0 px-3 pt-[env(safe-area-inset-top)] sm:px-4">
          <div className="grid min-h-16 grid-cols-[56px_minmax(0,1fr)_56px] items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11 rounded-full"
              aria-label="정정 요청 창 닫기"
              disabled={mutation.isPending}
              onClick={() => {
                if (!submitLock.current) {
                  onClose();
                }
              }}
            >
              <X className="size-5" aria-hidden />
            </Button>
            <DialogTitle
              ref={titleRef}
              tabIndex={-1}
              className="text-center text-base outline-none"
            >
              정정 / 예외 요청
            </DialogTitle>
            <Button
              type="submit"
              form="correction-form"
              variant="ghost"
              className="h-11 px-2 text-base font-semibold text-indigo-600"
              disabled={mutation.isPending || isSubmitting}
            >
              {mutation.isPending ? '접수 중' : '요청'}
            </Button>
          </div>
          <DialogDescription className="sr-only">
            수정할 출퇴근 시각과 사유를 입력해 주세요.
          </DialogDescription>
        </DialogHeader>
        <form
          id="correction-form"
          className="min-h-0 w-full min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 pt-2 pb-[max(24px,env(safe-area-inset-bottom))] sm:flex-initial sm:px-6"
          ref={formRef}
          noValidate
          onSubmit={form.handleSubmit(
            async (values) => {
              if (submitLock.current || mutation.isPending) {
                return;
              }

              submitLock.current = true;

              try {
                await mutation.mutateAsync(values);
                onClose();
              } catch {
                // The mutation shows the server error and retains the user's input.
              } finally {
                submitLock.current = false;
              }
            },
            (invalidFields) => {
              const first = (
                ['day', 'checkIn', 'checkOut', 'reason'] as const
              ).find((name) => invalidFields[name]);
              const section =
                first &&
                formRef.current?.querySelector<HTMLElement>(
                  `[data-correction-field="${first}"]`
                );
              const selector =
                first === 'checkIn' || first === 'checkOut'
                  ? 'button[aria-label$="시각"]'
                  : 'button:not(:disabled), textarea, input:not(:disabled)';
              const control = section?.querySelector<HTMLElement>(selector);

              section?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              control?.focus({ preventScroll: true });
            }
          )}
        >
          <fieldset
            disabled={mutation.isPending}
            className="m-0 w-full min-w-0 max-w-full space-y-5 border-0 p-0"
          >
            <div data-correction-field="day">
              <CorrectionDateField
                label="근무일"
                required
                value={dayField.value}
                disabled={!!existing}
                onChange={dayField.onChange}
              />
              {errors.day && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  {errors.day.message}
                </p>
              )}
            </div>
            <div className="space-y-4">
              <div data-correction-field="checkIn">
                <CorrectionDateTimeFields
                  label="실제 출근"
                  value={checkInField.value}
                  fallbackDate={dayField.value}
                  onChange={(value) => changeTime('checkIn', value)}
                />
                {errors.checkIn && (
                  <p role="alert" className="mt-2 text-sm text-red-600">
                    {errors.checkIn.message}
                  </p>
                )}
              </div>
              <div data-correction-field="checkOut">
                <CorrectionDateTimeFields
                  label="실제 퇴근"
                  value={checkOutField.value}
                  fallbackDate={dayField.value}
                  onChange={(value) => changeTime('checkOut', value)}
                />
                {errors.checkOut && (
                  <p role="alert" className="mt-2 text-sm text-red-600">
                    {errors.checkOut.message}
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs leading-6 text-slate-500">
              수정할 시각만 선택하세요. 다음 날 퇴근했다면 날짜도 바꿔 주세요.
            </p>
            <div className="space-y-2" data-correction-field="reason">
              <label className="group relative block">
                <span
                  className={`pointer-events-none absolute left-3 z-10 text-slate-500 transition-all group-focus-within:top-3 group-focus-within:text-xs group-focus-within:text-indigo-600 motion-reduce:transition-none ${reason ? 'top-3 text-xs' : 'top-4 text-base'}`}
                >
                  상세 사유
                </span>
                <Textarea
                  aria-label="상세 사유"
                  aria-describedby="correction-reason-help correction-reason-error"
                  aria-invalid={!!errors.reason}
                  required
                  maxLength={5000}
                  rows={3}
                  className="min-h-28 w-full min-w-0 max-w-full resize-none rounded-xl bg-white pt-9 text-base"
                  {...form.register('reason')}
                />
              </label>
              {errors.reason && (
                <p
                  id="correction-reason-error"
                  role="alert"
                  className="text-sm text-red-600"
                >
                  {errors.reason.message}
                </p>
              )}
              <p
                id="correction-reason-help"
                className="text-xs leading-6 text-slate-500"
              >
                기록을 수정해야 하는 상황을 적어 주세요.
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">
                  참고 이미지 <span className="ml-1 text-slate-400">선택</span>
                </p>
                <button
                  type="button"
                  className="min-h-11 text-xs text-indigo-600"
                  onClick={() => setExample(true)}
                >
                  예시 보기 ›
                </button>
              </div>

              <div className="flex min-w-0 flex-wrap gap-3 pt-2">
                {retained.map((id, index) => (
                  <button
                    type="button"
                    key={id}
                    className="rounded-lg border p-3 text-xs"
                    onClick={() =>
                      setRetained((current) =>
                        current.filter((value) => value !== id)
                      )
                    }
                  >
                    기존 이미지 {index + 1} ×
                  </button>
                ))}
                {thumbnails.map((url, index) => (
                  <div key={url} className="relative">
                    <Image
                      unoptimized
                      src={url}
                      width={80}
                      height={80}
                      className="size-20 rounded-lg object-cover"
                      alt={`첨부 ${index + 1}`}
                    />
                    <button
                      type="button"
                      aria-label={`첨부 ${index + 1} 제거`}
                      className="absolute -top-2 -right-2 flex size-11 items-center justify-center rounded-full bg-white shadow"
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, i) => i !== index)
                        )
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {files.length + retained.length < 3 && (
                  <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-200 text-xs text-indigo-500">
                    <Plus className="size-4" />
                    이미지 추가
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="sr-only"
                      onChange={addFiles}
                    />
                  </label>
                )}
              </div>
              <p className="mt-3 text-[11px] text-slate-400">
                최대 3장 · 장당 10MB · JPG, PNG, WEBP
              </p>
            </div>
            <p className="pt-1 text-xs text-slate-400">
              담당자 승인 후 기록에 반영돼요.
            </p>
          </fieldset>
        </form>
      </DialogContent>
      <Dialog open={example} onOpenChange={setExample}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto p-4 sm:p-6 [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center">
          <DialogHeader className="pr-10">
            <DialogTitle>이렇게 찍어 주세요</DialogTitle>
            <DialogDescription>
              사진을 첨부한다면 얼굴과 근무 공간이 함께 보이도록 찍어 주세요.
              오류 화면도 괜찮아요.
            </DialogDescription>
          </DialogHeader>
          <div className="relative mx-auto aspect-square w-full max-w-[55dvh] overflow-hidden rounded-xl bg-slate-100">
            <Image
              src="/pwa-attendance/photo-example-portrait.webp"
              placeholder="blur"
              blurDataURL={PHOTO_EXAMPLE_BLUR_DATA_URL}
              fill
              sizes="(max-width: 640px) calc(100vw - 4rem), 336px"
              loading="eager"
              alt="가상 인물의 선명한 얼굴과 사무실이 함께 보이는 촬영 구도 예시"
              className="object-cover"
            />
          </div>
          <p className="text-xs text-slate-400">
            AI 가상 인물 · 촬영 구도 예시 · 첨부는 선택이에요.
          </p>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
