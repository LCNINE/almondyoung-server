'use client';

import type { MouseEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  MANUAL_REFUND_CONFIRM_TEXT,
  SettlementView,
  settlementActionsOf,
} from '@/lib/api/domains/orders/cancel-request.shape';
import { useManualRefundCancelSettlement, useRetryCancelSettlement } from '@/lib/services/orders/mutations';

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** 정산 중 채널 취소의 운영자 조치 — 정체 보드 행과 주문 내역 취소 칸이 같이 쓴다(#1016 36번 재설계 §8.1) */
export function SettlementActions(props: { salesOrderId: string; settlement: SettlementView }) {
  const actions = settlementActionsOf(props.settlement);
  const retry = useRetryCancelSettlement();
  const manual = useManualRefundCancelSettlement();
  const [confirming, setConfirming] = useState(false);
  const target = { salesOrderId: props.salesOrderId, requestId: props.settlement.requestId };
  // 다이얼로그는 포털이어도 React 트리로는 이 span 의 자손이라 클릭이 표 행으로 버블된다 — 여기서 한 번에 막는다
  const stop = (e: MouseEvent) => e.stopPropagation();

  if (!actions.retry && !actions.manualRefund) return null;
  return (
    <span className="inline-flex gap-1.5" onClick={stop}>
      {actions.retry && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate(target, {
              onSuccess: () => toast.success('정산을 다시 시도합니다.'),
              onError: (e) => toast.error(errorText(e, '다시 시도하지 못했습니다.')),
            })
          }
        >
          다시 시도
        </Button>
      )}
      {actions.manualRefund && (
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirming(true)}>
          계좌 송금으로 환불
        </Button>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>계좌 송금으로 환불</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{MANUAL_REFUND_CONFIRM_TEXT}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              닫기
            </Button>
            <Button
              disabled={manual.isPending}
              onClick={() =>
                manual.mutate(target, {
                  onSuccess: () => {
                    toast.success('계좌 송금으로 바꿨습니다. 송금 뒤 결제 상세에서 완료 처리해 주세요.');
                    setConfirming(false);
                  },
                  onError: (e) => toast.error(errorText(e, '바꾸지 못했습니다.')),
                })
              }
            >
              계좌 송금으로 환불
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
