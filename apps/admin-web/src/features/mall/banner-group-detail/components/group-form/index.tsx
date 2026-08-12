'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUpdateBannerGroup } from '@/lib/services/products';
import type { BannerGroupDto, UpdateBannerGroupDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { formatRatio } from '../../banner-image-guide';
import {
  BANNER_GROUP_PRESETS,
  MOBILE_VIEWPORT,
  PC_VIEWPORT,
  matchPreset,
  renderedHeight,
} from '../../../banner-groups/banner-group-presets';

type Props = {
  group: BannerGroupDto;
};

export function GroupForm({ group }: Props) {
  const [form, setForm] = useState<UpdateBannerGroupDto>({});
  const updateMutation = useUpdateBannerGroup();

  useEffect(() => {
    setForm({
      title: group.title,
      category: group.category ?? undefined,
      description: group.description ?? undefined,
      pcWidth: group.pcWidth ?? undefined,
      pcHeight: group.pcHeight ?? undefined,
      mobileWidth: group.mobileWidth ?? undefined,
      mobileHeight: group.mobileHeight ?? undefined,
      sortOrder: group.sortOrder ?? undefined,
      isActive: group.isActive,
    });
  }, [group]);

  const set =
    (key: keyof UpdateBannerGroupDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  const setNum =
    (key: keyof UpdateBannerGroupDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({
        ...prev,
        [key]: e.target.value ? Number(e.target.value) : undefined,
      }));

  const handleSave = async () => {
    if (!form.title?.trim()) {
      toast.error('제목을 입력해 주세요.');
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: group.id, dto: form });
      toast.success('배너 그룹이 수정되었습니다.');
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  return (
    <div className="p-6">
      <div className="grid gap-4 max-w-2xl">
        <div className="grid gap-1.5">
          <Label htmlFor="title">
            제목 <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            value={form.title ?? ''}
            onChange={set('title')}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="category">카테고리</Label>
          <Input
            id="category"
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
                variant={matchPreset(form)?.label === preset.label ? 'default' : 'outline'}
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
            입력하는 숫자는 <strong className="font-medium">비율</strong>입니다 —
            1920×480 은 &ldquo;4:1 로 그려라&rdquo;는 뜻이고, 실제 높이는 화면 폭에 따라
            정해집니다 ({PC_VIEWPORT}px 화면이면 360px).
          </p>
          <p className="text-muted-foreground text-xs">
            프리셋은 아래 입력칸만 채웁니다 —{' '}
            <strong className="font-medium">저장해야</strong> 미리보기와
            스토어프론트에 반영됩니다.
          </p>
          <p className="text-muted-foreground text-xs">
            ⚠️ 규격을 바꾸면 기존 배너 이미지가 새 비율로 잘려 보입니다. 저장한 뒤
            소속 배너를 미리보기로 확인하세요.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label>
              PC 비율
              {form.pcWidth && form.pcHeight ? (
                <span className="text-muted-foreground ml-1 font-normal">
                  {formatRatio(form.pcWidth, form.pcHeight)} → 실제{' '}
                  {renderedHeight(form.pcWidth, form.pcHeight, PC_VIEWPORT)}px 높이
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
                  {renderedHeight(form.mobileWidth, form.mobileHeight, MOBILE_VIEWPORT)}px
                  높이
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

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}
