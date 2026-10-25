import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import type { RowVerdict } from './supplier-sheet.judge-rules';

/**
 * 직배 시트 미리보기 토큰(N6) — 줄 판정 목록 + 관련 상자 `manifest_version` 의 sha256(정렬된 정규 JSON).
 * 적용은 잠근 뒤 판정을 다시 돌려 이 값이 미리보기와 같을 때만 실행한다(선례 `stocktaking-preview-token.ts`).
 */
export function supplierSheetPreviewToken(
  rows: readonly RowVerdict[],
  manifestVersions: ReadonlyMap<string, number>,
): string {
  return canonicalFulfillmentRequestHash({
    rows: [...rows].sort((a, b) => a.rowNumber - b.rowNumber),
    manifestVersions: [...manifestVersions.entries()].sort(([a], [b]) => a.localeCompare(b)),
  });
}
