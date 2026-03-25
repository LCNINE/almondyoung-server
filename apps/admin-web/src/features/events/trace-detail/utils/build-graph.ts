import type { Node, Edge } from '@xyflow/react';
import type { TraceLink } from '@/lib/api/domains/events';

export const MAX_CHAINS = 20;

export interface ResourceNodeData extends Record<string, unknown> {
  resourceType: string;
  resourceId: string;
  isSeed: boolean;
  isExpanded: boolean;
  latestAction: string | null;
  latestServiceName: string | null;
  latestCreatedAt: string | null;
  links: TraceLink[];
  onExpand?: (resourceType: string, resourceId: string) => void;
}

export interface BuildGraphResult {
  nodes: Node<ResourceNodeData>[];
  edges: Edge[];
  chainsCapped: boolean;
  totalChainCount: number;
}

export function buildGraph(
  allLinks: TraceLink[],
  seedResourceType: string,
  seedResourceId: string,
  expandedResources: Set<string>
): BuildGraphResult {
  // STEP 1 — Chain Cap
  const chainLastSeen = new Map<string, string>();
  for (const link of allLinks) {
    const existing = chainLastSeen.get(link.chainId);
    if (!existing || link.createdAt > existing) {
      chainLastSeen.set(link.chainId, link.createdAt);
    }
  }

  const sortedChainIds = [...chainLastSeen.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([id]) => id);

  const totalChainCount = sortedChainIds.length;
  const chainsCapped = totalChainCount > MAX_CHAINS;
  const allowedChainIds = new Set(sortedChainIds.slice(0, MAX_CHAINS));

  // STEP 2 — Filter
  const filteredLinks = allLinks.filter((l) => allowedChainIds.has(l.chainId));

  // STEP 3 — Group by (chainId, eventId)
  const groups = new Map<string, { cause?: TraceLink; effects: TraceLink[] }>();
  for (const link of filteredLinks) {
    const key = `${link.chainId}::${link.eventId}`;
    if (!groups.has(key)) groups.set(key, { effects: [] });
    const group = groups.get(key)!;
    if (link.direction === 'CAUSE') {
      group.cause = link;
    } else {
      group.effects.push(link);
    }
  }

  // STEP 4 — Collect resource nodes
  const nodeMap = new Map<
    string,
    { links: TraceLink[]; latestCreatedAt: string }
  >();
  for (const link of filteredLinks) {
    const nodeKey = `${link.resourceType}:${link.resourceId}`;
    const existing = nodeMap.get(nodeKey);
    if (!existing) {
      nodeMap.set(nodeKey, { links: [link], latestCreatedAt: link.createdAt });
    } else {
      existing.links.push(link);
      if (link.createdAt > existing.latestCreatedAt) {
        existing.latestCreatedAt = link.createdAt;
      }
    }
  }

  // STEP 5 — Build edges
  const edgeMap = new Map<string, Edge>();
  for (const group of groups.values()) {
    if (!group.cause) continue;
    const sourceKey = `${group.cause.resourceType}:${group.cause.resourceId}`;
    for (const effect of group.effects) {
      const targetKey = `${effect.resourceType}:${effect.resourceId}`;
      if (sourceKey === targetKey) continue;
      const edgeId = `${sourceKey}->${targetKey}::${effect.eventType}`;
      if (!edgeMap.has(edgeId)) {
        edgeMap.set(edgeId, {
          id: edgeId,
          source: sourceKey,
          target: targetKey,
          label: effect.eventType,
          data: { chainId: group.cause.chainId },
        });
      }
    }
  }

  // STEP 6 — Build node objects
  const seedKey = `${seedResourceType}:${seedResourceId}`;
  const nodes: Node<ResourceNodeData>[] = [];

  for (const [nodeKey, nodeData] of nodeMap.entries()) {
    const [resourceType, ...restId] = nodeKey.split(':');
    const resourceId = restId.join(':');
    const isSeed = nodeKey === seedKey;
    const isExpanded = expandedResources.has(nodeKey);

    const effectLinks = nodeData.links.filter((l) => l.direction === 'EFFECT');
    effectLinks.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    const latestEffect = effectLinks[0] ?? null;

    nodes.push({
      id: nodeKey,
      type: 'resourceNode',
      position: { x: 0, y: 0 },
      data: {
        resourceType,
        resourceId,
        isSeed,
        isExpanded,
        latestAction: latestEffect?.action ?? null,
        latestServiceName: latestEffect?.serviceName ?? null,
        latestCreatedAt: nodeData.latestCreatedAt,
        links: nodeData.links,
      },
    });
  }

  return {
    nodes,
    edges: [...edgeMap.values()],
    chainsCapped,
    totalChainCount,
  };
}
