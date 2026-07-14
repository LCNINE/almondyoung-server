'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdjustStock } from '@/lib/services/inventory';
import { StockAdjustForm } from '@/features/inventory/components/stock-adjust-form';
import type { StockSummaryDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  row: StockSummaryDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AdjustStockDialog({ row, open, onOpenChange }: Props) {
  const adjustMutation = useAdjustStock();

  const handleSubmit = async (delta: number, reason: string) => {
    if (!row) return;
    try {
      await adjustMutation.mutateAsync({
        skuId: row.skuId,
        warehouseId: row.warehouseId,
        delta,
        reason,
      });
      toast.success('재고가 조정되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('재고 조정에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>재고 조정 — {row?.skuName}</DialogTitle>
        </DialogHeader>

        {row && (
          <p className="text-sm text-muted-foreground">
            창고: <span className="text-foreground">{row.warehouseName}</span>
          </p>
        )}

        <StockAdjustForm
          currentQuantity={row?.currentQuantity ?? null}
          pending={adjustMutation.isPending}
          resetKey={`${open}|${row?.skuId ?? ''}|${row?.warehouseId ?? ''}`}
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
