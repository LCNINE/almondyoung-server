// src/features/mall/bulk-sessions/session-detail/failed-panel.tsx
// 세션이 failed 인 동안 보여줄 패널. 이 phase 는 취소로만 벗어난다(스펙 §3.2) — 재시도·
// 재개 버튼을 두지 않는다. 상단 헤더가 이미 [세션 취소] 버튼과 phaseError 배너를
// 보여주므로, 이 패널은 그 사실을 다시 짚어 재시도 기대를 차단하는 역할만 한다.

'use client';

import type { BulkSessionProgress } from '@/lib/types/dto/bulk-session';

export function FailedPanel({ progress }: { progress: BulkSessionProgress }) {
  return (
    <div className="rounded-lg border p-6 text-sm text-muted-foreground">
      <p>세션이 오류로 실패했습니다.</p>
      {progress.phaseError && (
        <p role="alert" className="mt-2 text-destructive">
          {progress.phaseError}
        </p>
      )}
      <p className="mt-2">
        이 상태는 재시도나 재개로 풀리지 않습니다. 상단의 [세션 취소] 로만
        정리할 수 있습니다.
      </p>
    </div>
  );
}
