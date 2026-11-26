'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCan } from '@/hooks/use-permission';
import { sku3dWorkshopClient } from '@/lib/api/domains/inventory/sku-3d-workshop.client';
import type {
  Sku3dDimensionBasis,
  Sku3dWorkshopDetailDto,
  Sku3dWorkshopEventDto,
  Sku3dWorkshopRevisionDto,
} from '@/lib/types/dto/inventory';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { errorMessageOf } from '../sku-field-capture/field-capture-model';
import { WorkshopModelViewer } from './workshop-model-viewer';
import {
  canRetryCreate,
  canSendMessage,
  chatItems,
  DIMENSION_CHOICES,
  dimensionQuestion,
  elapsedText,
  JOB_STEPS,
  jobStage,
  latestProgressText,
  MATERIAL_CHANGED_REQUEST,
  materialChangeText,
  mergeEvents,
  shortHash,
  VERDICT_LABEL,
  viewerRevision,
  workerStatusText,
  workshopKeys,
  workshopStatusText,
} from './workshop-model';

const EVENTS_POLL_MS = 2_000;

export function WorkshopView({
  detail,
  skuId,
  fetchedAt,
}: {
  detail: Sku3dWorkshopDetailDto;
  skuId: string;
  fetchedAt: number;
}): JSX.Element {
  const queryClient = useQueryClient();
  const workshopId = detail.workshop.id;
  const canWrite = useCan(['inventory.model_workshop.write']);
  const canPublish = useCan(['inventory.model_workshop.publish']);
  const writeAllowed = canWrite.status === 'ready' && canWrite.allowed;
  const publishAllowed =
    writeAllowed && canPublish.status === 'ready' && canPublish.allowed;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [approving, setApproving] = useState<Sku3dWorkshopRevisionDto | null>(
    null
  );
  const shown = viewerRevision(detail.revisions, selectedId);
  const compared = compareId
    ? (detail.revisions.find((r) => r.id === compareId) ?? null)
    : null;
  const refreshDetail = () =>
    queryClient.invalidateQueries({ queryKey: workshopKeys.detail(skuId) });

  const now = useNow(1_000);
  const events = useWorkshopEvents(workshopId, refreshDetail);

  const confirm = useMutation({
    mutationFn: (basis: Sku3dDimensionBasis) =>
      sku3dWorkshopClient.confirmDimensions(workshopId, basis),
    meta: { permission: ['inventory.model_workshop.write'] },
    onSuccess: refreshDetail,
    onError: (error) =>
      toast.error(errorMessageOf(error, '치수 기준을 저장하지 못했어요')),
  });

  const send = useMutation({
    mutationFn: (body: string) =>
      sku3dWorkshopClient.postMessage(workshopId, body),
    meta: { permission: ['inventory.model_workshop.write'] },
    onSuccess: async () => {
      setDraft('');
      setSelectedId(null);
      await refreshDetail();
    },
    onError: (error) => toast.error(errorMessageOf(error, '보내지 못했어요')),
  });

  const approve = useMutation({
    mutationFn: (revision: Sku3dWorkshopRevisionDto) =>
      sku3dWorkshopClient.approve(workshopId, revision.id, revision.glbSha256),
    meta: {
      permission: {
        allOf: [
          ['inventory.model_workshop.write'],
          ['inventory.model_workshop.publish'],
        ],
      },
    },
    onSuccess: async (_result, revision) => {
      setApproving(null);
      await refreshDetail();
      toast.success(`v${revision.number} 를 쇼핑몰에 공개했어요`);
    },
    onError: (error) =>
      toast.error(
        errorMessageOf(error, '반영하지 못했어요. 다시 눌러도 한 번만 반영돼요')
      ),
  });

  const status = workshopStatusText(detail);
  const question = dimensionQuestion(detail);

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-gray-900">{detail.sku.name}</h2>
        <p className="text-xs text-gray-500">{detail.sku.code}</p>
        <p
          className={`text-xs font-semibold ${detail.worker.online ? 'text-green-700' : 'text-gray-500'}`}
        >
          {workerStatusText(detail.worker, now - fetchedAt)}
        </p>
      </div>

      {question && (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">{question}</p>
          {DIMENSION_CHOICES.map((choice) => (
            <button
              key={choice.basis}
              type="button"
              disabled={!writeAllowed || confirm.isPending}
              onClick={() => confirm.mutate(choice.basis)}
              className="w-full rounded-lg border border-gray-300 px-3 py-3 text-left text-sm text-gray-800 disabled:opacity-50"
            >
              {choice.label}
            </button>
          ))}
          <p className="text-xs text-gray-500">고르면 바로 제작을 요청해요</p>
        </section>
      )}

      {canRetryCreate(detail) && (
        <button
          type="button"
          disabled={!writeAllowed || confirm.isPending}
          onClick={() => confirm.mutate(detail.workshop.dimensionBasis)}
          className="w-full rounded-lg border border-gray-300 py-3 text-sm font-medium text-gray-800 disabled:opacity-50"
        >
          다시 만들기
        </button>
      )}

      {materialChangeText(detail.materialChanges) && !detail.activeJob && (
        <section className="space-y-2 rounded-xl border border-gray-300 bg-gray-50 p-4">
          <p className="text-sm font-semibold text-gray-900">
            {materialChangeText(detail.materialChanges)}
          </p>
          <button
            type="button"
            disabled={!writeAllowed || send.isPending}
            onClick={() => send.mutate(MATERIAL_CHANGED_REQUEST)}
            className="w-full rounded-lg bg-gray-900 py-3 text-sm font-bold text-white disabled:bg-gray-300"
          >
            바뀐 자료로 다시 만들기
          </button>
          <p className="text-xs text-gray-500">
            같은 Codex 세션으로 새 버전을 만들어요. 지금 버전은 그대로 남아요
          </p>
        </section>
      )}

      {detail.activeJob && (
        <JobProgressCard
          detail={detail}
          events={events}
          now={now}
          offlineText={detail.worker.online ? null : status}
        />
      )}

      <section className="space-y-3">
        {shown ? (
          <>
            <WorkshopModelViewer
              key={shown.id}
              src={sku3dWorkshopClient.fileUrl(workshopId, shown.id, 'glb')}
              title={`${detail.sku.name} v${shown.number}`}
            />
            <RevisionSummary revision={shown} />
          </>
        ) : (
          <p className="rounded-xl bg-gray-100 p-6 text-center text-sm text-gray-600">
            아직 만든 모델이 없어요
          </p>
        )}

        {detail.revisions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {detail.revisions.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`rounded-full border px-3 py-1 text-sm ${r.id === shown?.id ? 'border-gray-900 font-bold text-gray-900' : 'border-gray-300 text-gray-700'}`}
              >
                v{r.number}
                {r.publishedAt ? ' · 공개함' : ''}
              </button>
            ))}
          </div>
        )}

        {detail.revisions.length > 1 && shown && (
          <div className="space-y-2">
            <select
              value={compareId ?? ''}
              onChange={(e) => setCompareId(e.target.value || null)}
              className="h-10 w-full rounded-lg border border-gray-300 px-2 text-sm"
              aria-label="비교할 버전"
            >
              <option value="">다른 버전과 비교하기</option>
              {detail.revisions
                .filter((r) => r.id !== shown.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    v{r.number}
                  </option>
                ))}
            </select>
            {compared && (
              <>
                <WorkshopModelViewer
                  key={`compare-${compared.id}`}
                  src={sku3dWorkshopClient.fileUrl(
                    workshopId,
                    compared.id,
                    'glb'
                  )}
                  title={`${detail.sku.name} v${compared.number}`}
                />
                <RevisionSummary revision={compared} />
              </>
            )}
          </div>
        )}

        {shown && (
          <button
            type="button"
            disabled={
              !publishAllowed || shown.publishedAt !== null || approve.isPending
            }
            onClick={() => setApproving(shown)}
            className="w-full rounded-xl bg-blue-600 py-4 text-base font-bold text-white disabled:bg-gray-300"
          >
            {shown.publishedAt
              ? `v${shown.number} 공개함`
              : `v${shown.number} 승인하고 아몬드영에 반영`}
          </button>
        )}
        {shown && !publishAllowed && canPublish.status === 'ready' && (
          <p className="text-xs text-gray-500">
            쇼핑몰 반영은 3D 모델 공개 권한이 있어야 해요
          </p>
        )}
      </section>

      {shown && shown.files.renders.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-800">렌더 이미지</h3>
          <div className="grid grid-cols-3 gap-2">
            {shown.files.renders.map((_id, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${shown.id}-${i}`}
                src={sku3dWorkshopClient.fileUrl(
                  workshopId,
                  shown.id,
                  `render-${i}`
                )}
                alt={`v${shown.number} 렌더 ${i + 1}`}
                loading="lazy"
                className="aspect-square w-full rounded-lg bg-[#c6c6c6] object-cover"
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">
            원본 사진·실측값
          </h3>
          <Link
            href={`/mobile/sku-field-capture/${encodeURIComponent(skuId)}?back=${encodeURIComponent(`/mobile/sku-3d-workshop/${skuId}`)}`}
            className="text-sm font-medium text-gray-700 underline underline-offset-2"
          >
            실측 상세
          </Link>
        </div>
        <p className="text-sm text-gray-700">
          포장째 {detail.sku.packageWidthMm ?? '?'}×
          {detail.sku.packageLengthMm ?? '?'}×
          {detail.sku.packageHeightMm ?? '?'}mm ·{' '}
          {detail.sku.packageWeightG ?? '?'}g
        </p>
        <div className="grid grid-cols-3 gap-2">
          {detail.sku.photos.map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.fileId}
              src={resolvePublicFileUrl(photo.fileId) ?? ''}
              alt={`원본 사진 ${photo.sortOrder}`}
              loading="lazy"
              className="aspect-square w-full rounded-lg object-cover"
            />
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">대화</h3>
        <ChatList events={events} />
        <label htmlFor="workshop-message" className="sr-only">
          수정 요청
        </label>
        <textarea
          id="workshop-message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder={
            canSendMessage(detail)
              ? '예: 뚜껑을 둥글게 해줘'
              : '모델이 나오면 고칠 점을 보낼 수 있어요'
          }
          disabled={!writeAllowed || !canSendMessage(detail) || send.isPending}
          className="w-full rounded-lg border border-gray-300 p-3 text-base disabled:bg-gray-50"
        />
        <button
          type="button"
          disabled={
            !writeAllowed ||
            !canSendMessage(detail) ||
            send.isPending ||
            draft.trim() === ''
          }
          onClick={() => send.mutate(draft.trim())}
          className="w-full rounded-lg bg-gray-900 py-3 text-sm font-bold text-white disabled:bg-gray-300"
        >
          수정 요청 보내기
        </button>
      </section>

      <AlertDialog
        open={approving !== null}
        onOpenChange={(open) => !open && setApproving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              v{approving?.number} 를 쇼핑몰에 공개할까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              지금 보고 있는 이 버전(파일{' '}
              {approving ? shortHash(approving.glbSha256) : ''})만 공개돼요.
              지금 공개 중인 모델은 이 버전으로 바뀌어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approve.isPending}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={approve.isPending}
              onClick={(event) => {
                event.preventDefault();

                if (approving) {
                  approve.mutate(approving);
                }
              }}
            >
              {approve.isPending ? '반영하는 중' : '공개하기'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// 받은 마지막 seq 다음부터 2초마다 받는다 — 새로고침·재접속하면 처음부터 다시 받아 놓친 것도 채운다
function useWorkshopEvents(
  workshopId: string,
  onNews: () => void
): Sku3dWorkshopEventDto[] {
  const [events, setEvents] = useState<Sku3dWorkshopEventDto[]>([]);
  const cursor = useRef(0);
  const handled = useRef<unknown>(null);
  const { data } = useQuery({
    queryKey: workshopKeys.events(workshopId),
    queryFn: () => sku3dWorkshopClient.events(workshopId, cursor.current),
    // 증분 응답을 캐시에 남기면 다시 들어왔을 때 처음부터 받지 않고 건너뛴다
    staleTime: 0,
    gcTime: 0,
    refetchInterval: EVENTS_POLL_MS,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    // 같은 응답을 두 번 처리하지 않는다 — 렌더가 다시 돌아도 상세를 거듭 새로 받지 않게
    if (!data || data === handled.current || data.events.length === 0) {
      return;
    }

    handled.current = data;

    cursor.current = Math.max(cursor.current, ...data.events.map((e) => e.seq));
    setEvents((previous) => mergeEvents(previous, data.events));

    if (data.events.some((e) => e.type !== 'progress')) {
      onNews();
    }
  }, [data, onNews]);

  return events;
}

// 만드는 동안 화면이 멈춰 보이지 않게 — 단계, 경과 시간, Codex 가 방금 남긴 말
function JobProgressCard({
  detail,
  events,
  now,
  offlineText,
}: {
  detail: Sku3dWorkshopDetailDto;
  events: Sku3dWorkshopEventDto[];
  now: number;
  offlineText: string | null;
}): JSX.Element | null {
  const job = detail.activeJob;
  const stage = jobStage(job, events);

  if (!job || !stage) {
    return null;
  }

  const latest = latestProgressText(job, events);

  return (
    <section
      className="sticky top-0 z-10 space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <Loader2 className="h-4 w-4 animate-spin" />
          {offlineText ?? stage.label}
        </p>
        <p className="text-xs tabular-nums text-gray-500">
          {elapsedText(job.startedAt ?? job.createdAt, now)}
        </p>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-label={stage.label}
      >
        <div className="h-full w-full animate-pulse rounded-full bg-gray-700" />
      </div>
      <ol className="flex justify-between text-xs">
        {JOB_STEPS.map((label, i) => (
          <li
            key={label}
            className={
              i + 1 <= stage.step
                ? 'font-semibold text-gray-900'
                : 'text-gray-400'
            }
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {latest && <p className="line-clamp-3 text-sm text-gray-700">{latest}</p>}
      <p className="text-xs text-gray-500">
        보통 15~25분 걸려요. 화면을 닫아도 계속 만들고, 다시 들어오면 이어서
        보여요
        {job.attempts > 1 ? ` · ${job.attempts}번째 시도` : ''}
      </p>
    </section>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function ChatList({
  events,
}: {
  events: Sku3dWorkshopEventDto[];
}): JSX.Element {
  const items = chatItems(events);

  if (items.length === 0) {
    return <p className="text-sm text-gray-500">아직 대화가 없어요</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((e) => (
        <li
          key={e.seq}
          className={
            e.type === 'user_message'
              ? 'flex justify-end'
              : 'flex justify-start'
          }
        >
          {e.type === 'progress' || e.type === 'status' ? (
            <p className="text-xs text-gray-500">{e.body}</p>
          ) : (
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${e.type === 'user_message' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'}`}
            >
              {e.body}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function RevisionSummary({
  revision,
}: {
  revision: Sku3dWorkshopRevisionDto;
}): JSX.Element {
  const review = revision.review;
  const lists: [string, string[]][] = [
    [
      '남은 문제',
      review.issues.map((i) => `${i.where}: ${i.observed} → ${i.expected}`),
    ],
    ['사진에 안 보인 면', review.unseenFaces],
    ['추정한 부분', review.assumptions],
    ['더 찍으면 좋은 사진', review.needsPhotos],
  ];

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">
        v{revision.number} · {VERDICT_LABEL[review.verdict]}
      </p>
      <p className="whitespace-pre-wrap text-sm text-gray-800">
        {review.summary}
      </p>
      <p className="text-xs text-gray-500">
        쓴 치수 {review.dimensionsUsed.widthMm}×{review.dimensionsUsed.lengthMm}
        ×{review.dimensionsUsed.heightMm}mm ({review.dimensionsUsed.basis}) ·{' '}
        {(revision.glbBytes / 1024 / 1024).toFixed(2)}MB · AI 검토는
        참고용이에요. 공개는 사람이 정해요
      </p>
      {lists
        .filter(([, items]) => items.length > 0)
        .map(([title, items]) => (
          <details key={title} className="text-sm text-gray-700">
            <summary className="cursor-pointer">
              {title} {items.length}
            </summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ))}
    </div>
  );
}
