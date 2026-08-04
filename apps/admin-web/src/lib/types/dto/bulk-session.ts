// src/lib/types/dto/bulk-session.ts
// 상품 일괄 등록/수정 세션 API DTO 미러 타입.
// 백엔드: apps/core/src/modules/catalog/operations/bulk-session/dto/

export const BULK_SESSION_PHASES = [
  'uploaded',
  'validating',
  'review',
  'awaiting_images',
  'drafting',
  'drafted',
  'publishing',
  'published',
  'canceled',
  'failed',
] as const;
export type BulkSessionPhase = (typeof BULK_SESSION_PHASES)[number];

export type BulkItemStatus =
  | 'pending'
  | 'invalid'
  | 'drafted'
  | 'excluded'
  | 'failed';
export type BulkPublishStatus = 'idle' | 'pending' | 'published' | 'failed';
export type BulkImageStatus = 'resolved' | 'awaiting_upload';
export type BulkImageUsage = 'main' | 'description';
export type ConflictFilter = 'any' | 'undecided';
export type ConflictDecision = 'overwrite' | 'skip';

export interface BulkSessionAccepted {
  sessionId: string;
  phase: 'uploaded';
  totalRows: number;
}

export interface BulkSessionSummary {
  id: string;
  name: string;
  fileName: string;
  phase: BulkSessionPhase;
  phaseError: string | null;
  totalRows: number;
  cancelRequestedAt: string | null;
  createdAt: string;
}

export interface BulkSessionList {
  data: BulkSessionSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface StatusCount<S extends string> {
  status: S;
  count: number;
}

export interface BulkSessionProgress {
  sessionId: string;
  phase: BulkSessionPhase;
  phaseError: string | null;
  /** 진행률 분모로 쓰지 마라 — 합성 아이템이 빠져 itemTotal 과 어긋난다. */
  totalRows: number;
  /** 진행률의 올바른 분모. */
  itemTotal: number;
  itemCounts: StatusCount<BulkItemStatus>[];
  imageCounts: StatusCount<BulkImageStatus>[];
  publishCounts: StatusCount<BulkPublishStatus>[];
  cancelRequestedAt: string | null;
}

export interface BulkSessionItemChange {
  field: string;
  /** 서버가 붙인 워크북 한국어 헤더 라벨. 화면이 다시 매핑하지 않는다. */
  label: string;
  before: string;
  after: string;
}

export interface BulkSessionItemConflict {
  field: string;
  label: string;
  base: string;
  mine: string;
  current: string;
  /** 미결정이면 null — 서버가 기본값을 정하지 않는다. */
  decision: ConflictDecision | null;
}

export interface BulkSessionItem {
  id: string;
  rowNumber: number;
  rowKey: string;
  kind: 'create' | 'update';
  /**
   * 검토 목록에 보여줄 표시용 상품명. update 행은 업로드값(새 이름)을 우선하고 없으면
   * 스냅샷의 현재 이름으로 떨어진다. 행이 너무 망가져 어느 쪽에서도 이름을 뽑을 수 없으면
   * 빈 문자열일 수 있다 — 화면이 대체 표시(예: '—')를 정한다.
   */
  productName: string;
  status: BulkItemStatus;
  masterId: string | null;
  errorMessage: string | null;
  draftVersionId: string | null;
  /** status 와 축이 다르다 — drafted 이면서 failed 일 수 있다. */
  publishStatus: BulkPublishStatus;
  publishError: string | null;
  changes: BulkSessionItemChange[];
  conflicts: BulkSessionItemConflict[];
}

export interface BulkSessionItemList {
  data: BulkSessionItem[];
  total: number;
  page: number;
  limit: number;
}

export interface BulkSessionImage {
  imageKey: string;
  usage: BulkImageUsage;
  /** 이 용도로 업로드할 때 써야 하는 file-service 컨텍스트. */
  contextId: string;
  sourceKind: 'file_id' | 'file_name';
  /** file_name 이면 작업자가 올려야 할 로컬 파일명. */
  sourceValue: string;
  status: BulkImageStatus;
  fileId: string | null;
  required: boolean;
}

export interface BulkSessionImageList {
  data: BulkSessionImage[];
  total: number;
  page: number;
  limit: number;
  /** 필터와 무관한 세션 전체 기준 — 전량 게이트의 분모. */
  requiredTotal: number;
  requiredResolved: number;
}

export interface ResolveImageEntry {
  imageKey: string;
  usage: BulkImageUsage;
  fileId: string;
}

export interface ResolveImageResult {
  imageKey: string;
  usage: BulkImageUsage;
  ok: boolean;
  /** ok=false 일 때 작업자에게 그대로 보여줄 문구. */
  error: string | null;
}

export interface ResolveImagesResponse {
  /** 인덱스로 짝지으면 안 된다 — (imageKey, usage) 로 짝짓는다. */
  results: ResolveImageResult[];
  progress: BulkSessionProgress;
}

export interface PurgeDraftsResult {
  purged: number;
  failed: number;
  /** remaining===0 또는 purged===0 이 될 때까지 다시 호출한다. */
  remaining: number;
}
