import type {
  Sku3dDimensionBasis,
  Sku3dReviewVerdict,
  Sku3dWorkshopDetailDto,
  Sku3dWorkshopEventDto,
  Sku3dWorkshopRevisionDto,
} from '@/lib/types/dto/inventory';

export const workshopKeys = {
  detail: (skuId: string) => ['sku-3d-workshop', skuId] as const,
  events: (workshopId: string) =>
    ['sku-3d-workshop', workshopId, 'events'] as const,
};

export const DIMENSION_CHOICES: {
  basis: Sku3dDimensionBasis;
  label: string;
}[] = [
  { basis: 'body', label: '포장과 본체 크기가 같아요' },
  { basis: 'package', label: '본체는 더 작아요. 사진 비율로 맞춰 주세요' },
  { basis: 'unknown', label: '잘 모르겠어요' },
];

export const VERDICT_LABEL: Record<Sku3dReviewVerdict, string> = {
  ready_for_review: '검토 가능',
  needs_revision: '수정 필요',
  needs_photos: '사진 필요',
};

// 고른 버전이 있으면 그것, 없으면 마지막 완성 버전 — 새 버전이 생겨도 고른 버전은 바뀌지 않는다
export function viewerRevision(
  revisions: Sku3dWorkshopRevisionDto[],
  selectedId: string | null
): Sku3dWorkshopRevisionDto | null {
  const selected = revisions.find((r) => r.id === selectedId);

  if (selected) {
    return selected;
  }

  return revisions.reduce<Sku3dWorkshopRevisionDto | null>(
    (latest, r) => (latest === null || r.number > latest.number ? r : latest),
    null
  );
}

