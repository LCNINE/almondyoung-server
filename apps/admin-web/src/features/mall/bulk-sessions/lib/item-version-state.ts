import type { BulkSessionItem } from '@/lib/types/dto/bulk-session';

export type ItemVersionState = 'version' | 'policy-only' | 'no-change';

/**
 * 이 행이 새 버전을 만들었는가.
 *
 * 품목 판매정책은 버전에 담기지 않으므로(설계 의도), 정책만 바뀐 행과 아무것도 안 바뀐
 * 행은 서버가 draft 를 만들지 않고 `draftVersionId` 를 NULL 로 남긴다. 두 상태는
 * `changes` 의 유무로 갈린다 — 서버가 이미 내려주는 두 필드로 전부 파생되므로 이 판정에
 * 새 API 가 필요 없다.
 */
export function itemVersionState(
  item: Pick<BulkSessionItem, 'draftVersionId' | 'changes'>
): ItemVersionState {
  if (item.draftVersionId) return 'version';
  return item.changes.length > 0 ? 'policy-only' : 'no-change';
}

/** 배지 문구. 통상 경로(`version`)에는 달지 않는다 — 전부에 달면 예외가 눈에 안 띈다. */
export function itemVersionStateLabel(state: ItemVersionState): string | null {
  if (state === 'policy-only') return '판매정책만 적용 (새 버전 없음)';
  if (state === 'no-change') return '변경 없음 (새 버전 없음)';
  return null;
}
