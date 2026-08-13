import type { RowSelectionState } from '@tanstack/react-table';
import type { MasterSelectionItemDto } from '@/lib/types/dto/products';

/**
 * 선택 목록을 그리는 모든 곳(선택 목록 모달, 일괄 액션 확인 모달)이 공유하는 렌더 상한.
 * 두 목록 다 가상화가 없고 항목마다 노드를 만든다 — 전체 선택으로 5000건이 들어오면
 * 상한 없이는 탭이 멎는다. 넘는 만큼은 건수로만 알린다.
 */
export const SELECTION_PREVIEW_LIMIT = 200;

export type SelectedProductSnapshot = {
  masterId: string;
  name: string;
  thumbnail: string | null;
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  isOverseas: boolean;
};

/** 유지되는 선택 상태(rowSelection)에서 선택된 masterId 만 뽑는다. */
export function selectedIdsFromRowSelection(
  rowSelection: RowSelectionState
): string[] {
  return Object.keys(rowSelection).filter((id) => rowSelection[id]);
}

function snapshotsEqual(
  a: SelectedProductSnapshot,
  b: SelectedProductSnapshot
): boolean {
  return (
    a.masterId === b.masterId &&
    a.name === b.name &&
    a.thumbnail === b.thumbnail &&
    a.hideMembershipPriceForNonMembers === b.hideMembershipPriceForNonMembers &&
    a.isVisibleToMembersOnly === b.isVisibleToMembersOnly &&
    a.isOverseas === b.isOverseas
  );
}

function snapshotMapsEqual(
  a: Record<string, SelectedProductSnapshot>,
  b: Record<string, SelectedProductSnapshot>
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
  currentRows: SelectedProductSnapshot[]
): { changed: boolean; next: Record<string, SelectedProductSnapshot> } {
  const byId = new Map(currentRows.map((r) => [r.masterId, r]));
  const next: Record<string, SelectedProductSnapshot> = {};

  for (const id of selectedIdsFromRowSelection(rowSelection)) {
    next[id] = byId.get(id) ??
      prev[id] ?? {
        masterId: id,
        name: id,
        thumbnail: null,
        hideMembershipPriceForNonMembers: false,
        isVisibleToMembersOnly: false,
        isOverseas: false,
      };
  }

  return { changed: !snapshotMapsEqual(prev, next), next };
}

/**
 * 전체 선택 응답을 테이블 선택 상태 + 스냅샷으로 바꾼다.
 *
 * 이름·썸네일이 비어 있는 건 의도다 — 서버가 주지 않고, 그래야 선택 목록 모달이
 * 5000행을 이미지째 그리려 들지 않는다. 정책 플래그는 실제 값이라야 한다.
 */
export function selectionFromItems(items: MasterSelectionItemDto[]): {
  rowSelection: RowSelectionState;
  snapshots: Record<string, SelectedProductSnapshot>;
} {
  const rowSelection: RowSelectionState = {};
  const snapshots: Record<string, SelectedProductSnapshot> = {};

  for (const item of items) {
    rowSelection[item.masterId] = true;
    snapshots[item.masterId] = {
      masterId: item.masterId,
      name: '',
      thumbnail: null,
      hideMembershipPriceForNonMembers: item.hideMembershipPriceForNonMembers,
      isVisibleToMembersOnly: item.isVisibleToMembersOnly,
      isOverseas: item.isOverseas,
    };
  }

  return { rowSelection, snapshots };
}
