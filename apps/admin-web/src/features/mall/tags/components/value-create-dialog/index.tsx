'use client';

import { useState } from 'react';
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
import { useCreateTagValue } from '@/lib/services/products';
import type { CreateTagValueDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  groupId: string;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: CreateTagValueDto = { name: '', isActive: true };

export function ValueCreateDialog({ open, groupId, onOpenChange }: Props) {
  const [form, setForm] = useState<CreateTagValueDto>(EMPTY);
  const createMutation = useCreateTagValue();

  const handleClose = () => {
    setForm(EMPTY);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      toast.error('태그 값 이름을 입력해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync({ groupId, dto: form });
      toast.success('태그 값이 추가되었습니다.');
      handleClose();
    } catch {
      toast.error('추가에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>태그 값 추가</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="tv-name">
              이름 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tv-name"
              placeholder="예: 면, 폴리에스터, 블랙"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tv-displayOrder">표시 순서</Label>
            <Input
              id="tv-displayOrder"
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
              id="tv-isActive"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isActive: checked }))
              }
            />
            <Label htmlFor="tv-isActive">활성</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
