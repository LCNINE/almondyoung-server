// src/lib/types/dto/product-import.ts
// 판매상품 대량등록(엑셀 임포트) API DTO 미러 타입.
// 백엔드: apps/core/.../operations/import/dto/import-response.dto.ts

export interface ResolvedPreview {
  name: string;
  categoryNames: string[];
  variantCount: number;
}

export interface ValidatePreviewRow {
  rowNumber: number;
  productKey: string;
  status: 'valid' | 'invalid';
  errors: string[];
  resolved: ResolvedPreview;
}

export interface ValidatePreviewDto {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  rows: ValidatePreviewRow[];
}

/** 커밋/게시 잡의 상태. idle 은 아직 아무 잡도 접수되지 않은 상태, canceled 는 사람이 멈춘 상태. */
export type ImportJobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

/** 세션 아이템(행 단위)의 게시 상태. */
export type ItemPublishStatus = 'pending' | 'published' | 'failed' | 'skipped';

export interface CommitItem {
  rowNumber: number;
  productKey: string;
  // 'pending' 은 접수 후 워커가 아직 처리하지 않은 행 — 세션 상세 폴링 중 나타난다.
  status: 'pending' | 'created' | 'failed';
  masterId?: string;
  errorMessage?: string;
  publishStatus: ItemPublishStatus;
  publishError?: string;
}

/** POST /product-imports/commit 의 202 응답 — 접수만 되었을 뿐 생성은 워커가 비동기로 진행한다. */
export interface CommitAcceptedDto {
  sessionId: string;
  status: 'queued';
  totalRows: number;
  queuedCount: number;
  invalidCount: number;
}

/** POST /product-imports/:id/publish 의 202 응답 — 게시도 워커가 비동기로 진행한다. */
export interface PublishAcceptedDto {
  sessionId: string;
  status: 'queued';
  targetCount: number;
}

/** POST /product-imports/:id/cancel 의 200 응답 — 진행 중이던 레인만 canceled 로 확정된다. */
export interface CancelAcceptedDto {
  sessionId: string;
  commitStatus: ImportJobStatus;
  publishStatus: ImportJobStatus;
  canceledAt: string;
}

export interface SessionSummaryDto {
  id: string;
  fileName: string | null;
  totalRows: number;
  createdCount: number;
  failedCount: number;
  status: string;
  createdAt: string; // JSON 직렬화 결과(백엔드 Date → string)
  commitStatus: ImportJobStatus;
  publishStatus: ImportJobStatus;
  publishedCount: number;
  publishFailedCount: number;
  commitError: string | null;
  publishError: string | null;
  /** 접수 시점 검증실패 행 수. 컬럼 도입 이전 세션은 null 이라 화면이 폴백해야 한다. */
  invalidCount: number | null;
  /** 취소 요청 시각(JSON 직렬화 결과). null 이 아니면 이 세션은 종단이다. */
  cancelRequestedAt: string | null;
}

export interface SessionDetailDto extends SessionSummaryDto {
  items: CommitItem[];
}

export interface SessionListResponse {
  data: SessionSummaryDto[];
  total: number;
  page: number;
  limit: number;
}
