'use client';

import { useMemo } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useRouter } from 'next/navigation';
import type { MasterVersionDto } from '@/lib/types/dto/products';
import { collapseTree, type CollapsedGroup } from '../lib/collapse';
import { layoutTopDown } from '../lib/layout';
import { VersionNode, type VersionNodeData } from './version-node';
import {
  CollapsedGroupNode,
  type CollapsedGroupNodeData,
} from './collapsed-group-node';

const nodeTypes = {
  version: VersionNode,
  'collapsed-group': CollapsedGroupNode,
};

type Props = {
  masterId: string;
  tree: MasterVersionDto[];
  currentVersionId: string | null;
  openGroupId: string | null;
  onOpenGroup: (group: CollapsedGroup | null) => void;
};

function TreeGraphInner({
  masterId,
  tree,
  currentVersionId,
  openGroupId,
  onOpenGroup,
}: Props) {
  const router = useRouter();

  const { nodes, edges } = useMemo(() => {
    const result = collapseTree(tree, {
      currentVersionId,
    });

    const versionNodes: Node<VersionNodeData>[] = result.visibleVersions.map((v) => ({
      id: v.id,
      type: 'version',
      position: { x: 0, y: 0 },
      data: {
        version: v.version,
        status: v.status,
        createdAt: v.createdAt,
        isCurrent: currentVersionId === v.id,
        onSelect: () =>
          router.push(`/mall/products-list/${masterId}?versionId=${v.id}`),
      },
    }));

    const groupNodes: Node<CollapsedGroupNodeData>[] = result.groups.map((g) => ({
      id: g.id,
      type: 'collapsed-group',
      position: { x: 0, y: 0 },
      data: {
        count: g.versions.length,
        isOpen: openGroupId === g.id,
        onToggle: () => onOpenGroup(openGroupId === g.id ? null : g),
      },
    }));

    const allNodes: Node[] = [...versionNodes, ...groupNodes];
    const allEdges: Edge[] = result.edges.map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
    }));

    return { nodes: layoutTopDown(allNodes, allEdges), edges: allEdges };
  }, [tree, currentVersionId, openGroupId, masterId, router, onOpenGroup]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function TreeGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <TreeGraphInner {...props} />
    </ReactFlowProvider>
  );
}
