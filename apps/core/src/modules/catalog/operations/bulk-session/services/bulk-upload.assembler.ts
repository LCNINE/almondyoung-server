import type { ParsedUpload, RawSheetRow } from './bulk-upload.parser';
import type { UploadedBundle, RowError } from './bulk-session.types';
import { isReservedRowKey, reservedRowKeyUnresolvedMessage } from './bulk-session.row-key';

export interface AssembledRow {
  rowNumber: number;
  rowKey: string;
  kind: 'create' | 'update';
  bundle: UploadedBundle;
  errors: RowError[];
}

export interface AssembledUpload {
  rows: AssembledRow[];
  images: Map<string, { rowNumber: number; sourceValue: string }>;
  errors: RowError[];
}

/**
 * 시트별 행을 상품키로 접합해 상품 단위 번들로 만들고, 수정/신규를 가른다.
 *
 * **행 삭제 규약**(스펙 §3.4·§F2):
 * - 상품 시트에서 프리필 행을 지운 것 = "이 상품은 이번에 안 건드림". 임포트는 상품을 지우지 않는다.
 * - 옵션·조합 시트의 행 누락 = 옵션 구조 변경 시도 → Task 7 의 구조 검사가 행 오류로 잡는다.
 *   (여기서는 접합만 하고 판단하지 않는다 — 신규 행은 애초에 비교할 스냅샷이 없다.)
 * - 카테고리 행이 하나도 없으면 "카테고리 변경 없음"이다. 전량 해제는 임포트로 표현하지 않는다
 *   (대표 카테고리 없는 상품을 만들 수 없으므로 표현할 수 있어도 쓸 데가 없다).
 * - 구매제약 행이 없으면 "변경 없음". 해제는 값 칸을 비워서 표현한다.
 */
export function assembleUpload(parsed: ParsedUpload, knownRowKeys: Set<string>): AssembledUpload {
  const rows: AssembledRow[] = [];
  const byKey = new Map<string, AssembledRow>();
  const seen = new Set<string>();
  const errors: RowError[] = [];

  for (const raw of parsed.sheets.products) {
    const rowKey = (raw.cells.rowKey ?? '').trim();
    const row: AssembledRow = {
      rowNumber: raw.rowNumber,
      rowKey,
      kind: knownRowKeys.has(rowKey) ? 'update' : 'create',
      bundle: { product: raw.cells, options: [], variants: [], categories: [], constraint: null },
      errors: [],
    };
    if (rowKey === '') {
      row.errors.push({ sheet: '상품', rowNumber: raw.rowNumber, message: '상품키는 필수입니다.' });
    } else if (seen.has(rowKey)) {
      row.errors.push({ sheet: '상품', rowNumber: raw.rowNumber, message: `상품키가 중복되었습니다: ${rowKey}` });
      const first = byKey.get(rowKey);
      // 어느 쪽이 맞는지 알 수 없으므로 첫 행에도 같은 오류를 남긴다 — 한쪽만 실패시키면
      // 남은 쪽이 조용히 적용돼 작업자가 의도한 것과 다른 상품이 바뀐다.
      if (first && !first.errors.some((e) => e.message.includes('중복'))) {
        first.errors.push({ sheet: '상품', rowNumber: first.rowNumber, message: `상품키가 중복되었습니다: ${rowKey}` });
      }
    } else {
      seen.add(rowKey);
      byKey.set(rowKey, row);
      // 예약 형식인데 신규로 분류됐다 = 이 양식의 매핑에 없는 시스템 발급 키다.
      // 서로 다른 양식의 시트를 섞은 경우가 대표적이다. 그대로 두면 신규 상품이 만들어져
      // 원본과 중복된다. 파일 전체가 잘못된 것은 아니므로(bulk-session.manager.ts 의 파일
      // 수준 게이트가 그 경우를 이미 걸렀다) 이 행만 떨군다.
      if (row.kind === 'create' && isReservedRowKey(rowKey)) {
        row.errors.push({
          sheet: '상품',
          rowNumber: raw.rowNumber,
          message: reservedRowKeyUnresolvedMessage(rowKey),
        });
      }
    }
    rows.push(row);
  }

  const attach = (
    sheet: RowError['sheet'],
    sheetRows: RawSheetRow[],
    apply: (target: AssembledRow, raw: RawSheetRow) => void,
  ): void => {
    for (const raw of sheetRows) {
      const rowKey = (raw.cells.rowKey ?? '').trim();
      const target = byKey.get(rowKey);
      if (!target) {
        errors.push({
          sheet,
          rowNumber: raw.rowNumber,
          message: `"상품" 시트에 없는 상품키를 참조했습니다: ${rowKey || '(빈 값)'}`,
        });
        continue;
      }
      apply(target, raw);
    }
  };

  attach('옵션', parsed.sheets.options, (t, raw) => t.bundle.options.push(raw.cells));
  attach('조합', parsed.sheets.variants, (t, raw) => t.bundle.variants.push(raw.cells));
  attach('카테고리', parsed.sheets.categories, (t, raw) => t.bundle.categories.push(raw.cells));
  attach('구매제약', parsed.sheets.constraints, (t, raw) => {
    if (t.bundle.constraint) {
      t.errors.push({
        sheet: '구매제약',
        rowNumber: raw.rowNumber,
        message: `구매제약은 상품당 한 행만 쓸 수 있습니다: ${t.rowKey}`,
      });
      return;
    }
    t.bundle.constraint = raw.cells;
  });

  const images = new Map<string, { rowNumber: number; sourceValue: string }>();
  for (const raw of parsed.sheets.images) {
    const imageKey = (raw.cells.imageKey ?? '').trim();
    const sourceValue = (raw.cells.sourceValue ?? '').trim();
    if (imageKey === '') {
      errors.push({ sheet: '이미지', rowNumber: raw.rowNumber, message: '이미지키는 필수입니다.' });
      continue;
    }
    if (sourceValue === '') {
      errors.push({ sheet: '이미지', rowNumber: raw.rowNumber, message: `원본은 필수입니다: ${imageKey}` });
      continue;
    }
    if (images.has(imageKey)) {
      errors.push({ sheet: '이미지', rowNumber: raw.rowNumber, message: `이미지키가 중복되었습니다: ${imageKey}` });
      continue;
    }
    images.set(imageKey, { rowNumber: raw.rowNumber, sourceValue });
  }

  return { rows, images, errors };
}
