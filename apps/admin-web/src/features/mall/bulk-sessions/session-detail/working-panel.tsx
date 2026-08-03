'use client';

import { Loader2 } from 'lucide-react';
import type { BulkSessionProgress } from '@/lib/types/dto/bulk-session';
import {
  computeDraftingProgress,
  computePublishProgress,
} from '@/lib/services/products/bulk-session-model';

const MESSAGES: Record<string, string> = {
  uploaded: '업로드를 접수했습니다. 곧 검증을 시작합니다…',
  validating: '워크북을 검증하는 중입니다…',
  drafting: '임시 버전을 만드는 중입니다…',
  publishing: '상품을 발행하는 중입니다…',
};

export function WorkingPanel({ progress }: { progress: BulkSessionProgress }) {
  const { done, total } =
    progress.phase === 'publishing'
      ? computePublishProgress(progress)
      : computeDraftingProgress(progress);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border p-10">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {MESSAGES[progress.phase] ?? '처리 중입니다…'}
      </p>
      {total > 0 && (
        <p className="text-sm">
          <strong>{done}</strong> / {total}건
        </p>
      )}
    </div>
  );
}
