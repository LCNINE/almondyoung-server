// src/lib/types/dto/form-export.ts
// 선택 상품 프리필 양식(대량등록 재출력) API DTO 미러 타입.
// 백엔드: apps/core/src/modules/catalog/operations/bulk-session/dto/form-export-response.dto.ts

export interface FormExportAccepted {
  exportId: string;
  status: 'queued' | 'running';
  requestedCount: number;
  /** 진행 중인 같은 요청을 재사용했으면 true. */
  reused: boolean;
}

export interface FormExportStatus {
  exportId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  /** 실제로 프리필된 상품 수. active 버전이 없는 상품은 조용히 빠지므로 requestedCount 보다 작을 수 있다. */
  productCount: number;
  errorMessage: string | null;
  /** running 인데 0 보다 크면 재시도 대기 중이다. */
  consecutiveFailures: number;
  /** 완료 시에만 true. */
  downloadable: boolean;
  expiresAt: string;
}

export interface FormExportDownloadUrl {
  url: string;
}

export interface FormExportSummary {
  exportId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  requestedCount: number;
  productCount: number;
  errorMessage: string | null;
  /** running 인데 0 보다 크면 재시도 대기 중이다. */
  consecutiveFailures: number;
  downloadable: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface FormExportList {
  data: FormExportSummary[];
  total: number;
  page: number;
  limit: number;
}
