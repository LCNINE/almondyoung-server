'use client';

// src/features/mall/quarantine/components/quarantine-detail-dialog/index.tsx
// 격리 건 하나의 상세 — 라인별 사유/조치 안내, 매핑 생성(채널 리스팅 다이얼로그 재사용),
// 재처리. "격리 확인 → 매핑 생성 → 재처리" 한 바퀴가 이 다이얼로그 안에서 끝나야 한다.

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { actionForCause, replayResultMessage } from '../../guidance';
import { useReplayFailure } from '@/lib/services/channel/mutations';
import { ChannelListingFormDialog } from '@/features/mall/channel-listings/components/channel-listing-form-dialog';
import type { OrderCollectionFailureDto } from '@/lib/api/domains/channel/order-collection-failures.client';

type Props = {
  failure: OrderCollectionFailureDto | null;
  onClose: () => void;
};

export function QuarantineDetailDialog({ failure, onClose }: Props) {
  const replay = useReplayFailure();
  // 매핑 생성 중인 라인의 channelItemId 프리필. 라인마다 값이 다를 수 있으므로 라인 단위로 연다.
  const [createListingItemId, setCreateListingItemId] = useState<string | null>(
    null
  );

  const lines = failure?.affectedLines;

  const handleResolved = async () => {
    if (!failure) return;
    try {
      const result = await replay.mutateAsync(failure.id);
      // 응답 모양이 예상과 다르면 `result` 가 null 이다 — 그때도 문구는 나가야 한다
      // (`replayResultMessage` 가 모르는 값에 폴백을 준다).
      toast(replayResultMessage(result?.status ?? ''));
      onClose();
    } catch {
      toast.error('재처리 요청에 실패했습니다. 잠시 후 다시 시도하세요.');
    }
  };

  return (
    <>
      <Dialog
        open={!!failure}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-w-lg">
          {failure && (
            <>
              <DialogHeader>
                <DialogTitle>{failure.externalOrderId}</DialogTitle>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                {/* 옛 행에는 라인별 사유가 없다. 이건 정상 상태이므로 빈 화면이 아니라 설명을 렌더한다. */}
                {!lines || lines.length === 0 ? (
                  <p className="text-muted-foreground">
                    사유 정보가 없는 옛 격리입니다. 원본을 확인해 직접
                    매핑하세요.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {lines.map((line) => {
                      const guidance = actionForCause(line.cause);
                      return (
                        <li
                          key={line.lineId}
                          className="border-b pb-3 last:border-0 last:pb-0"
                        >
                          <div className="font-medium">
                            {line.lineId} — {guidance.label}
                          </div>
                          <p className="text-muted-foreground">
                            {guidance.description}
                          </p>
                          {guidance.action === 'create-listing' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2"
                              onClick={() =>
                                setCreateListingItemId(
                                  line.channelProductId ?? ''
                                )
                              }
                            >
                              매핑 생성
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={onClose}>
                  닫기
                </Button>
                <Button onClick={handleResolved} disabled={replay.isPending}>
                  {replay.isPending ? '재처리 중…' : '조치 완료 — 재처리'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {failure && (
        <ChannelListingFormDialog
          open={createListingItemId !== null}
          onOpenChange={(open) => {
            if (!open) setCreateListingItemId(null);
          }}
          defaultChannelCode={failure.channel}
          defaultChannelItemId={createListingItemId ?? ''}
          onCreated={() => {
            // 저장 → 자동 재처리. 매핑이 생겼으니 굳이 다시 "조치 완료" 버튼을 누르게 하지 않는다.
            setCreateListingItemId(null);
            void handleResolved();
          }}
        />
      )}
    </>
  );
}
