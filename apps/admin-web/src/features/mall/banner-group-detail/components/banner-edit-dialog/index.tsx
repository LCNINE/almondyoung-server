'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ImageUploadField } from '@/components/common/image-upload-field';
import { BANNER_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import { useBannerGroup, useUpdateBanner } from '@/lib/services/products';
import type { BannerDto, UpdateBannerDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { bannerImageGuide } from '../../banner-image-guide';
import { BannerPreviewDialog } from '../banner-preview-dialog';

type Props = {
  open: boolean;
  banner: BannerDto | null;
  groupId: string;
  onOpenChange: (open: boolean) => void;
};

export function BannerEditDialog({ open, banner, groupId, onOpenChange }: Props) {
  const [form, setForm] = useState<UpdateBannerDto>({});
  const updateMutation = useUpdateBanner();
  const { data: group } = useBannerGroup(groupId);

  const pcSlot =
    group?.pcWidth && group?.pcHeight
      ? { width: group.pcWidth, height: group.pcHeight }
      : null;
  const mobileSlot =
    group?.mobileWidth && group?.mobileHeight
      ? { width: group.mobileWidth, height: group.mobileHeight }
      : null;

  const pcGuide = bannerImageGuide(group?.pcWidth, group?.pcHeight);
  const mobileGuide = bannerImageGuide(group?.mobileWidth, group?.mobileHeight);

  const [previewOpen, setPreviewOpen] = useState(false);
  const canPreview = !!(form.pcImageFileId || form.mobileImageFileId);

  useEffect(() => {
    if (banner) {
      setForm({
        title: banner.title,
        description: banner.description ?? undefined,
        pcImageFileId: banner.pcImageFileId ?? undefined,
        mobileImageFileId: banner.mobileImageFileId ?? undefined,
        linkUrl: banner.linkUrl ?? undefined,
        displayStartAt: banner.displayStartAt ?? undefined,
        displayEndAt: banner.displayEndAt ?? undefined,
        isActive: banner.isActive,
        sortOrder: banner.sortOrder ?? undefined,
      });
    }
  }, [banner]);

  const set =
    (key: keyof UpdateBannerDto) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  const handleClose = () => {
    setForm({});
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!banner) return;
    if (!form.title?.trim()) {
      toast.error('제목을 입력해 주세요.');
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: banner.id, dto: form });
      toast.success('배너가 수정되었습니다.');
      handleClose();
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>배너 편집</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="be-title">
              제목 <span className="text-destructive">*</span>
            </Label>
            <Input id="be-title" value={form.title ?? ''} onChange={set('title')} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="be-description">설명</Label>
            <Input
              id="be-description"
              value={form.description ?? ''}
              onChange={set('description')}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="be-linkUrl">링크 URL</Label>
            <Input
              id="be-linkUrl"
              placeholder="https://"
              value={form.linkUrl ?? ''}
              onChange={set('linkUrl')}
            />
          </div>

          <ImageUploadField
            label="PC 이미지"
            required
            previewShape="wide"
            slotRatio={pcSlot}
            targetViewportWidth={1440}
            description={
              pcGuide && (
                <>
                  {pcGuide.spec}
                  <br />
                  {pcGuide.tip}
                </>
              )
            }
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
            slotRatio={mobileSlot}
            previewMaxWidth={390}
            targetViewportWidth={390}
            description={
              mobileGuide && (
                <>
                  {mobileGuide.spec}
                  <br />
                  {mobileGuide.tip}
                </>
              )
            }
            contextId={BANNER_IMAGE_CONTEXT_ID}
            value={form.mobileImageFileId}
            onChange={(fileId) =>
              setForm((prev) => ({ ...prev, mobileImageFileId: fileId ?? undefined }))
            }
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="be-displayStartAt">노출 시작일</Label>
              <Input
                id="be-displayStartAt"
                type="datetime-local"
                value={form.displayStartAt ?? ''}
                onChange={set('displayStartAt')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="be-displayEndAt">노출 종료일</Label>
              <Input
                id="be-displayEndAt"
                type="datetime-local"
                value={form.displayEndAt ?? ''}
                onChange={set('displayEndAt')}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="be-sortOrder">정렬순서</Label>
            <Input
              id="be-sortOrder"
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
              id="be-isActive"
              checked={form.isActive ?? true}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isActive: checked }))
              }
            />
            <Label htmlFor="be-isActive">활성</Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="mr-auto"
            disabled={!canPreview}
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="mr-1 h-4 w-4" />
            화면 미리보기
          </Button>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>

      <BannerPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={form.title || banner?.title || '배너'}
        pcImageFileId={form.pcImageFileId}
        mobileImageFileId={form.mobileImageFileId}
        pcSlot={pcSlot}
        mobileSlot={mobileSlot}
      />
    </Dialog>
  );
}
