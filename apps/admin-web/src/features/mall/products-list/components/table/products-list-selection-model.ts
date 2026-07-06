import type { RowSelectionState } from '@tanstack/react-table';

export type SelectedProductSnapshot = {
  masterId: string;
  name: string;
  thumbnail: string | null;
};

/** 유지되는 선택 상태(rowSelection)에서 선택된 masterId 만 뽑는다. */
export function selectedIdsFromRowSelection(
  rowSelection: RowSelectionState,
): string[] {
  return Object.keys(rowSelection).filter((id) => rowSelection[id]);
}

function snapshotsEqual(
  a: SelectedProductSnapshot,
  b: SelectedProductSnapshot,
): boolean {
  return (
    a.masterId === b.masterId && a.name === b.name && a.thumbnail === b.thumbnail
  );
}

function snapshotMapsEqual(
  a: Record<string, SelectedProductSnapshot>,
  b: Record<string, SelectedProductSnapshot>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((k) => b[k] !== undefined && snapshotsEqual(a[k], b[k]));
}

/**
 * 선택 스냅샷 레지스트리를 현재 선택 상태 + 현재 화면에 로드된 행에 맞춰 재조정한다.
 * - 선택된 id 중 현재 페이지에 있는 행은 최신 스냅샷으로 갱신
 * - 현재 페이지에 없지만 이전 스냅샷이 있으면 유지 (다른 페이지/필터에서 선택된 항목)
 * - 선택 해제된 id 는 제거
 * changed=false 면 호출부가 setState 를 건너뛰어 렌더 루프를 막는다.
 */
export function reconcileSelectedSnapshots(
  prev: Record<string, SelectedProductSnapshot>,
  rowSelection: RowSelectionState,
  currentRows: SelectedProductSnapshot[],
): { changed: boolean; next: Record<string, SelectedProductSnapshot> } {
  const byId = new Map(currentRows.map((r) => [r.masterId, r]));
  const next: Record<string, SelectedProductSnapshot> = {};

  for (const id of selectedIdsFromRowSelection(rowSelection)) {
    next[id] =
      byId.get(id) ?? prev[id] ?? { masterId: id, name: id, thumbnail: null };
  }

  return { changed: !snapshotMapsEqual(prev, next), next };
}
