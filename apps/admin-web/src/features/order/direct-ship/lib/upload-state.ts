import type { SupplierSheetApplyResult, SupplierSheetPreview } from '@/lib/types/dto/fulfillment';

export interface UploadState {
  file: File | null;
  preview: SupplierSheetPreview | null;
  result: SupplierSheetApplyResult | null;
  /** 적용이 409 STALE 로 거절됐다 — «다시 미리보기» 안내 */
  stale: boolean;
}

export type UploadAction =
  | { type: 'fileChosen'; file: File }
  | { type: 'previewed'; preview: SupplierSheetPreview }
  | { type: 'applied'; result: SupplierSheetApplyResult }
  | { type: 'staleRejected' }
  | { type: 'reset' };

export const INITIAL_UPLOAD_STATE: UploadState = {
  file: null,
  preview: null,
  result: null,
  stale: false,
};

/**
 * 올리기 탭 상태(N10). 미리보기 토큰은 그 파일에만 맞는다 — 다른 파일을 고르면 미리보기·결과를 지워
 * 옛 토큰으로 새 파일을 보내지 않게 한다.
 */
export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case 'fileChosen':
      return { file: action.file, preview: null, result: null, stale: false };
    case 'previewed':
      return { ...state, preview: action.preview, result: null, stale: false };
    case 'applied':
      return { ...state, result: action.result, stale: false };
    case 'staleRejected':
      return { ...state, preview: null, result: null, stale: true };
    case 'reset':
      return INITIAL_UPLOAD_STATE;
  }
}
