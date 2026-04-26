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
import { useDeleteSkuGroup } from '@/lib/services/inventory';
import type { SkuGroupResponseDto } from '@/lib/types/dto/inventory';

type Props = {
  group: SkuGroupResponseDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeleteGroupDialog({ group, open, onOpenChange }: Props) {
  const deleteMutation = useDeleteSkuGroup();

  if (!group) return null;

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(group.id);
      toast.success('그룹이 삭제되었습니다. 소속 SKU는 그룹 없음 상태가 됩니다.');
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
          <DialogTitle>그룹 삭제</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{group.name}</span> 그룹을 삭제합니다.
            소속 SKU {group.memberCount}개는 그룹 없음 상태로 전환됩니다.
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
