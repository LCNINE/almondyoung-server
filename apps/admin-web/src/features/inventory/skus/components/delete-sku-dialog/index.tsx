'use client';

import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteSku } from '@/lib/services/inventory';
import type { SkuResponseDto } from '@/lib/types/dto/inventory';

type Props = {
  sku: SkuResponseDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeleteSkuDialog({ sku, open, onOpenChange }: Props) {
  const deleteMutation = useDeleteSku();

  if (!sku) return null;

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(sku.id);
      toast.success('SKU가 삭제되었습니다.');
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? '삭제에 실패했습니다.';
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>SKU 삭제</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{sku.code}</span> SKU를 삭제합니다.
            재고가 남아있으면 삭제가 불가합니다. 삭제 후에는 복구할 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? '삭제 중…' : '삭제'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
