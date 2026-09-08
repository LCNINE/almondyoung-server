'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  useBannersByGroup,
  useUpdateBannerGroup,
} from '@/lib/services/products';
import type { BannerGroupDto } from '@/lib/types/dto/products';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { toast } from 'sonner';
import { ActiveSwitch } from '@/components/common/active-switch';


/** 시안(Figma 10:40814) 실측 */
const THUMB_SLOTS = 3;
const CARD_W = 101;
const CARD_H = 87;
const CARD_OVERLAP = 52;
const STACK_W = CARD_W + CARD_OVERLAP * (THUMB_SLOTS - 1);

const EMPTY_SLOT_BG = {
  backgroundImage: [
    'linear-gradient(to top right, transparent calc(50% - 0.5px), #e4e4e7 50%, transparent calc(50% + 0.5px))',
    'linear-gradient(to bottom right, transparent calc(50% - 0.5px), #e4e4e7 50%, transparent calc(50% + 0.5px))',
  ].join(', '),
};

type Props = {
  group: BannerGroupDto;
};

export function BannerGroupRow({ group }: Props) {
  const { data: banners = [] } = useBannersByGroup(group.id);
  const updateMutation = useUpdateBannerGroup();

  const [confirmOff, setConfirmOff] = useState(false);

  const activeCount = banners.filter((b) => b.isActive).length;
  const slots = Array.from({ length: THUMB_SLOTS }, (_, i) => banners[i]);

  const apply = async (checked: boolean) => {
    try {
      await updateMutation.mutateAsync({
        id: group.id,
        dto: { isActive: checked },
      });
    } catch {
      toast.error('표시 상태를 바꾸지 못했습니다.');
    }
  };

  /** 끄면 그룹째로 고객 화면에서 내려가므로 한 번 더 묻는다. 켜는 건 바로 적용 */
  const handleToggle = (checked: boolean) => {
    if (checked) apply(true);
    else setConfirmOff(true);
  };

  return (
    <div className="grid grid-cols-[210px_1fr_120px_100px] items-center gap-6 border-b border-[#f0f0f2] bg-white px-6 py-4 last:border-b-0">
      <div className="relative" style={{ width: STACK_W, height: CARD_H }}>
        {slots.map((banner, i) => {
          const src = resolvePublicFileUrl(banner?.pcImageFileId);
          return (
            <div
              key={banner?.id ?? `empty-${i}`}
              className="absolute top-0 overflow-hidden border border-[#e4e4e7] bg-white"
              style={{
                left: i * CARD_OVERLAP,
                width: CARD_W,
                height: CARD_H,
                zIndex: THUMB_SLOTS - i,
                ...(src ? {} : EMPTY_SLOT_BG),
              }}
            >
              {src && (
                // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  className={`h-full w-full object-contain ${banner?.isActive ? '' : 'opacity-35 grayscale'}`}
                />
              )}
            </div>
          );
        })}
        {banners.length > 0 && (
          <span
            className="absolute bottom-0 left-0 bg-[#9ca3af] px-1.5 py-0.5 text-[10px] font-medium text-white"
            style={{ zIndex: THUMB_SLOTS + 1 }}
          >
            {activeCount}/{banners.length}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <Link
          href={`/mall/banner-groups/${group.id}`}
          className="block truncate text-[15px] font-bold text-[#1f2937] hover:underline"
        >
          {group.title}
        </Link>
        {group.description && (
          <p className="text-muted-foreground mt-0.5 truncate text-[13px]">
            {group.description}
          </p>
        )}
      </div>

      <div className="text-center">
        <Button
          variant="outline"
          size="sm"
          asChild
          className="h-9 rounded-full border-[#e4e4e7] bg-white px-6"
        >
          <Link href={`/mall/banner-groups/${group.id}`}>수정</Link>
        </Button>
      </div>

      <div className="flex justify-center">
        <ActiveSwitch
          checked={group.isActive}
          disabled={updateMutation.isPending}
          onCheckedChange={handleToggle}
          aria-label={`${group.title} 표시 상태`}
        />
      </div>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>다시 한번 확인해 주세요</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{group.title}</strong> 그룹을 쇼핑몰에서 숨깁니다.
              {activeCount > 0 &&
                ` 현재 활성화중인 배너 ${activeCount}장이 바로 숨겨집니다.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => apply(false)}
              className="bg-[#f29219] hover:bg-[#df7b00]"
            >
              내리기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
