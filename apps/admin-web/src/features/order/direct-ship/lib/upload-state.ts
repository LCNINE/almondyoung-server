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
  /** `file` = 그 미리보기를 만든 파일. 지금 파일과 다르면(늦게 온 응답) 버린다 */
  | { type: 'previewed'; file: File; preview: SupplierSheetPreview }
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
 * 옛 토큰으로 새 파일을 보내지 않게 한다. 늦게 온 옛 파일의 미리보기도 새 파일에 붙이지 않는다.
 */
export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case 'fileChosen':
      return { file: action.file, preview: null, result: null, stale: false };
    case 'previewed':
      if (action.file !== state.file) return state;
      return { ...state, preview: action.preview, result: null, stale: false };
    case 'applied':
      // 토큰을 지운다 — 같은 토큰으로 두 번 적용하지 않게. 다시 적용하려면 다시 미리보기 한다
      return { ...state, preview: null, result: action.result, stale: false };
    case 'staleRejected':
      return { ...state, preview: null, result: null, stale: true };
    case 'reset':
      return INITIAL_UPLOAD_STATE;
  }
}
