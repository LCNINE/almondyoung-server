'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  useBannersByGroup,
  useUpdateBannerGroup,
} from '@/lib/services/products';
import type { BannerGroupDto } from '@/lib/types/dto/products';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { toast } from 'sonner';

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

  const activeCount = banners.filter((b) => b.isActive).length;
  const slots = Array.from({ length: THUMB_SLOTS }, (_, i) => banners[i]);

  const handleToggle = async (checked: boolean) => {
    try {
      await updateMutation.mutateAsync({
        id: group.id,
        dto: { isActive: checked },
      });
    } catch {
      toast.error('표시 상태를 바꾸지 못했습니다.');
    }
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
        <Switch
          checked={group.isActive}
          disabled={updateMutation.isPending}
          onCheckedChange={handleToggle}
          aria-label={`${group.title} 표시 상태`}
        />
      </div>
    </div>
  );
}
