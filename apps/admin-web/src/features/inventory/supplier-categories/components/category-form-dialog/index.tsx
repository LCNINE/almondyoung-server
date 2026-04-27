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
import { useCreateSupplierCategory, useUpdateSupplierCategory } from '@/lib/services/inventory';
import type { SupplierCategoryDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editRow?: SupplierCategoryDto | null;
};

export function CategoryFormDialog({ open, onOpenChange, editRow }: Props) {
  const isEdit = !!editRow;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useCreateSupplierCategory();
  const updateMutation = useUpdateSupplierCategory();

  useEffect(() => {
    if (editRow) {
      setName(editRow.name);
      setDescription(editRow.description ?? '');
    } else {
      setName('');
      setDescription('');
    }
  }, [editRow, open]);

  const handleClose = () => {
    setName('');
    setDescription('');
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('분류명을 입력해 주세요.');
      return;
    }
    const data = { name: name.trim(), description: description.trim() || undefined };
    try {
      if (isEdit && editRow) {
        await updateMutation.mutateAsync({ id: editRow.id, data });
        toast.success('분류가 수정되었습니다.');
      } else {
        await createMutation.mutateAsync(data);
        toast.success('분류가 등록되었습니다.');
      }
      handleClose();
    } catch {
      toast.error(isEdit ? '수정에 실패했습니다.' : '등록에 실패했습니다.');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? '분류 수정' : '분류 등록'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">분류명 *</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="분류명"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-desc">설명</Label>
            <Input
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="설명 (선택)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (isEdit ? '수정 중...' : '등록 중...') : isEdit ? '수정' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
