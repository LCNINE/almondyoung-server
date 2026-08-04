import type { BulkSessionItem } from '@/lib/types/dto/bulk-session';

/**
 * 무효 행을 AI 에게 그대로 붙여넣을 수 있는 텍스트로 만든다.
 *
 * 시트명을 따로 뽑지 않는 이유: `errorMessage` 는 서버가 `RowError` 들을 합친 문자열이라
 * 시트명이 이미 그 안에 들어 있다(`BulkSessionItem` 에 시트 필드 자체가 없다).
 *
 * 머리말에 건수를 싣는다 — 목록 조회가 `limit=100` 으로 클램프되므로(bulk-session.controller.ts:45),
 * 붙여넣은 쪽이 전량인지 잘린 것인지 사람이 알 수 있어야 한다.
 */
export function formatErrorReport(items: BulkSessionItem[]): string {
  if (items.length === 0) return '오류 행이 없습니다.';

  const lines = items.map((item) => {
    const name = item.productName.trim() || '(이름 없음)';
    const reason = item.errorMessage?.trim() || '(사유 없음)';
    return `${item.rowNumber}행 · ${item.rowKey} · ${name} · ${reason}`;
  });

  return [`오류 ${items.length}건`, ...lines].join('\n');
}
