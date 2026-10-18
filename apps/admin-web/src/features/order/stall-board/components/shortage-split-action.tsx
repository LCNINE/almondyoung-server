'use client';

import type { MouseEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ReserveShortageView,
  arrivalLabel,
  canSplitShortage,
  splitUnreservedErrorText,
} from '@/lib/api/domains/orders/order-progress.shape';
import { parseServerError } from '@/lib/api/server-error';
import { useSplitUnreservedShipment } from '@/lib/services/orders/mutations';

/**
 * 예약 줄의 «있는 것 먼저» — 예약된 몫은 그대로 보내고 모자란 몫만 새 상자로 뗀다(#1016 15번).
 * 합포장은 다른 주문 라인이 섞여 있어 FO 상세에서만 나눈다.
 */
export function ShortageSplitAction(props: { shortage: ReserveShortageView }) {
  const { shortage } = props;
  const split = useSplitUnreservedShipment();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  // 다이얼로그를 열 때 한 번 정한다 — 응답을 못 받고 다시 눌러도 같은 키라 서버가 한 번만 나눈다
  const [idempotencyKey, setIdempotencyKey] = useState('');
  // 다이얼로그는 포털이어도 React 트리로는 이 span 의 자손이라 클릭이 표 행으로 버블된다
  const stop = (e: MouseEvent) => e.stopPropagation();

  if (!canSplitShortage(shortage)) {
    return (
      <span className="text-xs text-muted-foreground">
        합포장 — FO 상세에서
      </span>
    );
  }

  const submit = () => {
    if (!reason.trim()) {
      toast.error('사유를 입력하세요.');
      return;
    }
    split.mutate(
      {
        shipmentId: shortage.shipmentId,
        data: {
          expectedManifestVersion: shortage.manifestVersion,
          reason: reason.trim(),
        },
        idempotencyKey,
      },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success('있는 것만 먼저 보냅니다.');
        },
        onError: (error) => {
          const parsed = parseServerError(error, '나누지 못했습니다.');
          // 409 는 행이 낡았다는 뜻 — 훅이 목록을 다시 읽으니 대화상자는 닫는다
          if (parsed.conflict) setOpen(false);
          toast.error(splitUnreservedErrorText(parsed.code, parsed.message));
        },
      }
    );
  };

  return (
    <span className="inline-flex" onClick={stop}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => {
          setReason('');
          setIdempotencyKey(crypto.randomUUID());
          setOpen(true);
        }}
      >
        있는 것 먼저
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>있는 것 먼저 보내기</DialogTitle>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {shortage.items.map((item) => (
              <li key={item.skuId} className="flex justify-between gap-3">
                <span>{item.skuName}</span>
                <span className="tabular-nums">
                  {item.shortQty.toLocaleString('ko-KR')}개
                  {arrivalLabel(item.expectedArrival) && (
                    <span className="ml-2 text-muted-foreground">
                      {arrivalLabel(item.expectedArrival)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            위 품목은 새 상자로 떼어 두고, 나머지만 먼저 보냅니다.
          </p>
          <div className="space-y-1">
            <Label>사유 (필수)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              닫기
            </Button>
            <Button
              disabled={split.isPending || !reason.trim()}
              onClick={submit}
            >
              {split.isPending ? '요청 중...' : '나눠 보내기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
