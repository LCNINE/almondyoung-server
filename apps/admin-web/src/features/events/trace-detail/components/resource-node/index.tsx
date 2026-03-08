'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ResourceNodeData } from '../../utils/build-graph';
import type { NodeTypes } from '@xyflow/react';

const RESOURCE_TYPE_COLORS: Record<string, string> = {
  ORDER: 'bg-blue-100 text-blue-800',
  PAYMENT: 'bg-green-100 text-green-800',
  CUSTOMER: 'bg-purple-100 text-purple-800',
  PRODUCT: 'bg-yellow-100 text-yellow-800',
  INBOUND: 'bg-teal-100 text-teal-800',
  OUTBOUND: 'bg-teal-100 text-teal-800',
};

function truncateId(id: string): string {
  if (id.length <= 20) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

function ResourceNodeComponent({ data: rawData }: NodeProps) {
  const data = rawData as ResourceNodeData;
  const colorClass = RESOURCE_TYPE_COLORS[data.resourceType] ?? 'bg-gray-100 text-gray-700';

  return (
    <div
      className={`rounded-lg border bg-white px-3 py-2 shadow-sm w-[200px] ${
        data.isSeed ? 'border-blue-500 shadow-md' : 'border-gray-200'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className="space-y-1">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
        >
          {data.resourceType}
        </span>
        <p
          className="font-mono text-xs text-gray-800 truncate"
          title={data.resourceId}
        >
          {truncateId(data.resourceId)}
        </p>
        {data.latestAction && (
          <p className="text-xs text-gray-500">{data.latestAction}</p>
        )}
        {data.latestServiceName && (
          <p className="text-xs text-gray-400 truncate">{data.latestServiceName}</p>
        )}
      </div>

      {!data.isSeed && !data.isExpanded && (
        <button
          className="mt-2 w-full rounded border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600"
          onClick={(e) => {
            e.stopPropagation();
            data.onExpand?.(data.resourceType, data.resourceId);
          }}
        >
          + 확장
        </button>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}

export const ResourceNode = memo(ResourceNodeComponent);

export const nodeTypes: NodeTypes = {
  resourceNode: ResourceNode,
};
