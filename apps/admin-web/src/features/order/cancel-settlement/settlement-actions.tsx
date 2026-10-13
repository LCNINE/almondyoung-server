'use client';

import type { MouseEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MANUAL_REFUND_CONFIRM_TEXT,
  SettlementView,
  asksAlreadyRefunded,
  parseAlreadyRefunded,
  settlementActionsOf,
} from '@/lib/api/domains/orders/cancel-request.shape';
import { useManualRefundCancelSettlement, useRetryCancelSettlement } from '@/lib/services/orders/mutations';
import { usePermissionCheck } from '@/hooks/use-permission';

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** 정산 중 채널 취소의 운영자 조치 — 정체 보드 행과 주문 내역 취소 칸이 같이 쓴다(#1016 36번 재설계 §8.1) */
export function SettlementActions(props: { salesOrderId: string; settlement: SettlementView }) {
  const { canRun } = usePermissionCheck();
  const settlementActions = settlementActionsOf(props.settlement);
  const actions = {
    retry: settlementActions.retry && canRun(useRetryCancelSettlement),
    manualRefund: settlementActions.manualRefund && canRun(useManualRefundCancelSettlement),
  };
  const retry = useRetryCancelSettlement();
  const manual = useManualRefundCancelSettlement();
  const [confirming, setConfirming] = useState(false);
  // 채널이 «이미 환불한 금액»을 물었으면 다시 시도는 금액을 받아야만 다른 결과가 난다(#1016 37번)
  const asksAmount = asksAlreadyRefunded(props.settlement);
  const [askingAmount, setAskingAmount] = useState(false);
  const [amountText, setAmountText] = useState('');
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
          onClick={() => {
            if (asksAmount) {
              setAmountText('');
              setAskingAmount(true);
              return;
            }
            retry.mutate(target, {
              onSuccess: () => toast.success('정산을 다시 시도합니다.'),
              onError: (e) => toast.error(errorText(e, '다시 시도하지 못했습니다.')),
            });
          }}
        >
          다시 시도
        </Button>
      )}
      {actions.manualRefund && (
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirming(true)}>
          계좌 송금으로 환불
        </Button>
      )}
      <Dialog open={askingAmount} onOpenChange={setAskingAmount}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이미 환불한 금액을 적어 다시 시도</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{props.settlement.lastFailure?.message}</p>
          <div className="space-y-1">
            <Label>이번 취소 품목에 이미 돌려준 금액(원)</Label>
            <Input inputMode="numeric" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="없으면 0" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAskingAmount(false)}>
              닫기
            </Button>
            <Button
              disabled={retry.isPending}
              onClick={() => {
                const amount = parseAlreadyRefunded(amountText);
                if (amount === null) {
                  toast.error('이미 환불한 금액을 0 이상의 숫자로 적어 주세요 (없으면 0)');
                  return;
                }
                retry.mutate(
                  { ...target, alreadyRefundedAmount: amount },
                  {
                    onSuccess: () => {
                      toast.success('정산을 다시 시도합니다.');
                      setAskingAmount(false);
                    },
                    onError: (e) => toast.error(errorText(e, '다시 시도하지 못했습니다.')),
                  },
                );
              }}
            >
              다시 시도
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                    toast.success('계좌 송금으로 바꿨습니다. 송금 뒤 환불 내역에서 완료 처리해 주세요.');
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
