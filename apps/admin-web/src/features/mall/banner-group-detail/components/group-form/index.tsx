'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUpdateBannerGroup } from '@/lib/services/products';
import type { BannerGroupDto, UpdateBannerGroupDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

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

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}
