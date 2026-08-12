'use client';

import { useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';

type Slot = { width: number; height: number } | null;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  pcImageFileId?: string | null;
  mobileImageFileId?: string | null;
  pcSlot: Slot;
  mobileSlot: Slot;
};

/**
 * 스토어프론트 화면을 흉내 내어 배너가 실제로 얼마나 차지하는지 보여준다.
 *
 * 슬롯 비율만 보면 "잘리는지"는 알 수 있어도 "화면에서 얼마나 큰지"를 알 수 없다.
 * 배너 높이를 정할 때 필요한 건 후자다 — 첫 화면에서 상품이 얼마나 밀려나는지.
 *
 * 실제 스토어프론트를 iframe 으로 띄우지 않는 이유: 그러려면 이미지를 먼저 저장해야
 * 하는데, 정작 확인이 필요한 시점은 저장 전이다. 배너는 화면 최상단 full-bleed 라
 * 헤더 높이와 뷰포트 폭만 맞추면 목업으로도 실제와 거의 같다.
 */

/** 스토어프론트 실측값 (px) */
const PC_VIEWPORT = 1440;
const PC_HEADER = 128;
const MOBILE_VIEWPORT = 390;
const MOBILE_HEADER = 104;
const MOBILE_TABBAR = 56;
/** max-w-4xl(896px) 다이얼로그에서 좌우 패딩을 뺀 실사용 폭 */
const DIALOG_INNER_WIDTH = 820;

type Device = 'pc' | 'mobile';

export function BannerPreviewDialog({
  open,
  onOpenChange,
  title,
  pcImageFileId,
  mobileImageFileId,
  pcSlot,
  mobileSlot,
}: Props) {
  const [device, setDevice] = useState<Device>('pc');

  const isPc = device === 'pc';
  const slot = isPc ? pcSlot : mobileSlot;
  const src = resolvePublicFileUrl(isPc ? pcImageFileId : mobileImageFileId);
  const viewport = isPc ? PC_VIEWPORT : MOBILE_VIEWPORT;

  // 실제 뷰포트를 그대로 그린 뒤 통째로 축소한다 — 비율과 상대 크기가 함께 보존된다.
  // 다이얼로그 폭을 꽉 채우도록 배율을 잡아야 "화면에서 얼마나 큰지"가 느껴진다.
  const scale = Math.min(1, DIALOG_INNER_WIDTH / viewport);
  const bannerHeight = slot ? viewport / (slot.width / slot.height) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* shadcn Dialog 기본이 sm:max-w-lg 라 미디어쿼리로 덮어야 넓어진다 */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title} — 화면 미리보기</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={isPc ? 'default' : 'outline'}
            onClick={() => setDevice('pc')}
          >
            <Monitor className="mr-1 h-3.5 w-3.5" />
            PC
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!isPc ? 'default' : 'outline'}
            onClick={() => setDevice('mobile')}
          >
            <Smartphone className="mr-1 h-3.5 w-3.5" />
            모바일
          </Button>
          {slot && (
            <span className="text-muted-foreground ml-auto text-xs">
              {viewport}px 화면에서 배너 높이 {Math.round(bannerHeight)}px
            </span>
          )}
        </div>

        <div className="bg-muted flex justify-center overflow-x-auto rounded-md border p-4">
          {/*
            transform: scale 은 레이아웃 공간을 차지하지 않아 아래에 빈 공간이 남고,
            flex 자식이라 width 가 shrink 되어 뷰포트 재현이 깨진다. zoom 은 레이아웃에
            그대로 반영되므로 축소해도 뷰포트 비례가 유지된다.
          */}
          <div
            className="shrink-0 overflow-hidden rounded-md border bg-white shadow-sm"
            style={{ width: viewport, zoom: scale }}
          >
            {/* 가짜 헤더 */}
            <div
              className="flex items-center gap-3 border-b bg-[#4a4642] px-4"
              style={{ height: isPc ? PC_HEADER : MOBILE_HEADER }}
            >
              <div className="h-6 w-28 rounded bg-white/80" />
              <div className="h-8 flex-1 rounded-full bg-white/90" />
              <div className="h-6 w-6 rounded-full bg-white/60" />
            </div>

            {/* 배너 */}
            {slot ? (
              <div
                className="bg-muted w-full"
                style={{ aspectRatio: `${slot.width} / ${slot.height}` }}
              >
                {src ? (
                  // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={title} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-muted-foreground flex h-full w-full items-center justify-center text-sm">
                    이미지를 먼저 업로드하세요
                  </div>
                )}
              </div>
            ) : (
              <div className="text-muted-foreground p-6 text-sm">
                그룹에 {isPc ? 'PC' : '모바일'} 사이즈가 설정되어 있지 않습니다.
              </div>
            )}

            {/* 배너 아래 콘텐츠 — 첫 화면에서 상품이 얼마나 보이는지 가늠용 */}
            <div className="p-4">
              <div className="bg-muted mb-3 h-5 w-32 rounded" />
              <div className={`grid gap-3 ${isPc ? 'grid-cols-5' : 'grid-cols-2'}`}>
                {Array.from({ length: isPc ? 5 : 4 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="bg-muted aspect-square rounded" />
                    <div className="bg-muted h-3 w-full rounded" />
                    <div className="bg-muted h-3 w-2/3 rounded" />
                  </div>
                ))}
              </div>
            </div>

            {!isPc && (
              <div
                className="border-t bg-white"
                style={{ height: MOBILE_TABBAR }}
                aria-hidden
              />
            )}
          </div>
        </div>

        <p className="text-muted-foreground text-xs">
          실제 스토어프론트를 흉내 낸 화면입니다. 헤더 높이와 뷰포트 폭은 실측값이지만,
          상품 영역은 자리만 표시한 것입니다.
        </p>
      </DialogContent>
    </Dialog>
  );
}
