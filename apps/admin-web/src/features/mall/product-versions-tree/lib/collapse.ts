import type { MasterVersionDto } from '@/lib/types/dto/products';

export type CollapsedGroup = {
  id: string;
  parentId: string;
  tailId: string;
  versions: MasterVersionDto[];
};

export type CollapseResult = {
  visibleVersions: MasterVersionDto[];
  groups: CollapsedGroup[];
  edges: Array<{ source: string; target: string }>;
};

const MIN_GROUP_SIZE = 2;
const DEFAULT_INCLUDE_STATUSES = ['active', 'inactive', 'draft'] satisfies Array<
  MasterVersionDto['status']
>;

type WalkContext = {
  byId: Map<string, MasterVersionDto>;
  includeStatuses: Set<MasterVersionDto['status']>;
  currentVersionId: string | null;
};

function isExpandedAnchor(node: MasterVersionDto, ctx: WalkContext): boolean {
  const visibleChildren = node.children.filter((c) => ctx.includeStatuses.has(c.status));
  if (visibleChildren.length === 0) return true;
  if (visibleChildren.length >= 2) return true;
  if (node.status === 'active') return true;
  if (ctx.currentVersionId && node.id === ctx.currentVersionId) return true;
  return false;
}

/**
 * 분기점 사이의 자식=1 비-anchor 노드들의 chain 을 하나의 묶음으로 접는다.
 * - 분기점(anchor) = (visible children ≥ 2) OR root OR leaf OR status='active' OR id===currentVersionId.
 * - 묶음 최소 크기 = 2. 1이면 그냥 펼친다.
 * - includeStatuses 에 없는 노드는 트리에서 제외 (자식 카운트에서도 빼고 계산).
 */
export function collapseTree(
  roots: MasterVersionDto[],
  options: {
    includeStatuses?: Array<MasterVersionDto['status']>;
    currentVersionId?: string | null;
  } = {},
): CollapseResult {
  const includeStatuses = new Set<MasterVersionDto['status']>(
    options.includeStatuses ?? DEFAULT_INCLUDE_STATUSES,
  );
  const currentVersionId = options.currentVersionId ?? null;

  const byId = new Map<string, MasterVersionDto>();
  const indexAll = (nodes: MasterVersionDto[]) => {
    for (const n of nodes) {
      byId.set(n.id, n);
      indexAll(n.children);
    }
  };
  indexAll(roots);

  const ctx: WalkContext = { byId, includeStatuses, currentVersionId };

  const visibleRoots = roots.filter((r) => includeStatuses.has(r.status));

  const visibleVersions: MasterVersionDto[] = [];
  const groups: CollapsedGroup[] = [];
  const edges: Array<{ source: string; target: string }> = [];

  const visit = (node: MasterVersionDto) => {
    visibleVersions.push(node);

    const visibleChildren = node.children.filter((c) => includeStatuses.has(c.status));

    for (const child of visibleChildren) {
      const chain: MasterVersionDto[] = [];
      let cur: MasterVersionDto | null = child;
      while (cur && !isExpandedAnchor(cur, ctx)) {
        chain.push(cur);
        const nextVisible: MasterVersionDto[] = cur.children.filter((c) =>
          includeStatuses.has(c.status),
        );
        cur = nextVisible.length === 1 ? nextVisible[0] : null;
      }
      // cur 가 null 인 케이스는 isExpandedAnchor 정의상 발생하지 않음 (visible children 0 → anchor).
      const anchor = cur!;

      if (chain.length >= MIN_GROUP_SIZE) {
        const group: CollapsedGroup = {
          id: `group:${node.id}->${anchor.id}`,
          parentId: node.id,
          tailId: anchor.id,
          versions: chain,
        };
        groups.push(group);
        edges.push({ source: node.id, target: group.id });
        edges.push({ source: group.id, target: anchor.id });
      } else {
        // chain 0 or 1 → 모두 visible 로 펼침
        let prevId = node.id;
        for (const link of chain) {
          visibleVersions.push(link);
          edges.push({ source: prevId, target: link.id });
          prevId = link.id;
        }
        edges.push({ source: prevId, target: anchor.id });
      }

      visit(anchor);
    }
  };

  for (const root of visibleRoots) {
    visit(root);
  }

  return { visibleVersions, groups, edges };
}
