import type { ApiClient } from '../../core/data/httpClient';

/** SKU 라벨 크기. 30×10 mm = 1×3, 50×30 mm = 3×5. */
export type SkuLabelSize = '30x10' | '50x30';

export type LabelSkipReason = 'UNSUPPORTED_CODE' | 'NO_BARCODE' | 'BARCODE_TOO_WIDE' | 'NOT_FOUND';

/** POST /inventory/labels/* 응답(#1281). 그릴 게 없으면 data 가 '' 이고 skipped 만 온다. */
export interface LabelBatch {
  format: 'zpl';
  data: string;
  labels: number;
  skipped: { ref: string; code: string | null; reason: LabelSkipReason }[];
}

export const SKIP_REASON_TEXT: Record<LabelSkipReason, string> = {
  UNSUPPORTED_CODE: '이 값은 아직 바코드로 찍을 수 없어요',
  NO_BARCODE: '등록된 바코드가 없어요',
  BARCODE_TOO_WIDE: '바코드가 길어 이 크기에 안 들어가요. 3×5 를 쓰세요',
  NOT_FOUND: '찾을 수 없어요',
};

/** POST /inventory/labels/skus */
export function fetchSkuLabels(
  api: ApiClient,
  body: { size: SkuLabelSize; items: { skuId: string; copies: number }[] },
): Promise<LabelBatch> {
  return api.request<LabelBatch>({ method: 'POST', path: '/inventory/labels/skus', body });
}

/** POST /inventory/labels/locations */
export function fetchLocationLabels(
  api: ApiClient,
  body: { rackId: string } | { locationIds: string[] },
): Promise<LabelBatch> {
  return api.request<LabelBatch>({ method: 'POST', path: '/inventory/labels/locations', body });
}
