// src/lib/types/dto/form-export.ts
// 선택 상품 프리필 양식(대량등록 재출력) API DTO 미러 타입.
// 백엔드: apps/core/src/modules/catalog/operations/bulk-session/dto/form-export-response.dto.ts

export interface FormExportAccepted {
  exportId: string;
  status: 'queued';
  requestedCount: number;
}

export interface FormExportStatus {
  exportId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  /** 실제로 프리필된 상품 수. active 버전이 없는 상품은 조용히 빠지므로 requestedCount 보다 작을 수 있다. */
  productCount: number;
  errorMessage: string | null;
  /** 완료 시에만 true. */
  downloadable: boolean;
  expiresAt: string;
}

export interface FormExportDownloadUrl {
  url: string;
}
