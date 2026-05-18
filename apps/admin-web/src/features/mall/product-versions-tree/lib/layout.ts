import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';

export type NodeSize = { width: number; height: number };

const DEFAULTS = {
  version: { width: 160, height: 76 },
  group: { width: 160, height: 64 },
} satisfies Record<'version' | 'group', NodeSize>;

/**
 * dagre top-down 레이아웃을 react-flow Node 좌표에 반영한다.
 * 노드 width/height 는 노드 type 에 따라 결정 (version vs group).
 */
export function layoutTopDown(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 56 });

  for (const node of nodes) {
    const size = node.type === 'collapsed-group' ? DEFAULTS.group : DEFAULTS.version;
    g.setNode(node.id, { width: size.width, height: size.height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const size = node.type === 'collapsed-group' ? DEFAULTS.group : DEFAULTS.version;
    return {
      ...node,
      // dagre 는 center 좌표를 주므로 left-top 으로 변환
      position: { x: pos.x - size.width / 2, y: pos.y - size.height / 2 },
    };
  });
}
