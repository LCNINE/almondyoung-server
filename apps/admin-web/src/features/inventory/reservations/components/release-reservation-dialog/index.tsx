'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useReleaseReservation } from '@/lib/services/inventory';
import type { ReservationDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  row: ReservationDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReleaseReservationDialog({ row, open, onOpenChange }: Props) {
  const releaseMutation = useReleaseReservation();

  const handleRelease = async () => {
    if (!row) return;
    try {
      await releaseMutation.mutateAsync(row.id);
      toast.success('예약이 해제되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('예약 해제에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>예약 해제</DialogTitle>
        </DialogHeader>

        {row && (
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">
              예약 ID:{' '}
              <span className="font-mono text-foreground">{row.id.slice(0, 8)}…</span>
            </p>
            <p className="text-muted-foreground">
              SKU ID:{' '}
              <span className="font-mono text-foreground">{row.skuId.slice(0, 8)}…</span>
            </p>
            <p className="text-muted-foreground">
              수량:{' '}
              <span className="tabular-nums text-foreground">
                {row.quantity.toLocaleString('ko-KR')}
              </span>
            </p>
          </div>
        )}

        <p className="text-sm text-muted-foreground">이 예약을 해제하면 재고가 다시 할당 가능한 상태가 됩니다. 계속하시겠습니까?</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={handleRelease}
            disabled={releaseMutation.isPending}
          >
            {releaseMutation.isPending ? '해제 중...' : '해제'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
