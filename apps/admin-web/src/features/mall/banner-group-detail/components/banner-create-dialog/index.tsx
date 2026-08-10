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
import { ImageUploadField } from '@/components/common/image-upload-field';
import { BANNER_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import { useCreateBanner } from '@/lib/services/products';
import type { CreateBannerDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  groupId: string;
  onOpenChange: (open: boolean) => void;
};

export function BannerCreateDialog({ open, groupId, onOpenChange }: Props) {
  const [form, setForm] = useState<Omit<CreateBannerDto, 'bannerGroupId'>>({
    title: '',
    isActive: true,
  });
  const createMutation = useCreateBanner();

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  const handleClose = () => {
    setForm({ title: '', isActive: true });
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.title?.trim()) {
      toast.error('제목을 입력해 주세요.');
      return;
    }
    // 두 이미지 모두 서버에서 필수다 — 없이 보내면 저장 시점에 실패한다.
    if (!form.pcImageFileId || !form.mobileImageFileId) {
      toast.error('PC / 모바일 이미지를 모두 업로드해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync({ ...form, bannerGroupId: groupId });
      toast.success('배너가 추가되었습니다.');
      handleClose();
    } catch {
      toast.error('추가에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>배너 추가</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="b-title">
              제목 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="b-title"
              value={form.title}
              onChange={set('title')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="b-description">설명</Label>
            <Input
              id="b-description"
              value={form.description ?? ''}
              onChange={set('description')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="b-linkUrl">링크 URL</Label>
            <Input
              id="b-linkUrl"
              placeholder="https://"
              value={form.linkUrl ?? ''}
              onChange={set('linkUrl')}
            />
          </div>

          <ImageUploadField
            label="PC 이미지"
            required
            previewShape="wide"
            contextId={BANNER_IMAGE_CONTEXT_ID}
            value={form.pcImageFileId}
            onChange={(fileId) =>
              setForm((prev) => ({ ...prev, pcImageFileId: fileId ?? undefined }))
            }
          />

          <ImageUploadField
            label="모바일 이미지"
            required
            previewShape="wide"
            contextId={BANNER_IMAGE_CONTEXT_ID}
            value={form.mobileImageFileId}
            onChange={(fileId) =>
              setForm((prev) => ({ ...prev, mobileImageFileId: fileId ?? undefined }))
            }
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="b-displayStartAt">노출 시작일</Label>
              <Input
                id="b-displayStartAt"
                type="datetime-local"
                value={form.displayStartAt ?? ''}
                onChange={set('displayStartAt')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-displayEndAt">노출 종료일</Label>
              <Input
                id="b-displayEndAt"
                type="datetime-local"
                value={form.displayEndAt ?? ''}
                onChange={set('displayEndAt')}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="b-sortOrder">정렬순서</Label>
            <Input
              id="b-sortOrder"
              type="number"
              value={form.sortOrder ?? ''}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  sortOrder: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="b-isActive"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isActive: checked }))
              }
            />
            <Label htmlFor="b-isActive">활성</Label>
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
