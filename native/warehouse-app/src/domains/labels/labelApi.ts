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

/** 사유 문구가 붙는 자리 — 바코드가 넓어 못 찍을 때 «3×5 를 쓰세요» 는 1×3 SKU 라벨에서만 길이 된다. */
export type SkipContext = 'sku-30x10' | 'sku-50x30' | 'location';

const SKIP_REASON_TEXT: Record<Exclude<LabelSkipReason, 'BARCODE_TOO_WIDE'>, string> = {
  UNSUPPORTED_CODE: '이 값은 아직 바코드로 찍을 수 없어요',
  NO_BARCODE: '등록된 바코드가 없어요',
  NOT_FOUND: '찾을 수 없어요',
};

/** 건너뛴 사유 문구의 단일 출처. */
export function skipReasonText(reason: LabelSkipReason, context: SkipContext): string {
  if (reason !== 'BARCODE_TOO_WIDE') return SKIP_REASON_TEXT[reason];
  return context === 'sku-30x10'
    ? '바코드가 길어 1×3 에 안 들어가요. 3×5 를 쓰세요'
    : '바코드가 길어 라벨에 안 들어가요';
}

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
