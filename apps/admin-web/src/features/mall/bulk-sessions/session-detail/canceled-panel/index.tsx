// src/features/mall/bulk-sessions/session-detail/canceled-panel/index.tsx
// 세션이 canceled 인 뒤 남은 임시 데이터를 정리하는 패널.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { parseServerError } from '@/lib/api/server-error';
import { usePurgeDrafts } from '@/lib/services/products/bulk-session';
import { shouldContinuePurge } from '@/lib/services/products/bulk-session-model';

interface PurgeStats {
  purged: number;
  failed: number;
  remaining: number;
}

export function CanceledPanel({ sessionId }: { sessionId: string }) {
  const purgeDrafts = usePurgeDrafts(sessionId);
  const [purging, setPurging] = useState(false);
  const [stats, setStats] = useState<PurgeStats | null>(null);

  async function handlePurge() {
    setPurging(true);
    let purged = 0;
    let failed = 0;
    try {
      // remaining===0 또는 purged===0(진전 없음)까지 반복한다. 후자가 없으면
      // 영구 실패 행 앞에서 영원히 돈다.
      for (;;) {
        const result = await purgeDrafts.mutateAsync();
        purged += result.purged;
        failed += result.failed;
        setStats({ purged, failed, remaining: result.remaining });
        if (!shouldContinuePurge(result)) break;
      }
    } catch (error) {
      toast.error(
        parseServerError(error, '정리 중 오류가 발생했습니다.').message
      );
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        <p>발행된 적 있는 행과 제외된 행은 건드리지 않습니다.</p>
        <p>수정 행은 임시 버전만, 신규 행은 상품까지 함께 지웁니다.</p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={purging}
          onClick={() => {
            void handlePurge();
          }}
        >
          {purging && <Spinner size="sm" data-icon="inline-start" />}
          임시 데이터 정리
        </Button>
        {stats && (
          <p className="text-sm text-muted-foreground">
            정리 {stats.purged}건 · 정리 실패 {stats.failed}건 · 남음{' '}
            {stats.remaining}건
          </p>
        )}
      </div>
    </div>
  );
}
