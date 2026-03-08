'use client';

import '@xyflow/react/dist/style.css';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

import { useResourceEvents, eventQueryKeys } from '@/lib/services/events';
import { traceClient, type TraceLink } from '@/lib/api/domains/events';
import { buildGraph, MAX_CHAINS, type ResourceNodeData } from '../utils/build-graph';
import { applyDagreLayout } from '../utils/apply-dagre-layout';
import { nodeTypes } from '../components/resource-node';
import { NodeDetailPanel } from '../components/node-detail-panel';
import { ChainCapWarning } from '../components/chain-cap-warning';

interface EventTraceDetailTemplateProps {
  resourceType: string;
  resourceId: string;
}

export default function EventTraceDetailTemplate({
  resourceType,
  resourceId,
}: EventTraceDetailTemplateProps) {
  const queryClient = useQueryClient();
  const rfInstance = useReactFlow();
  const hasRendered = useRef(false);

  const [allLinks, setAllLinks] = useState<TraceLink[]>([]);
  const [expandedResources, setExpandedResources] = useState<Set<string>>(
    () => new Set([`${resourceType}:${resourceId}`])
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadingResources, setLoadingResources] = useState<Set<string>>(new Set());

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ResourceNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Load seed resource events
  const { data, isFetching } = useResourceEvents(resourceType, resourceId);

  useEffect(() => {
    if (!data) return;
    const newLinks = data.services
      .filter((s) => s.status === 'fulfilled')
      .flatMap((s) => s.links ?? []);
    setAllLinks(newLinks);
  }, [data]);

  // Progressive expand
  const handleExpand = useCallback(
    async (resType: string, resId: string) => {
      const key = `${resType}:${resId}`;
      if (expandedResources.has(key) || loadingResources.has(key)) return;
      setLoadingResources((prev) => new Set([...prev, key]));
      try {
        const result = await queryClient.fetchQuery({
          queryKey: eventQueryKeys.resourceEvents(resType, resId),
          queryFn: () => traceClient.getResourceEvents(resType, resId),
          staleTime: 30_000,
        });
        const newLinks = result.services
          .filter((s) => s.status === 'fulfilled')
          .flatMap((s) => s.links ?? []);
        setAllLinks((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const fresh = newLinks.filter((l) => !existingIds.has(l.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
        setExpandedResources((prev) => new Set([...prev, key]));
      } finally {
        setLoadingResources((prev) => {
          const n = new Set(prev);
          n.delete(key);
          return n;
        });
      }
    },
    [expandedResources, loadingResources, queryClient]
  );

  // Build graph from allLinks
  const { nodes: builtNodes, edges: builtEdges, chainsCapped, totalChainCount } = useMemo(
    () => buildGraph(allLinks, resourceType, resourceId, expandedResources),
    [allLinks, resourceType, resourceId, expandedResources]
  );

  // Apply layout and inject onExpand callback
  useEffect(() => {
    if (builtNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const laidOut = applyDagreLayout(builtNodes, builtEdges);
    const withCallbacks = laidOut.map((n) => ({
      ...n,
      data: { ...n.data, onExpand: handleExpand },
    }));

    setNodes(withCallbacks);
    setEdges(builtEdges);

    if (hasRendered.current) {
      setTimeout(() => rfInstance.fitView({ padding: 0.2, duration: 300 }), 50);
    } else {
      hasRendered.current = true;
    }
  }, [builtNodes, builtEdges, handleExpand, rfInstance, setNodes, setEdges]);

  const handleNodeClick: NodeMouseHandler<Node<ResourceNodeData>> = useCallback(
    (_event, node) => {
      setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
    },
    []
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const isLoading = isFetching || loadingResources.size > 0;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-200">
        <Link
          href="/events/trace"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          목록
        </Link>
        <div className="h-4 w-px bg-gray-300" />
        <div>
          <span className="text-xs font-medium text-gray-500 uppercase mr-2">{resourceType}</span>
          <span className="font-mono text-sm text-gray-900">{resourceId}</span>
        </div>
      </div>

      {chainsCapped && (
        <div className="px-6 py-2">
          <ChainCapWarning totalChainCount={totalChainCount} maxChains={MAX_CHAINS} />
        </div>
      )}

      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>

        {allLinks.length === 0 && !isFetching && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-gray-400">이벤트 데이터 없음</p>
          </div>
        )}

        {selectedNode && (
          <NodeDetailPanel
            resourceType={selectedNode.data.resourceType}
            resourceId={selectedNode.data.resourceId}
            links={selectedNode.data.links}
            onClose={() => setSelectedNodeId(null)}
            className="absolute right-0 top-0 h-full w-80 z-10"
          />
        )}

        {isLoading && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-md border border-gray-200 z-10">
            <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
            <span className="text-xs text-gray-600">로딩 중...</span>
          </div>
        )}
      </div>
    </div>
  );
}
