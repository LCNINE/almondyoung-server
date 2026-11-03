'use client';

import { Button } from '@/components/ui/button';
import type { MergePair } from './waybill-issue-model';

type MergeWarningProps = {
  pairs: readonly MergePair[];
  onMerge: (pair: MergePair) => void;
  onDismiss: () => void;
};

export function MergeWarning({ pairs, onMerge, onDismiss }: MergeWarningProps) {
  if (pairs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {pairs.map((pair) => (
        <div
          key={pair.key}
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <div>
            <p className="font-semibold">
              먼저 확인해 주세요. 고른 상자 중 {pair.shipmentIds.length}개는
              같은 곳으로 가요
            </p>
            <p className="text-sm">
              {pair.labels.join(', ')} 상자를 합치면 송장 한 장으로 보낼 수
              있어요. 지금 발급하면 나중에 합칠 때 송장을 취소해야 해요.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => onMerge(pair)}>합치기</Button>
            <Button variant="outline" onClick={onDismiss}>
              따로 발급
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
