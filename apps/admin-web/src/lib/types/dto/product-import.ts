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

export interface CommitItem {
  rowNumber: number;
  productKey: string;
  status: 'created' | 'failed';
  masterId?: string;
  errorMessage?: string;
}

export interface CommitResultDto {
  sessionId: string;
  createdCount: number;
  failedCount: number;
  items: CommitItem[];
}

export interface SessionSummaryDto {
  id: string;
  fileName: string | null;
  totalRows: number;
  createdCount: number;
  failedCount: number;
  status: string;
  createdAt: string; // JSON 직렬화 결과(백엔드 Date → string)
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

export interface PublishFailure {
  masterId: string;
  reason: string;
}

export interface PublishResultDto {
  published: number;
  failed: PublishFailure[];
}
