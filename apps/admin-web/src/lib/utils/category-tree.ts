/**
 * 카테고리 관리 페이지와 상품 카테고리 선택기가 공유하는 트리 로직.
 *
 * admin-web 은 `.tsx` 를 테스트할 수 없으므로(jest transform 이 `.ts` 만 받는다)
 * 판정 가능한 규칙은 전부 이 파일의 순수 함수로 내려온다.
 */

/** 두 소비자가 모두 만족하는 최소 노드 형태. 어느 쪽도 자기 타입을 바꾸지 않는다. */
export type CategoryTreeNodeLike = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  isActive: boolean;
  /** 멤버십 전용 카테고리 여부. 관리 페이지는 필수, DTO 는 선택이라 optional 로 받는다. */
  isVisibleToMembersOnly?: boolean;
  children?: CategoryTreeNodeLike[];
};

/** 소문자화 + 공백 전부 제거. 비교는 항상 이 형태로 한다. */
export function normalizeSearchTerm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

/**
 * 마지막 토큰은 "찾는 대상"(이름·slug·설명), 앞 토큰들은 "위치 한정"(경로)이다.
 *
 * `pathSegments` 는 조상 + **자기 이름**이다. 자기 이름을 빼면 `스킨 케어` 가
 * 불매치가 된다 — `스킨` 이 조상 `화장품` 에는 없기 때문.
 *
 * 마지막 토큰을 이름에 묶어두는 것이 폭발 방어선이다. 경로 전체를 그냥
 * 부분일치시키면 `화장품` 하나로 그 아래 수백 개가 전부 매치된다.
 */
export function matchesCategory(
  node: CategoryTreeNodeLike,
  pathSegments: string[],
  query: string
): boolean {
  const tokens = query
    .split(/\s+/)
    .map(normalizeSearchTerm)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return false;

  const target = tokens[tokens.length - 1];
  const locators = tokens.slice(0, -1);

  const haystacks = [node.name, node.slug, node.description]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(normalizeSearchTerm);
  if (!haystacks.some((haystack) => haystack.includes(target))) return false;

  const path = normalizeSearchTerm(pathSegments.join('/'));
  return locators.every((locator) => path.includes(locator));
}

/** 전위 순회(pre-order DFS) 순서의 id 목록. 선택 정렬의 기준 순서다. */
export function orderedCategoryIds(tree: CategoryTreeNodeLike[]): string[] {
  const out: string[] = [];
  const walk = (nodes: CategoryTreeNodeLike[]): void => {
    for (const node of nodes) {
      out.push(node.id);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);
  return out;
}

export function collectAllIds(tree: CategoryTreeNodeLike[]): Set<string> {
  return new Set(orderedCategoryIds(tree));
}

/**
 * 검색 매치 노드와, 그 노드를 화면에 드러내기 위해 펼쳐야 할 조상들.
 *
 * `expandedIds` 에 매치 노드 자신은 넣지 않는다 — 자기를 펼칠 이유가 없다.
 */
export function collectSearchExpansion(
  tree: CategoryTreeNodeLike[],
  query: string
): { matchedIds: Set<string>; expandedIds: Set<string> } {
  const matchedIds = new Set<string>();
  const expandedIds = new Set<string>();
  if (normalizeSearchTerm(query).length === 0) return { matchedIds, expandedIds };

  const walk = (
    nodes: CategoryTreeNodeLike[],
    pathSegments: string[],
    ancestorIds: string[]
  ): void => {
    for (const node of nodes) {
      const nextPath = [...pathSegments, node.name];
      if (matchesCategory(node, nextPath, query)) {
        matchedIds.add(node.id);
        for (const ancestorId of ancestorIds) expandedIds.add(ancestorId);
      }
      if (node.children?.length) {
        walk(node.children, nextPath, [...ancestorIds, node.id]);
      }
    }
  };
  walk(tree, [], []);
  return { matchedIds, expandedIds };
}

/**
 * 주어진 노드들의 조상 id 집합 (대상 자신은 제외).
 * 모달이 열릴 때 "이미 선택된 카테고리"를 드러내는 초기 펼침값으로 쓴다.
 */
export function collectAncestorIds(
  tree: CategoryTreeNodeLike[],
  targetIds: Iterable<string>
): Set<string> {
  const targets = new Set(targetIds);
  const out = new Set<string>();
  if (targets.size === 0) return out;

  const walk = (nodes: CategoryTreeNodeLike[], ancestorIds: string[]): void => {
    for (const node of nodes) {
      if (targets.has(node.id)) {
        for (const ancestorId of ancestorIds) out.add(ancestorId);
      }
      if (node.children?.length) walk(node.children, [...ancestorIds, node.id]);
    }
  };
  walk(tree, []);
  return out;
}

/** 가지치기 결과 노드. `matchedSelf: false` = 자손 때문에 남은 구조 유지용. */
export type PrunedNode = {
  node: CategoryTreeNodeLike;
  /** 조상 + 자기 이름 */
  pathSegments: string[];
  matchedSelf: boolean;
  children: PrunedNode[];
};

/**
 * 노드가 보인다 = 본인이 술어를 통과 OR 자손 중 통과하는 게 있다.
 *
 * 이 한 규칙이 검색과 비활성 필터를 함께 처리한다. 따로 적용하면
 * `화장품(비활성) / 스킨케어(활성)` 에서 부모가 사라지며 활성 자식까지 증발한다.
 */
export function pruneTree(
  tree: CategoryTreeNodeLike[],
  predicate: (node: CategoryTreeNodeLike, pathSegments: string[]) => boolean
): PrunedNode[] {
  const walk = (
    nodes: CategoryTreeNodeLike[],
    pathSegments: string[]
  ): PrunedNode[] => {
    const out: PrunedNode[] = [];
    for (const node of nodes) {
      const nextPath = [...pathSegments, node.name];
      const children = node.children?.length ? walk(node.children, nextPath) : [];
      const matchedSelf = predicate(node, nextPath);
      if (matchedSelf || children.length > 0) {
        out.push({ node, pathSegments: nextPath, matchedSelf, children });
      }
    }
    return out;
  };
  return walk(tree, []);
}
