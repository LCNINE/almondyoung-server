'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCancelInbound } from '@/lib/services/inventory';
import type { InboundReceiptLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  line: InboundReceiptLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CancelDialog({ line, open, onOpenChange }: Props) {
  const mutation = useCancelInbound();

  const blockedByAction = line
    ? line.putawayFromOriginQty > 0 || line.returnedQty > 0
    : false;

  const handleSubmit = async () => {
    if (!line) return;
    try {
      await mutation.mutateAsync({ lineId: line.id, quantity: line.quantity });
      toast.success('입고가 취소되었습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '입고 취소에 실패했습니다.');
    }
  };

  if (!line) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>입고 취소</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {blockedByAction && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              적치 또는 회송 이력이 있어 취소할 수 없습니다.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            취소는 <strong>당일</strong> 내, <strong>전체 수량({line.quantity}개)</strong>만 가능합니다.
            적치·회송 이력이 없어야 합니다.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={mutation.isPending || blockedByAction}
          >
            {mutation.isPending ? '처리 중…' : '취소 확인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
