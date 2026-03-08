'use client';

import { X } from 'lucide-react';
import type { TraceLink } from '@/lib/api/domains/events';

interface NodeDetailPanelProps {
  resourceType: string;
  resourceId: string;
  links: TraceLink[];
  onClose: () => void;
  className?: string;
}

function DirectionBadge({ direction }: { direction: 'CAUSE' | 'EFFECT' }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
        direction === 'CAUSE'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-green-100 text-green-700'
      }`}
    >
      {direction}
    </span>
  );
}

export function NodeDetailPanel({
  resourceType,
  resourceId,
  links,
  onClose,
  className,
}: NodeDetailPanelProps) {
  const groupedByChain = links.reduce<Record<string, TraceLink[]>>((acc, link) => {
    if (!acc[link.chainId]) acc[link.chainId] = [];
    acc[link.chainId].push(link);
    return acc;
  }, {});

  return (
    <div className={`flex flex-col bg-white border-l border-gray-200 overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase">{resourceType}</p>
          <p className="font-mono text-sm text-gray-900 break-all">{resourceId}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 hover:bg-gray-100"
          aria-label="패널 닫기"
        >
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {Object.entries(groupedByChain).map(([chainId, chainLinks]) => (
          <div key={chainId}>
            <p className="mb-1 font-mono text-xs text-gray-400 truncate" title={chainId}>
              chain: {chainId.slice(0, 16)}…
            </p>
            <div className="space-y-2">
              {chainLinks.map((link) => (
                <div key={link.id} className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <DirectionBadge direction={link.direction} />
                    <span className="text-xs font-medium text-gray-700">{link.eventType}</span>
                    {link.action && (
                      <span className="text-xs text-gray-500">{link.action}</span>
                    )}
                  </div>
                  {link.serviceName && (
                    <p className="mt-1 text-xs text-gray-400">{link.serviceName}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    {new Date(link.createdAt).toLocaleString('ko-KR')}
                  </p>
                  {link.description && (
                    <p className="mt-1 text-xs text-gray-500 italic">{link.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {links.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">이벤트 데이터 없음</p>
        )}
      </div>
    </div>
  );
}
