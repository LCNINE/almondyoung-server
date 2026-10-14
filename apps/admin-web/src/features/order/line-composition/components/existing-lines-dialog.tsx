'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { lineCompositionClient } from '@/lib/api/domains/orders/line-composition.client';
import { parseServerError } from '@/lib/api/server-error';
import { useApplyToExistingLines } from '@/lib/services/orders/line-composition';
import { applyResultText, existingLinesStep, type ExistingLinesStepView } from '../line-composition-view';

type FollowUp = { variantId: string; step: ExistingLinesStepView };

/** 상품매칭 저장 뒤 이미 굳힌 출고에 미칠 영향을 묻고, 바꿀 것이 있을 때만 단계를 연다(스펙 §8-3) */
export function useExistingLinesFollowUp() {
  const [state, setState] = useState<FollowUp | null>(null);
  const check = useCallback(async (variantId: string) => {
    try {
      const step = existingLinesStep(await lineCompositionClient.existingLinesImpact(variantId));
      if (step) setState({ variantId, step });
    } catch (error) {
      // 상품매칭 저장은 이미 끝났다 — 미리보기 실패로 저장을 실패처럼 보이게 하지 않는다
      console.error('기존 출고 영향 조회 실패:', error);
    }
  }, []);
  const close = useCallback(() => setState(null), []);
  return { state, check, close };
}

/** 부모가 state 가 있을 때만 렌더한다 — 열릴 때마다, 그리고 variantId 가 바뀔 때마다(부모가 key 로) 새로 마운트돼 mutation 상태가 새지 않는다 */
export function ExistingLinesDialog({ state, onClose }: { state: FollowUp; onClose: () => void }) {
  const apply = useApplyToExistingLines();

  const onApply = async () => {
    try {
      const result = await apply.mutateAsync(state.variantId);
      toast.success(applyResultText(result));
      onClose();
    } catch (error) {
      toast.error(parseServerError(error, '기존 출고에 적용하지 못했습니다.').message);
    }
  };

  return (
    // 적용 중 닫으면 끝난 결과가 다른 열림에 닿는다
    <Dialog open onOpenChange={(open) => !open && !apply.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>기존 출고에도 적용</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {state.step.counts.map((entry) => (
            <span key={entry.label}>
              {entry.label} <span className="font-semibold tabular-nums">{entry.count}</span>
            </span>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            닫기
          </Button>
          <Button onClick={onApply} disabled={apply.isPending}>
            기존 출고에도 적용
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
