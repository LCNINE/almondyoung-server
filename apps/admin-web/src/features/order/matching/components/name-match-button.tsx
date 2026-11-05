'use client';

import { useState } from 'react';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useApplyNameMatch,
  useNameMatchPreview,
} from '@/lib/services/matching';

type Progress = {
  resolved: number;
  remaining: number;
  failed: Map<string, string>;
  done: boolean;
  error: boolean;
};

export function NameMatchButton() {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const preview = useNameMatchPreview(open && !progress);
  const apply = useApplyNameMatch();
  const running = !!progress && !progress.done;

  const changeOpen = (next: boolean) => {
    if (running) return;

    if (next) setProgress(null);

    setOpen(next);
  };

  // 서버가 한 번에 조금씩만 연결하므로 남은 건이 없거나 한 건도 못 연결할 때까지 이어서 부른다
  const run = async () => {
    const state: Progress = {
      resolved: 0,
      remaining: preview.data?.candidates ?? 0,
      failed: new Map(),
      done: false,
      error: false,
    };

    setProgress({ ...state });

    try {
      for (;;) {
        const batch = await apply.mutateAsync();

        state.resolved += batch.resolved;
        state.remaining = batch.skipped;
        batch.failed.forEach((f) => state.failed.set(f.matchingId, f.reason));
        setProgress({ ...state, failed: new Map(state.failed) });

        if (batch.skipped === 0 || batch.resolved === 0) break;
      }
    } catch {
      state.error = true;
    }

    setProgress({ ...state, failed: new Map(state.failed), done: true });
  };

  return (
    <Can run={useApplyNameMatch}>
      <Button
        variant="default"
        size="sm"
        className="bg-orange-500 hover:bg-orange-600"
        onClick={() => changeOpen(true)}
      >
        전부 새로 매칭하기
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>이름으로 자동 연결해요</DialogTitle>
            <DialogDescription>
              이름이 똑같은 재고상품이 하나뿐인 상품만 연결해요.
            </DialogDescription>
          </DialogHeader>
          {progress ? (
            <div role="status">
              <p>
                {progress.resolved}건 연결했어요
                {progress.done
                  ? ` · 실패 ${progress.failed.size}건`
                  : ` · 남은 ${progress.remaining}건을 이어서 연결하고 있어요`}
              </p>
              {progress.error && (
                <p role="alert">
                  중간에 연결 결과를 받지 못했어요. 창을 닫고 목록을 확인한 뒤
                  다시 실행해 주세요.
                </p>
              )}
              {progress.failed.size > 0 && (
                <ul className="mt-3 max-h-60 overflow-auto text-sm">
                  {[...progress.failed].map(([matchingId, reason]) => (
                    <li key={matchingId}>
                      {matchingId}: {reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              {preview.isFetching && (
                <p role="status">연결할 상품을 확인하고 있어요.</p>
              )}
              {preview.isError && (
                <p role="alert">
                  미리보기를 불러오지 못했어요. 창을 닫고 다시 시도해 주세요.
                </p>
              )}
              {preview.data && !preview.isFetching && !preview.isError && (
                <>
                  <p>
                    이름이 똑같은 재고상품이 하나뿐인 {preview.data.candidates}
                    건을 자동으로 연결해요. 주문이 기다리는 건{' '}
                    {preview.data.waitingOrderCandidates}건이에요.
                  </p>
                  <ul
                    aria-label="연결 예시"
                    className="max-h-60 space-y-2 overflow-auto text-sm"
                  >
                    {preview.data.sample.map((candidate) => (
                      <li key={candidate.matchingId}>
                        {candidate.productName} {candidate.optionName} →{' '}
                        {candidate.skuName}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={running}
              onClick={() => changeOpen(false)}
            >
              닫기
            </Button>
            {!progress && (
              <Button
                disabled={
                  !preview.data?.candidates ||
                  preview.isFetching ||
                  preview.isError
                }
                onClick={run}
              >
                연결하기
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Can>
  );
}
