'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateColumn, useUpdateColumn } from '@/lib/services/inventory';
import type { LocationColumnDto, CreateColumnRequest } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  editRow?: LocationColumnDto | null;
};

export function ColumnFormDialog({ open, onOpenChange, warehouseId, editRow }: Props) {
  const isEdit = !!editRow;
  const [columnName, setColumnName] = useState('');
  const [displayOrder, setDisplayOrder] = useState('');

  const createMutation = useCreateColumn();
  const updateMutation = useUpdateColumn();

  useEffect(() => {
    if (editRow) {
      setColumnName(editRow.columnName);
      setDisplayOrder(editRow.displayOrder !== null ? String(editRow.displayOrder) : '');
    } else {
      setColumnName('');
      setDisplayOrder('');
    }
  }, [editRow, open]);

  const handleClose = () => {
    setColumnName('');
    setDisplayOrder('');
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!columnName.trim()) {
      toast.error('열 이름을 입력해 주세요.');
      return;
    }
    const data: CreateColumnRequest = {
      columnName: columnName.trim(),
      displayOrder: displayOrder !== '' ? Number(displayOrder) : undefined,
    };
    try {
      if (isEdit && editRow) {
        await updateMutation.mutateAsync({ columnId: editRow.id, data });
        toast.success('열 정보가 수정되었습니다.');
      } else {
        await createMutation.mutateAsync({ warehouseId, data });
        toast.success('열이 생성되었습니다.');
      }
      handleClose();
    } catch {
      toast.error(isEdit ? '수정에 실패했습니다.' : '생성에 실패했습니다.');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? '열 수정' : '새 열 생성'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="column-name">열 이름 *</Label>
            <Input
              id="column-name"
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
              placeholder="예: A"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="display-order">정렬 순서</Label>
            <Input
              id="display-order"
              type="number"
              min="0"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (isEdit ? '수정 중...' : '생성 중...') : isEdit ? '수정' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
