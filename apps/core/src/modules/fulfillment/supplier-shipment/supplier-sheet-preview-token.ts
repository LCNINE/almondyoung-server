import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import type { RowVerdict } from './supplier-sheet.judge-rules';

/**
 * 직배 시트 미리보기 토큰(N6) — 줄 판정 목록 + 줄마다 정리한 사유 + 관련 상자 `manifest_version` 의 sha256(정렬된 정규 JSON).
 * 적용은 잠근 뒤 판정을 다시 돌려 이 값이 미리보기와 같을 때만 실행한다(선례 `stocktaking-preview-token.ts`).
 * 판정에는 택배사·송장번호(정규화 뒤)가 이미 있지만 사유는 없다(응답에 싣지 않는다) — 판정이 같고 사유만 다른 파일을
 * 미리보기 토큰으로 적용하면 운영자가 보지 않은 사유가 기록되므로 사유를 따로 넣는다.
 */
export function supplierSheetPreviewToken(
  rows: readonly RowVerdict[],
  manifestVersions: ReadonlyMap<string, number>,
  reasonByRow: ReadonlyMap<number, string>,
): string {
  return canonicalFulfillmentRequestHash({
    rows: [...rows]
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map((row) => ({ ...row, reason: reasonByRow.get(row.rowNumber) ?? '' })),
    manifestVersions: [...manifestVersions.entries()].sort(([a], [b]) => a.localeCompare(b)),
  });
}
