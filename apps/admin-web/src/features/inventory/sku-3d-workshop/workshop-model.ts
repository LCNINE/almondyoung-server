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
    .filter((e) => e.type === 'progress')
    .slice(-progressTail);
  const keep = new Set(progress.map((e) => e.seq));

  return events.filter((e) => e.type !== 'progress' || keep.has(e.seq));
}

export function workerStatusText(
  worker: Sku3dWorkshopDetailDto['worker']
): string {
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
