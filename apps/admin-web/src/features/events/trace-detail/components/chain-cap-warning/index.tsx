'use client';

import { AlertTriangle } from 'lucide-react';

interface ChainCapWarningProps {
  totalChainCount: number;
  maxChains: number;
}

export function ChainCapWarning({ totalChainCount, maxChains }: ChainCapWarningProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span>
        총 {totalChainCount.toLocaleString()}개 chain 중 최근 활동 기준 상위 {maxChains}개만
        표시됩니다.
      </span>
    </div>
  );
}
