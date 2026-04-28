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
import { useCreateBannerGroup } from '@/lib/services/products';
import type { CreateBannerGroupDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: CreateBannerGroupDto = { code: '', title: '', isActive: true };

export function BannerGroupCreateDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState<CreateBannerGroupDto>(EMPTY);
  const createMutation = useCreateBannerGroup();

  const set =
    (key: keyof CreateBannerGroupDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  const setNum =
    (key: keyof CreateBannerGroupDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({
        ...prev,
        [key]: e.target.value ? Number(e.target.value) : undefined,
      }));

  const handleClose = () => {
    setForm(EMPTY);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.code?.trim()) {
      toast.error('코드를 입력해 주세요.');
      return;
    }
    if (!form.title?.trim()) {
      toast.error('제목을 입력해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync(form);
      toast.success('배너 그룹이 생성되었습니다.');
      handleClose();
    } catch {
      toast.error('생성에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>배너 그룹 생성</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="code">
              코드 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="code"
              placeholder="예: MAIN_TOP"
              value={form.code}
              onChange={set('code')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="title">
              제목 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              placeholder="배너 그룹 제목"
              value={form.title}
              onChange={set('title')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="category">카테고리</Label>
            <Input
              id="category"
              placeholder="예: main, event"
              value={form.category ?? ''}
              onChange={set('category')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description">설명</Label>
            <Input
              id="description"
              value={form.description ?? ''}
              onChange={set('description')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>PC 사이즈 (px)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="너비"
                  value={form.pcWidth ?? ''}
                  onChange={setNum('pcWidth')}
                />
                <Input
                  type="number"
                  placeholder="높이"
                  value={form.pcHeight ?? ''}
                  onChange={setNum('pcHeight')}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>모바일 사이즈 (px)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="너비"
                  value={form.mobileWidth ?? ''}
                  onChange={setNum('mobileWidth')}
                />
                <Input
                  type="number"
                  placeholder="높이"
                  value={form.mobileHeight ?? ''}
                  onChange={setNum('mobileHeight')}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sortOrder">정렬순서</Label>
            <Input
              id="sortOrder"
              type="number"
              value={form.sortOrder ?? ''}
              onChange={setNum('sortOrder')}
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="isActive"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isActive: checked }))
              }
            />
            <Label htmlFor="isActive">활성</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
