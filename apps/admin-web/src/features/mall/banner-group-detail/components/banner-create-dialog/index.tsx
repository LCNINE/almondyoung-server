'use client';

import { useState } from 'react';
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
import { BANNER_IMAGE_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import {
  useBannerGroup,
  useBannersByGroup,
  useCreateBanner,
} from '@/lib/services/products';
import type { CreateBannerDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';

import { HERO_GROUP_CODE } from '../../banner-image-guide';
import { BannerListFields, heroListError } from '../banner-list-fields';
import { BannerImageDrop } from '../banner-image-drop';
import { BannerPreviewDialog } from '../banner-preview-dialog';

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
  const { data: group } = useBannerGroup(groupId);
  const { data: siblings = [] } = useBannersByGroup(groupId);

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

  const handleClose = () => {
    setForm({ title: '', isActive: true });
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.pcImageFileId || !form.mobileImageFileId) {
      toast.error('배너 이미지를 올려 주세요.');
      return;
    }
    if (!form.title?.trim()) {
      toast.error('배너 이름을 입력해 주세요.');
      return;
    }
    // 히어로는 한 장이라도 리스트 칸이 비면 스토어프론트가 캐러셀로 되돌아간다 (ADR-0036 §4)
    const listError = isHero ? heroListError(form) : null;
    if (listError) {
      toast.error(listError);
      return;
    }
    /** 목록 맨 뒤에 붙인다 — 순서는 목록의 위/아래 버튼으로 바꾼다 */
    const sortOrder =
      siblings.reduce((max, b) => Math.max(max, b.sortOrder ?? 0), -1) + 1;
    try {
      await createMutation.mutateAsync({
        ...form,
        sortOrder,
        bannerGroupId: groupId,
      });
      toast.success('배너가 추가되었습니다.');
      handleClose();
    } catch {
      toast.error('추가에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>배너 추가</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <BannerImageDrop
            contextId={BANNER_IMAGE_CONTEXT_ID}
            pcSlot={pcSlot}
            mobileSlot={mobileSlot}
            pcImageFileId={form.pcImageFileId}
            mobileImageFileId={form.mobileImageFileId}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />

          {isHero && (
            <BannerListFields
              idPrefix="b"
              value={form}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            />
          )}

          <Input
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="배너 이름 (관리용)"
            className="h-11"
          />

          <Input
            value={form.linkUrl ?? ''}
            onChange={(e) =>
              setForm((p) => ({ ...p, linkUrl: e.target.value || undefined }))
            }
            placeholder="링크 주소 (선택)"
            className="h-11"
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
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            추가
          </Button>
        </DialogFooter>
      </DialogContent>

      <BannerPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={form.title || '새 배너'}
        pcImageFileId={form.pcImageFileId}
        mobileImageFileId={form.mobileImageFileId}
        pcSlot={pcSlot}
        mobileSlot={mobileSlot}
        showList={isHero}
        listImageFileId={form.listImageFileId}
        listLabel={form.listLabel}
      />
    </Dialog>
  );
}
