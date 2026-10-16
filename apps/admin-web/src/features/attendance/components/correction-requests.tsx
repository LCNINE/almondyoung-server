'use client';

import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import {
  ATTENDANCE_KEY,
  useAttendance,
  useAttendanceAction,
} from '../hooks/use-attendance';
import { formatAttendanceTime } from '../lib/attendance-model';
import {
  seoulDate,
  type AttendanceRequest,
  type RequestStatus,
} from '@packages/domain-types/attendance';
import { toast } from 'sonner';

const labels: Record<RequestStatus, string> = {
  pending: '검토 중',
  needs_information: '추가 확인',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
};

export function CorrectionRequests({ review = false }: { review?: boolean }) {
  const { data: me } = useAttendance();
  const query = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'requests', review],
    queryFn: () => attendanceApi.requests(review),
    enabled: !review || !!me?.isMaster,
  });
  const [form, setForm] = useState<AttendanceRequest | 'new' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const cancel = useAttendanceAction(
    attendanceApi.cancelRequest,
    '요청을 취소했어요.'
  );
  const decide = useAttendanceAction(
    async (input: {
      id: string;
      version: number;
      status: 'approved' | 'rejected' | 'needs_information';
      reason: string;
    }) => {
      const { id, ...body } = input;

      return attendanceApi.decide(id, body);
    },
    '요청을 처리했어요.'
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
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {review ? '출결 요청 검토' : '정정 / 예외 요청'}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {review
              ? '원래 기록과 요청 내용을 확인하고 처리해 주세요.'
              : '누락된 기록이나 위치 확인 오류를 알려 주세요.'}
          </p>
        </div>
        {!review && <Button onClick={() => setForm('new')}>요청하기</Button>}
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
        <p className="py-8 text-sm text-slate-400">요청을 불러오고 있어요.</p>
      )}
      {query.data?.map((request) => (
        <article
          key={request.id}
          className="space-y-4 rounded-2xl border bg-white p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              {review ? `${request.name} · ` : ''}
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
          {review && (
            <div className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-500">
              현재 출근 {formatAttendanceTime(request.original?.checkIn)} / 퇴근{' '}
              {formatAttendanceTime(request.original?.checkOut)}
              {request.original &&
                request.original.version !== request.targetVersion && (
                  <p className="text-amber-700">
                    요청 이후 기록이 변경됐어요. 확인 후 새 요청을 받아 주세요.
                  </p>
                )}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {request.reason}
          </p>
          {!!request.fileIds.length && (
            <div className="flex flex-wrap gap-2">
              {request.fileIds.map((id, index) => (
                <Button
                  key={id}
                  size="sm"
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
              <p className="whitespace-pre-wrap text-sm leading-6">
                {request.decisionReason}
              </p>
            </div>
          )}
          {review && (
            <div className="rounded-xl bg-indigo-50/60 p-4">
              <h3 className="text-xs font-semibold text-indigo-700">
                AI 검토 보조
              </h3>
              {request.aiResult ? (
                <>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {request.aiResult.summary}
                  </p>
                  {request.aiResult.questions.map((question, index) => (
                    <p key={index} className="mt-2 text-xs text-slate-500">
                      · {question}
                    </p>
                  ))}
                </>
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  {request.aiStatus === 'failed'
                    ? 'AI 확인에 실패했어요. 직접 검토할 수 있어요.'
                    : '확인 중이에요. 결과를 기다리지 않고 직접 검토할 수 있어요.'}
                </p>
              )}
            </div>
          )}
          {review && request.status === 'pending' && (
            <DecisionForm
              disabled={decide.isPending}
              onSubmit={(status, reason) =>
                decide.mutate({
                  id: request.id,
                  version: request.version,
                  status,
                  reason,
                })
              }
            />
          )}
          {!review && request.status === 'needs_information' && (
            <Button variant="outline" onClick={() => setForm(request)}>
              보완해서 다시 요청
            </Button>
          )}
          {!review &&
            ['pending', 'needs_information'].includes(request.status) && (
              <Button
                size="sm"
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
        <DialogContent>
          <DialogHeader>
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

function RequestHistory({ requestId }: { requestId: string }) {
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
        className="text-xs text-slate-400"
        onClick={() => setOpen(!open)}
      >
        처리 이력 {open ? '접기' : '보기'}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {query.isPending ? (
            <p className="text-xs text-slate-400">이력을 불러오고 있어요.</p>
          ) : query.isError ? (
            <p className="text-xs text-red-600">이력을 불러오지 못했어요.</p>
          ) : (
            query.data?.map((entry) => (
              <div key={entry.id} className="text-xs leading-6 text-slate-500">
                <p>
                  {names[entry.kind] ?? '기록 변경'} · {entry.actor} ·{' '}
                  {new Date(entry.createdAt).toLocaleString('ko-KR')}
                </p>
                {entry.status && (
                  <p>{labels[entry.status as RequestStatus] ?? entry.status}</p>
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

function DecisionForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (
    status: 'approved' | 'rejected' | 'needs_information',
    reason: string
  ) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-3 border-t pt-4">
      <Textarea
        placeholder="직원에게 전달할 처리 사유"
        aria-label="처리 사유"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled}
          onClick={() => onSubmit('approved', reason)}
        >
          승인 · 기록 반영
        </Button>
        <Button
          variant="outline"
          disabled={disabled || !reason.trim()}
          onClick={() => onSubmit('needs_information', reason)}
        >
          추가 확인
        </Button>
        <Button
          variant="outline"
          disabled={disabled || !reason.trim()}
          onClick={() => onSubmit('rejected', reason)}
        >
          반려
        </Button>
      </div>
    </div>
  );
}

function localInput(instant: string | null | undefined): string {
  return instant
    ? new Date(new Date(instant).getTime() + 9 * 3600000)
        .toISOString()
        .slice(0, 16)
    : '';
}

function CorrectionForm({
  existing,
  onClose,
}: {
  existing?: AttendanceRequest;
  onClose: () => void;
}) {
  const [day, setDay] = useState(existing?.workDate ?? seoulDate(new Date()));
  const [checkIn, setCheckIn] = useState(localInput(existing?.checkIn));
  const [checkOut, setCheckOut] = useState(localInput(existing?.checkOut));
  const [reason, setReason] = useState(existing?.reason ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [example, setExample] = useState(false);
  const [retained, setRetained] = useState(existing?.fileIds ?? []);
  const thumbnails = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files]
  );

  useEffect(
    () => () => thumbnails.forEach((url) => URL.revokeObjectURL(url)),
    [thumbnails]
  );

  const mutation = useAttendanceAction(async () => {
    const uploaded: string[] = [];

    for (const file of files) {
      const result = await uploadFileToFileService(file, {
        contextId: 'attendance-request-image',
        isPublic: false,
      });

      uploaded.push(result.id);
    }

    const body: CorrectionInput = {
      workDate: day,
      checkIn: checkIn
        ? new Date(checkIn + ':00+09:00').toISOString()
        : undefined,
      checkOut: checkOut
        ? new Date(checkOut + ':00+09:00').toISOString()
        : undefined,
      reason,
      fileIds: [...retained, ...uploaded],
    };

    return existing
      ? attendanceApi.resubmit(existing.id, body)
      : attendanceApi.createRequest(body);
  }, '요청을 접수했어요.');

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
    } else setFiles((current) => [...current, ...chosen]);

    event.target.value = '';
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>정정 / 예외 요청</DialogTitle>
          <DialogDescription>
            실제 근무 시각과 상황을 알려 주세요.
          </DialogDescription>
        </DialogHeader>
        <form
          id="correction-form"
          className="space-y-5 overflow-y-auto overscroll-contain px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault();

            void mutation
              .mutateAsync()
              .then(onClose)
              .catch(() => undefined);
          }}
        >
          <label className="block space-y-2 text-xs">
            근무일
            <Input
              required
              type="date"
              value={day}
              disabled={!!existing}
              onChange={(event) => setDay(event.target.value)}
            />
          </label>
          <div className="space-y-4">
            <label className="block space-y-2 text-xs">
              실제 출근 시각
              <Input
                type="datetime-local"
                value={checkIn}
                onChange={(event) => setCheckIn(event.target.value)}
              />
            </label>
            <label className="block space-y-2 text-xs">
              실제 퇴근 시각
              <Input
                type="datetime-local"
                value={checkOut}
                onChange={(event) => setCheckOut(event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs text-slate-400">
            수정할 시각만 입력해 주세요. 다음 날 퇴근했다면 날짜도 바꿔 주세요.
          </p>
          <label className="block space-y-2 text-xs">
            상세 사유
            <Textarea
              required
              maxLength={5000}
              rows={5}
              placeholder="기록을 남기지 못한 상황과 실제 근무 내용을 적어 주세요."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">
                참고 이미지 <span className="ml-1 text-slate-400">선택</span>
              </p>
              <button
                type="button"
                className="text-xs text-indigo-600"
                onClick={() => setExample(true)}
              >
                예시 보기 ›
              </button>
            </div>
            <p className="my-3 text-xs leading-6 text-slate-400">
              상황 확인에 도움이 되는 사진이나 스크린샷을 첨부해 주세요.
              <br />
              첨부하지 않아도 요청할 수 있어요.
            </p>
            <div className="flex flex-wrap gap-3">
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
                    className="absolute -top-1 -right-1 rounded-full bg-white p-1 shadow"
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
        </form>
        <div className="flex shrink-0 items-center justify-between border-t px-6 py-4">
          <span className="text-xs text-slate-400">
            담당자 승인 후 기록에 반영돼요.
          </span>
          <Button
            type="submit"
            form="correction-form"
            disabled={
              mutation.isPending || !reason.trim() || (!checkIn && !checkOut)
            }
          >
            {mutation.isPending ? '접수 중' : '요청하기'}
          </Button>
        </div>
      </DialogContent>
      <Dialog open={example} onOpenChange={setExample}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>이렇게 찍어 주세요</DialogTitle>
            <DialogDescription>
              사진을 첨부한다면 얼굴과 근무 공간이 함께 보이도록 찍어 주세요.
              오류 화면도 괜찮아요.
            </DialogDescription>
          </DialogHeader>
          <Image
            src="/attendance/photo-example.png"
            width={600}
            height={800}
            alt="가상 인물이 얼굴과 사무실을 함께 담은 촬영 구도 예시"
            className="max-h-[55dvh] w-full rounded-xl object-cover"
          />
          <p className="text-xs text-slate-400">
            AI 가상 인물 · 촬영 구도 예시 · 첨부는 선택이에요.
          </p>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
