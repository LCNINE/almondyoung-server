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
import { formatRatio } from '../../../banner-group-detail/banner-image-guide';
import {
  BANNER_GROUP_PRESETS,
  MOBILE_VIEWPORT,
  PC_VIEWPORT,
  matchPreset,
  renderedHeight,
} from '../../banner-group-presets';

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

          <div className="grid gap-1.5">
            <Label>규격 프리셋</Label>
            <div className="flex flex-wrap gap-2">
              {BANNER_GROUP_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant={
                    matchPreset(form)?.label === preset.label ? 'default' : 'outline'
                  }
                  size="sm"
                  title={preset.hint}
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      pcWidth: preset.pcWidth,
                      pcHeight: preset.pcHeight,
                      mobileWidth: preset.mobileWidth,
                      mobileHeight: preset.mobileHeight,
                    }))
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {matchPreset(form)?.hint ??
                '자리에 맞는 프리셋을 고르면 아래 사이즈가 채워집니다'}
            </p>
            <p className="text-muted-foreground text-xs">
              입력하는 숫자는 <strong className="font-medium">비율</strong>입니다 —
              1920×480 은 &ldquo;4:1 로 그려라&rdquo;는 뜻이고, 실제 높이는 화면 폭에
              따라 정해집니다 ({PC_VIEWPORT}px 화면이면 360px).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>
                PC 비율
                {form.pcWidth && form.pcHeight ? (
                  <span className="text-muted-foreground ml-1 font-normal">
                    {formatRatio(form.pcWidth, form.pcHeight)} → 실제{' '}
                    {renderedHeight(form.pcWidth, form.pcHeight, PC_VIEWPORT)}px
                  </span>
                ) : null}
              </Label>
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
              <Label>
                모바일 비율
                {form.mobileWidth && form.mobileHeight ? (
                  <span className="text-muted-foreground ml-1 font-normal">
                    {formatRatio(form.mobileWidth, form.mobileHeight)} → 실제{' '}
                    {renderedHeight(
                      form.mobileWidth,
                      form.mobileHeight,
                      MOBILE_VIEWPORT,
                    )}
                    px
                  </span>
                ) : null}
              </Label>
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
