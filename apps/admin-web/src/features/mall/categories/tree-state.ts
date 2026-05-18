import type { CategoryDto } from '@/lib/types/dto/products';
import type { PendingTreeChanges } from './types';

/**
 * 트리 뷰가 사용하는 정규화된 노드. 서버 응답을 평탄화한 뒤 펜딩 변경을
 * 얹어 다시 트리로 빌드하는 중간 표현이다.
 */
export interface CategoryNode {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  isActive: boolean;
  parentId: string | null;
  children: CategoryNode[];
  hasPendingMove: boolean;
  hasPendingReorder: boolean;
}

export const ROOT_KEY = 'root';

export function parentKeyOf(parentId: string | null): string {
  return parentId ?? ROOT_KEY;
}

interface FlatCategory {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  isActive: boolean;
  parentId: string | null;
  sortOrder: number;
}

function flatten(categories: CategoryDto[], parentId: string | null, out: FlatCategory[]): void {
  for (const c of categories) {
    out.push({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      isActive: c.isActive,
      parentId,
      sortOrder: c.sortOrder ?? 0,
    });
    if (c.children?.length) flatten(c.children, c.id, out);
  }
}

/**
 * 서버 트리 + 펜딩 변경 → 화면에 그릴 트리.
 *
 * 적용 순서:
 *   1) `parentMoves` 로 각 노드의 부모를 갱신.
 *   2) 영향받은 부모(`siblingOrders` 키)는 그 순서를 그대로 사용.
 *      비어 있는 부모는 서버의 `sortOrder` 순으로 정렬.
 */
export function buildPendingTree(
  serverTree: CategoryDto[],
  pending: PendingTreeChanges,
): CategoryNode[] {
  const flat: FlatCategory[] = [];
  flatten(serverTree, null, flat);

  const byId = new Map<string, FlatCategory>();
  for (const f of flat) {
    const newParent = pending.parentMoves[f.id];
    byId.set(f.id, {
      ...f,
      parentId: newParent !== undefined ? newParent : f.parentId,
    });
  }

  const childrenByParent = new Map<string, string[]>();
  for (const f of byId.values()) {
    const key = parentKeyOf(f.parentId);
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(f.id);
  }

  for (const [key, ids] of childrenByParent) {
    const pendingOrder = pending.siblingOrders[key];
    if (pendingOrder) {
      const set = new Set(ids);
      const ordered = pendingOrder.filter((id) => set.has(id));
      const extras = ids.filter((id) => !pendingOrder.includes(id));
      childrenByParent.set(key, [...ordered, ...extras]);
    } else {
      ids.sort((a, b) => (byId.get(a)!.sortOrder ?? 0) - (byId.get(b)!.sortOrder ?? 0));
    }
  }

  const movedIds = new Set(Object.keys(pending.parentMoves));
  const reorderedParents = new Set(Object.keys(pending.siblingOrders));

  const build = (parentId: string | null): CategoryNode[] => {
    const ids = childrenByParent.get(parentKeyOf(parentId)) ?? [];
    return ids.map((id) => {
      const f = byId.get(id)!;
      return {
        id: f.id,
        name: f.name,
        slug: f.slug,
        description: f.description,
        isActive: f.isActive,
        parentId: f.parentId,
        hasPendingMove: movedIds.has(id),
        hasPendingReorder: reorderedParents.has(parentKeyOf(f.parentId)),
        children: build(id),
      };
    });
  };

  return build(null);
}

export function flattenNodes(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children.length) flattenNodes(n.children, out);
  }
  return out;
}

/**
 * 후손 ID 집합 — 드래그 시 자기 자신의 후손에게는 drop 할 수 없다는 순환 참조
 * 가드를 위해 사용.
 */
export function descendantIdsOf(node: CategoryNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: CategoryNode) => {
    for (const c of n.children) {
      out.add(c.id);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function findNode(nodes: CategoryNode[], id: string): CategoryNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return undefined;
}
