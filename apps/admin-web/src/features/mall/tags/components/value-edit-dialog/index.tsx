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
import { Switch } from '@/components/ui/switch';
import { useUpdateTagValue } from '@/lib/services/products';
import type { TagValueDto, UpdateTagValueDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  value: TagValueDto | null;
  groupId: string;
  onOpenChange: (open: boolean) => void;
};

export function ValueEditDialog({ open, value, groupId, onOpenChange }: Props) {
  const [form, setForm] = useState<UpdateTagValueDto>({});
  const updateMutation = useUpdateTagValue();

  useEffect(() => {
    if (value) {
      setForm({
        name: value.name,
        displayOrder: value.displayOrder ?? undefined,
        isActive: value.isActive,
      });
    }
  }, [value]);

  const handleClose = () => {
    setForm({});
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!value) return;
    if (!form.name?.trim()) {
      toast.error('태그 값 이름을 입력해 주세요.');
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: value.id, groupId, dto: form });
      toast.success('태그 값이 수정되었습니다.');
      handleClose();
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>태그 값 편집</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="tve-name">
              이름 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tve-name"
              value={form.name ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tve-displayOrder">표시 순서</Label>
            <Input
              id="tve-displayOrder"
              type="number"
              value={form.displayOrder ?? ''}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  displayOrder: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="tve-isActive"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isActive: checked }))
              }
            />
            <Label htmlFor="tve-isActive">활성</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
