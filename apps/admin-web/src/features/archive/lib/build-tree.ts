import type { ArchivePageNodeDto } from '@/lib/types/dto/archive';

export type ArchiveTreeNode = ArchivePageNodeDto & {
  children: ArchiveTreeNode[];
};

/**
 * 정렬 키는 [0-9A-Za-z] 뿐이라 기본 문자열 비교가 곧 서버(Postgres)의 정렬과 같다.
 * 키가 겹치는 일은 없어야 하지만, 겹치더라도 화면 순서가 흔들리지 않게 id 로 마무리한다.
 */
function compareBySortKey(
  a: ArchivePageNodeDto,
  b: ArchivePageNodeDto
): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 평면 목록을 트리로 조립한다.
 *
 * 부모가 목록에 없는 행(권한 밖이거나 데이터가 어긋난 경우)은 조용히 사라지면 안 되므로
 * 루트로 올린다. 부모 관계가 순환하면 그 고리는 루트로 끌어내 화면이 멈추지 않게 한다.
 */
export function buildArchiveTree(
  nodes: ArchivePageNodeDto[]
): ArchiveTreeNode[] {
  const byId = new Map<string, ArchiveTreeNode>();
  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] });
  }

  const roots: ArchiveTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && !createsCycle(node.id, parent, byId)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortRecursively(roots);
  return roots;
}

function createsCycle(
  childId: string,
  parent: ArchiveTreeNode,
  byId: Map<string, ArchiveTreeNode>
): boolean {
  const seen = new Set<string>([childId]);
  let cursor: string | null = parent.id;

  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }

  return false;
}

function sortRecursively(nodes: ArchiveTreeNode[]): void {
  nodes.sort(compareBySortKey);
  for (const node of nodes) sortRecursively(node.children);
}

/** 자기 자신을 포함한 하위 전체의 id. 자기 하위로 끌어다 놓는 것을 막는 데 쓴다. */
export function collectSubtreeIds(node: ArchiveTreeNode): Set<string> {
  const ids = new Set<string>();

  const walk = (current: ArchiveTreeNode): void => {
    ids.add(current.id);
    for (const child of current.children) walk(child);
  };

  walk(node);
  return ids;
}

/** 특정 페이지까지의 조상 id — 링크로 들어왔을 때 사이드바를 그만큼 펼치는 데 쓴다. */
export function findAncestorIds(
  nodes: ArchivePageNodeDto[],
  targetId: string
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const trail: string[] = [];
  const seen = new Set<string>();

  let cursor = byId.get(targetId)?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    trail.push(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }

  return trail;
}

/** 형제 목록 안에서의 위치. «위로/아래로 이동» 같은 드래그 대체 수단이 쓴다. */
export function siblingsOf(
  nodes: ArchivePageNodeDto[],
  parentId: string | null
): ArchivePageNodeDto[] {
  return nodes
    .filter((node) => (node.parentId ?? null) === parentId)
    .sort(compareBySortKey);
}
