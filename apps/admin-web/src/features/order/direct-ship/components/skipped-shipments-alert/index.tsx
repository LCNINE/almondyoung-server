'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import type { HandoffOutcome } from '../../lib/handoff-outcome';

/** 받는 분 정보가 빠져 시트에 싣지 않은 상자 — 넘김·다시 받기가 같이 쓴다 */
export function SkippedShipmentsAlert({ skipped }: { skipped: HandoffOutcome['skipped'] }) {
  if (!skipped) return null;
  return (
    <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <AlertDescription>
        <p>{skipped.message}</p>
        <ul className="mt-1 font-mono text-xs">
          {skipped.shipmentIds.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