export function mergeEvents(
  previous: Sku3dWorkshopEventDto[],
  incoming: Sku3dWorkshopEventDto[]
): Sku3dWorkshopEventDto[] {
  const bySeq = new Map(previous.map((e) => [e.seq, e]));

  for (const e of incoming) {
    bySeq.set(e.seq, e);
  }

  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

// 대화·상태는 전부, 진행 줄은 마지막 몇 개만
export function chatItems(
  events: Sku3dWorkshopEventDto[],
  progressTail = 5
): Sku3dWorkshopEventDto[] {
  const progress = events
    .filter((e) => e.type === 'progress' && !isCommandLine(e))
    .slice(-progressTail);
  const keep = new Set(progress.map((e) => e.seq));

  return events.filter((e) => e.type !== 'progress' || keep.has(e.seq));
}

// 워커가 남기는 명령 실행 줄(실행: ...)은 작업자에게 잡음이다
export function isCommandLine(event: Sku3dWorkshopEventDto): boolean {
  return event.type === 'progress' && event.body.startsWith('실행:');
}

export type JobStage = { step: 1 | 2 | 3; label: string };

export const JOB_STEPS = [
  '순서 대기',
  '작업 PC 가 가져감',
  '만드는 중',
] as const;

// 진행률은 알 수 없다 — 작업 상태와 진행 이벤트로 단계만 보여 준다
export function jobStage(
  job: Sku3dWorkshopDetailDto['activeJob'],
  events: Sku3dWorkshopEventDto[]
): JobStage | null {
  if (!job) {
    return null;
  }

  if (job.status === 'queued') {
    return { step: 1, label: '순서를 기다리고 있어요' };
  }

  const started = events.some(
    (e) => e.jobId === job.id && e.type === 'progress'
  );

  return started
    ? {
        step: 3,
        label: job.kind === 'create' ? '만들고 있어요' : '고치고 있어요',
      }
    : { step: 2, label: '작업 PC 가 준비하고 있어요' };
}

// Codex 가 사람 말로 남긴 마지막 진행 한 줄
export function latestProgressText(
  job: Sku3dWorkshopDetailDto['activeJob'],
  events: Sku3dWorkshopEventDto[]
): string | null {
  if (!job) {
    return null;
  }

  const latest = events
    .filter(
      (e) =>
        e.jobId === job.id &&
        (e.type === 'progress' || e.type === 'status') &&
        !isCommandLine(e)
    )
    .at(-1);

  return latest?.body ?? null;
}

export function elapsedText(fromIso: string, nowMs: number): string {
  const seconds = Math.max(
    0,
    Math.floor((nowMs - new Date(fromIso).getTime()) / 1000)
  );
  const minutes = Math.floor(seconds / 60);

  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// 서버가 60초 안에 워커를 봤다는 응답이라도, 그 응답이 오래됐으면 연결됐다고 말하지 않는다
export const STATUS_FRESH_MS = 30_000;

export function workerStatusText(
  worker: Sku3dWorkshopDetailDto['worker'],
  fetchedAgoMs = 0
): string {
  if (fetchedAgoMs > STATUS_FRESH_MS) {
    return '작업 PC 상태를 확인하고 있어요';
  }

  if (worker.online) {
    return '작업 PC 연결됨';
  }

  if (!worker.lastSeenAt) {
    return '작업 PC 가 아직 연결된 적이 없어요';
  }

  return '작업 PC 가 꺼져 있어요';
}

export function workshopStatusText(detail: Sku3dWorkshopDetailDto): string {
  const job = detail.activeJob;

  if (!job) {
    return '';
  }

  if (!detail.worker.online) {
    return '작업 PC 가 꺼져 있어요. 요청은 대기열에 남아요';
  }

  if (job.status === 'queued') {
    return '순서를 기다리고 있어요';
  }

  return job.kind === 'create' ? '만들고 있어요' : '고치고 있어요';
}

export function dimensionQuestion(
  detail: Sku3dWorkshopDetailDto
): string | null {
  if (detail.workshop.dimensionConfirmedAt) {
    return null;
  }

  const {
    packageWidthMm: w,
    packageLengthMm: l,
    packageHeightMm: h,
  } = detail.sku;

  return `실측값 ${w ?? '?'}×${l ?? '?'}×${h ?? '?'}mm 는 포장째 크기예요. 본체도 같은 크기인가요?`;
}

export function canSendMessage(detail: Sku3dWorkshopDetailDto): boolean {
  return detail.revisions.length > 0 && detail.activeJob === null;
}

export function shortHash(sha256: string): string {
  return sha256.slice(0, 8);
}

// 첫 제작이 실패해 버전도 진행 작업도 없으면 다시 만들 수 있다
export function canRetryCreate(detail: Sku3dWorkshopDetailDto): boolean {
  return (
    detail.workshop.dimensionConfirmedAt !== null &&
    detail.revisions.length === 0 &&
    detail.activeJob === null
  );
}

// 실측·작업 기록·사진 모아보기에서 온 내부 경로만 뒤로 가기로 받는다
export function safeBackHref(back: string | null, fallback: string): string {
  if (
    !back ||
    back.includes('//') ||
    !/^\/(mobile|inventory)\/[A-Za-z0-9\-_/?=&%.]*$/.test(back)
  ) {
    return fallback;
  }

  return back;
}

export const MATERIAL_CHANGED_REQUEST =
  '실측 사진·치수가 바뀌었어요. 바뀐 자료에 맞춰 다시 만들어 주세요';

// 마지막 버전 뒤에 바뀐 실측 자료를 한 줄로
export function materialChangeText(
  changes: Sku3dWorkshopDetailDto['materialChanges']
): string | null {
  if (!changes) {
    return null;
  }

  const parts = [
    changes.addedPhotos.length > 0
      ? `사진 ${changes.addedPhotos.length}장 추가`
      : null,
    changes.removedPhotos.length > 0
      ? `사진 ${changes.removedPhotos.length}장 삭제`
      : null,
    changes.dimensions ? '치수 변경' : null,
  ].filter(Boolean);

  return `마지막 버전을 만든 뒤 실측 자료가 바뀌었어요 (${parts.join(', ')})`;
}
