'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BANNER_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import { useBannerGroup, useUpdateBanner } from '@/lib/services/products';
import type { BannerDto, UpdateBannerDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

import { HERO_GROUP_CODE } from '../../banner-image-guide';
import { BannerImageDrop } from '../banner-image-drop';
import { BannerPreviewDialog } from '../banner-preview-dialog';

type Props = {
  open: boolean;
  banner: BannerDto | null;
  groupId: string;
  onOpenChange: (open: boolean) => void;
};

export function BannerEditDialog({
  open,
  banner,
  groupId,
  onOpenChange,
}: Props) {
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

  const isHero = group?.code === HERO_GROUP_CODE;
  const [previewOpen, setPreviewOpen] = useState(false);
  const canPreview = !!(form.pcImageFileId || form.mobileImageFileId);

  useEffect(() => {
    if (banner) {
      setForm({
        pcImageFileId: banner.pcImageFileId ?? undefined,
        mobileImageFileId: banner.mobileImageFileId ?? undefined,
      });
    }
  }, [banner]);

  const handleClose = () => {
    setForm({});
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!banner) return;
    if (!form.pcImageFileId || !form.mobileImageFileId) {
      toast.error('배너 이미지를 올려 주세요.');
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: banner.id, dto: form });
      toast.success('배너 이미지가 바뀌었습니다.');
      handleClose();
    } catch {
      toast.error('수정에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>배너 이미지 바꾸기</DialogTitle>
          <DialogDescription>{banner?.title ?? ''}</DialogDescription>
        </DialogHeader>

        <div className="py-1">
          <BannerImageDrop
            contextId={BANNER_IMAGE_CONTEXT_ID}
            pcSlot={pcSlot}
            mobileSlot={mobileSlot}
            pcImageFileId={form.pcImageFileId}
            mobileImageFileId={form.mobileImageFileId}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            disabled={!canPreview}
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="mr-1 h-4 w-4" />
            미리보기
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
        title={banner?.title ?? '배너'}
        pcImageFileId={form.pcImageFileId}
        mobileImageFileId={form.mobileImageFileId}
        pcSlot={pcSlot}
        mobileSlot={mobileSlot}
        showList={isHero}
        listImageFileId={banner?.listImageFileId}
        listLabel={banner?.listLabel}
      />
    </Dialog>
  );
}
