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
import { useCreateHolder, useUpdateHolder } from '@/lib/services/inventory';
import type { HolderDto, CreateHolderRequest } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editRow?: HolderDto | null;
};

const EMPTY_FORM: CreateHolderRequest = { name: '', isOurAsset: false };

export function HolderFormDialog({ open, onOpenChange, editRow }: Props) {
  const isEdit = !!editRow;
  const [form, setForm] = useState<CreateHolderRequest>(EMPTY_FORM);

  const createMutation = useCreateHolder();
  const updateMutation = useUpdateHolder();

  useEffect(() => {
    if (editRow) {
      setForm({ name: editRow.name, isOurAsset: editRow.isOurAsset });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [editRow, open]);

  const handleClose = () => {
    setForm(EMPTY_FORM);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('소유자명을 입력해 주세요.');
      return;
    }
    try {
      if (isEdit && editRow) {
        await updateMutation.mutateAsync({ id: editRow.id, data: form });
        toast.success('소유자 정보가 수정되었습니다.');
      } else {
        await createMutation.mutateAsync(form);
        toast.success('소유자가 등록되었습니다.');
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
          <DialogTitle>{isEdit ? '소유자 수정' : '소유자 등록'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="holder-name">소유자명 *</Label>
            <Input
              id="holder-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="소유자명"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="is-our-asset"
              type="checkbox"
              checked={form.isOurAsset}
              onChange={(e) => setForm((prev) => ({ ...prev, isOurAsset: e.target.checked }))}
              className="size-4 rounded border"
            />
            <Label htmlFor="is-our-asset">자사 재고</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (isEdit ? '수정 중...' : '등록 중...') : isEdit ? '수정' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
