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
import { useUpdateTagGroup } from '@/lib/services/products';
import type { TagGroupDto, UpdateTagGroupDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  group: TagGroupDto | null;
  onOpenChange: (open: boolean) => void;
};

export function GroupEditDialog({ open, group, onOpenChange }: Props) {
  const [form, setForm] = useState<UpdateTagGroupDto>({});
  const updateMutation = useUpdateTagGroup();

  useEffect(() => {
    if (group) {
      setForm({
        name: group.name,
        description: group.description ?? undefined,
        displayOrder: group.displayOrder ?? undefined,
        isActive: group.isActive,
      });
    }
  }, [group]);

  const set =
    (key: keyof UpdateTagGroupDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  const handleClose = () => {
    setForm({});
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!group) return;
    if (!form.name?.trim()) {
      toast.error('그룹명을 입력해 주세요.');
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: group.id, dto: form });
      toast.success('태그 그룹이 수정되었습니다.');
      handleClose();
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>태그 그룹 편집</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="tge-name">
              그룹명 <span className="text-destructive">*</span>
            </Label>
            <Input id="tge-name" value={form.name ?? ''} onChange={set('name')} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tge-description">설명</Label>
            <Input
              id="tge-description"
              value={form.description ?? ''}
              onChange={set('description')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tge-displayOrder">표시 순서</Label>
            <Input
              id="tge-displayOrder"
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
              id="tge-isActive"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isActive: checked }))
              }
            />
            <Label htmlFor="tge-isActive">활성</Label>
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
