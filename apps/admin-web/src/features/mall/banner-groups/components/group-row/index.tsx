'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useBannersByGroup, useUpdateBannerGroup } from '@/lib/services/products';
import type { BannerGroupDto } from '@/lib/types/dto/products';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import { toast } from 'sonner';

/** 시안(Figma 10:40814) — 썸네일 3칸을 보여주고 나머지는 개수로 알린다 */
const THUMB_SLOTS = 3;

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
      await updateMutation.mutateAsync({ id: group.id, dto: { isActive: checked } });
    } catch {
      toast.error('표시 상태를 바꾸지 못했습니다.');
    }
  };

  return (
    <div className="grid grid-cols-[220px_1fr_120px_100px] items-center gap-6 border-b border-[#f0f0f2] bg-white px-6 py-4 last:border-b-0">
      {/* 등록된 배너 */}
      <div className="relative">
        <div className="flex gap-1">
          {slots.map((banner, i) => {
            const src = resolvePublicFileUrl(banner?.pcImageFileId);
            return (
              <div
                key={banner?.id ?? `empty-${i}`}
                className="h-[52px] flex-1 overflow-hidden rounded-[3px] border border-[#e4e4e7] bg-[#f4f4f5]"
              >
                {src && (
                  // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt=""
                    className={`h-full w-full object-cover ${banner?.isActive ? '' : 'opacity-35 grayscale'}`}
                  />
                )}
              </div>
            );
          })}
        </div>
        {banners.length > 0 && (
          <span className="absolute -bottom-1 left-0 rounded-[3px] bg-[#52525b] px-1.5 py-0.5 text-[10px] font-medium text-white">
            {activeCount}/{banners.length}
          </span>
        )}
      </div>

      {/* 그룹 정보 */}
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

      {/* 관리 */}
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

      {/* 표시상태 */}
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
