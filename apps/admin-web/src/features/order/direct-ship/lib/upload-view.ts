import { parseServerError } from '@/lib/api/server-error';
import type {
  SupplierRowVerdict,
  SupplierRowVerdictKind,
  SupplierSheetApplyResult,
  SupplierSheetVerdictCounts,
} from '@/lib/types/dto/fulfillment';
import { applicableCount, verdictLabel } from './upload-verdict-text';

export const PREVIEW_STALE_CODE = 'SUPPLIER_UPLOAD_PREVIEW_STALE';
export const PREVIEW_STALE_MESSAGE = '미리보기 뒤에 바뀐 것이 있습니다. 다시 미리보기 하세요.';

const COUNT_ORDER: SupplierRowVerdictKind[] = [
  'ship',
  'merge',
  'correct',
  'unfulfillable',
  'waiting',
  'unchanged',
  'error',
];

/** 미리보기 표 — 오류 줄을 먼저(고칠 것부터), 안에서는 엑셀 행 번호 순 */
export function previewRowsErrorsFirst(rows: SupplierRowVerdict[]): SupplierRowVerdict[] {
  const rank = (r: SupplierRowVerdict) => (r.verdict === 'error' ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.rowNumber - b.rowNumber);
}

/** 판정 수 한 줄 — 0 인 판정은 숨긴다 */
export function verdictCountsText(counts: SupplierSheetVerdictCounts): string {
  return COUNT_ORDER.filter((k) => counts[k] > 0)
    .map((k) => `${verdictLabel(k)} ${counts[k]}`)
    .join(' · ');
}

/** 적용 버튼(N10) — 오류 줄이 있어도 눌린다(서버가 빼고 쓴다), 쓸 줄이 0 이면 막는다 */
export function applyGate(counts: SupplierSheetVerdictCounts): {
  disabled: boolean;
  errorNote: string | null;
} {
  return {
    disabled: applicableCount(counts) === 0,
    errorNote: counts.error > 0 ? `오류 ${counts.error}줄은 적용되지 않습니다` : null,
  };
}

export function isPreviewStaleError(error: unknown): boolean {
  return parseServerError(error).code === PREVIEW_STALE_CODE;
}

export function appliedSummaryText(result: SupplierSheetApplyResult): string {
  return `발송 ${result.shippedShipmentIds.length}상자`;
}
