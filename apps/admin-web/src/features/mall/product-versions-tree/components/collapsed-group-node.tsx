'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils/cn';

export type CollapsedGroupNodeData = {
  count: number;
  isOpen: boolean;
  onToggle: () => void;
};

export function CollapsedGroupNode({ data }: NodeProps & { data: CollapsedGroupNodeData }) {
  const { count, isOpen, onToggle } = data;

  return (
    <div
      onClick={onToggle}
      className={cn(
        'relative h-[64px] w-[160px] cursor-pointer',
        'before:absolute before:left-[6px] before:top-[6px] before:h-full before:w-full before:rounded-md before:border before:border-dashed before:border-gray-300 before:bg-white',
        'after:absolute after:left-[3px] after:top-[3px] after:h-full after:w-full after:rounded-md after:border after:border-dashed after:border-gray-300 after:bg-white',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />
      <div
        className={cn(
          'relative z-10 flex h-full w-full items-center justify-center rounded-md border border-dashed bg-white text-sm text-gray-700 transition-colors hover:bg-gray-50',
          isOpen ? 'border-blue-400 text-blue-600' : 'border-gray-400',
        )}
      >
        +{count}개 버전
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}
