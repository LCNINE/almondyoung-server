'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUpdateBanner } from '@/lib/services/products';
import type { BannerDto } from '@/lib/types/dto/products';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { toast } from 'sonner';
import { BannerListFields, heroListError } from '../banner-list-fields';

type Props = {
  open: boolean;
  banner: BannerDto | null;
  onOpenChange: (open: boolean) => void;
};

type Draft = { listImageFileId?: string; listLabel?: string };

/**
 * 리스트 칸만 고치는 다이얼로그.
 *
 * 배너 기본 정보와 섞지 않는다 — 운영자가 리스트 문구 한 줄을 바꾸려고 PC/모바일
 * 이미지까지 있는 큰 폼을 열 이유가 없고, 옆에 실물 칸을 같이 보여줘야 「칸 안에서
 * 어떻게 보이는지」를 저장 전에 확인할 수 있다.
 */
export function BannerListDialog({ open, banner, onOpenChange }: Props) {
  const [draft, setDraft] = useState<Draft>({});
  const updateMutation = useUpdateBanner();

  useEffect(() => {
    if (banner) {
      setDraft({
        listImageFileId: banner.listImageFileId ?? undefined,
        listLabel: banner.listLabel ?? undefined,
      });
    }
  }, [banner]);

  if (!banner) return null;

  const handleSave = async () => {
    const error = heroListError({ ...draft, isActive: banner.isActive });
    if (error) {
      toast.error(error);
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: banner.id, dto: draft });
      toast.success('리스트가 저장되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('저장에 실패했습니다.');
    }
  };

  const previewSrc = resolvePublicFileUrl(draft.listImageFileId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>리스트 수정</DialogTitle>
          <DialogDescription>
            {banner.title} — 배너 오른쪽 리스트에 이 배너가 어떻게 보일지 정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2 sm:grid-cols-[1fr_200px]">
          <BannerListFields
            idPrefix="bl"
            value={{ ...draft, isActive: banner.isActive }}
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
          />

          {/* 실제 칸과 같은 규격(180×60)으로 그려 저장 전에 확인시킨다 */}
          <div>
            <p className="text-muted-foreground mb-2 text-xs">고객 화면에서</p>
            <div className="overflow-hidden border border-[#e4e4e7] bg-white shadow-[0_4px_5px_rgba(0,0,0,0.3)]">
              <div className="h-[60px] border border-transparent bg-[#f4f4f5]" />
              <div className="border-primary flex h-[60px] items-center gap-2 border px-[14px]">
                <span className="line-clamp-2 flex-1 text-sm leading-tight font-bold break-keep">
                  {draft.listLabel || (
                    <span className="text-muted-foreground font-normal">노출문구</span>
                  )}
                </span>
                {previewSrc ? (
                  // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewSrc} alt="" className="h-12 w-12 shrink-0 object-contain" />
                ) : (
                  <div className="bg-muted h-12 w-12 shrink-0" />
                )}
              </div>
              <div className="h-[60px] border border-transparent bg-[#f4f4f5]" />
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              위아래 회색은 다른 배너 자리입니다.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            className="bg-[#f29219] hover:bg-[#df7b00]"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
