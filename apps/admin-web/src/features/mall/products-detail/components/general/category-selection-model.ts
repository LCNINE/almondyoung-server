import {
  matchesCategory,
  normalizeSearchTerm,
  type CategoryTreeNodeLike,
} from '@/lib/utils/category-tree';

export type CategorySelectionState = {
  /** 트리 전위 순회 순서로 정렬된다. 사용자가 고른 순서가 아니다. */
  selectedIds: string[];
  primaryId: string | null;
};

/**
 * 선택 토글 + 대표 승계.
 *
 * 대표 규칙: 없으면 첫 번째가 되고, 해제되면 남은 것 중 첫 번째로 승계하고,
 * 전부 해제되면 null 이 된다.
 */
export function toggleCategorySelection(
  state: CategorySelectionState,
  id: string,
  orderedIds: string[]
): CategorySelectionState {
  const selected = new Set(state.selectedIds);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);

  const selectedIds = orderedIds.filter((candidate) => selected.has(candidate));
  const primaryId =
    state.primaryId && selectedIds.includes(state.primaryId)
      ? state.primaryId
      : (selectedIds[0] ?? null);

  return { selectedIds, primaryId };
}

/** 선택된 카테고리만 대표가 될 수 있다. */
export function setPrimaryCategory(
  state: CategorySelectionState,
  id: string
): CategorySelectionState {
  if (!state.selectedIds.includes(id)) return state;
  return { ...state, primaryId: id };
}

/** `화장품 / 스킨케어 / 토너` 꼴의 표시용 경로 라벨. 선택됨 패널이 쓴다. */
export function buildCategoryPathLabels(
  tree: CategoryTreeNodeLike[]
): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (nodes: CategoryTreeNodeLike[], pathSegments: string[]): void => {
    for (const node of nodes) {
      const nextPath = [...pathSegments, node.name];
      out.set(node.id, nextPath.join(' / '));
      if (node.children?.length) walk(node.children, nextPath);
    }
  };
  walk(tree, []);
  return out;
}

/**
 * `pruneTree` 에 넘길 술어. 비활성 정책과 검색 매칭의 합성이다.
 *
 * 이미 선택된 비활성 카테고리는 토글과 무관하게 항상 통과시킨다 —
 * 아니면 잘못 붙은 카테고리를 뗄 방법이 사라진다.
 */
export function createVisibilityPredicate(options: {
  query: string;
  includeInactive: boolean;
  selectedIds: ReadonlySet<string>;
}): (node: CategoryTreeNodeLike, pathSegments: string[]) => boolean {
  const hasQuery = normalizeSearchTerm(options.query).length > 0;

  return (node, pathSegments) => {
    const inactiveBlocked =
      !node.isActive && !options.includeInactive && !options.selectedIds.has(node.id);
    if (inactiveBlocked) return false;
    if (!hasQuery) return true;
    return matchesCategory(node, pathSegments, options.query);
  };
}
