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
import { useCreateTagGroup } from '@/lib/services/products';
import type { CreateTagGroupDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: CreateTagGroupDto = { name: '', isActive: true };

export function GroupCreateDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState<CreateTagGroupDto>(EMPTY);
  const createMutation = useCreateTagGroup();

  const set =
    (key: keyof CreateTagGroupDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  const handleClose = () => {
    setForm(EMPTY);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      toast.error('그룹명을 입력해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync(form);
      toast.success('태그 그룹이 생성되었습니다.');
      handleClose();
    } catch {
      toast.error('생성에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>태그 그룹 추가</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="tg-name">
              그룹명 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tg-name"
              placeholder="예: 소재, 색상, 시즌"
              value={form.name}
              onChange={set('name')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tg-description">설명</Label>
            <Input
              id="tg-description"
              value={form.description ?? ''}
              onChange={set('description')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tg-displayOrder">표시 순서</Label>
            <Input
              id="tg-displayOrder"
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
              id="tg-isActive"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isActive: checked }))
              }
            />
            <Label htmlFor="tg-isActive">활성</Label>
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
