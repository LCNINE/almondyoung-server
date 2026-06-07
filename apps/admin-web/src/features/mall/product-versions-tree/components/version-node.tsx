'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import type { VersionStatus } from '@/lib/types/dto/products';

export type VersionNodeData = {
  version: number;
  status: VersionStatus;
  createdAt: string;
  isCurrent: boolean;
  onSelect: () => void;
};

const STATUS_META = {
  active: {
    label: 'active',
    badgeVariant: 'default',
    nodeClassName: 'border-primary border-2',
  },
  draft: {
    label: 'draft',
    badgeVariant: 'secondary',
    nodeClassName: 'border-primary/60 border-dashed',
  },
  inactive: {
    label: 'inactive',
    badgeVariant: 'outline',
    nodeClassName: 'border-border',
  },
} satisfies Record<
  VersionStatus,
  {
    label: string;
    badgeVariant: 'default' | 'secondary' | 'outline';
    nodeClassName: string;
  }
>;

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function VersionNode({ data }: NodeProps & { data: VersionNodeData }) {
  const { version, status, createdAt, isCurrent, onSelect } = data;
  const meta = STATUS_META[status];

  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex h-[76px] w-[160px] cursor-pointer flex-col justify-between rounded-md border bg-white px-3 py-2 shadow-sm transition-colors hover:bg-gray-50',
        meta.nodeClassName,
        isCurrent && 'ring-2 ring-blue-400 ring-offset-2',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">v{version}</span>
        <Badge variant={meta.badgeVariant} className="text-[10px]">
          {meta.label}
        </Badge>
      </div>
      <div className="text-xs text-gray-500">{formatDate(createdAt)}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}
