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
  /** 히어로 그룹이면 PC 배너 위에 리스트 카드를 얹어 가림 범위를 보여준다 */
  showList?: boolean;
  listImageFileId?: string | null;
  listLabel?: string;
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
/**
 * PC 는 배너 «높이» 가 고정이라 화면이 넓어질수록 비율이 가로로 길어지고 세로가 더
 * 잘린다. 한 폭만 보여주면 넓은 화면에서 잘리는 걸 놓친다 — 좁은/보통/넓은 셋을 준다.
 */
const PC_VIEWPORTS = [1280, 1440, 1920] as const;
const PC_VIEWPORT_DEFAULT = 1440;
const PC_HEADER = 128;
const MOBILE_VIEWPORT = 390;
const MOBILE_HEADER = 104;
const MOBILE_TABBAR = 56;
/** max-w-4xl(896px) 다이얼로그에서 좌우 패딩을 뺀 실사용 폭 */
const DIALOG_INNER_WIDTH = 820;

/** 리스트 카드 실측 (스토어프론트 hero-banner-list.tsx 와 같은 값) */
const LIST_CARD_WIDTH = 180;
const LIST_CARD_TOP = 45;
const LIST_ROW_HEIGHT = 60;
/** 카드는 1020px 컨테이너 우측에서 10px 안쪽 (쿠팡과 동일) */
const listCardRight = (viewportWidth: number) =>
  Math.max(0, (viewportWidth - 1020) / 2) + 10;
/** 미리보기에서 그리는 칸 수 — 편집중인 한 칸 + 자리표시 */
const LIST_PREVIEW_ROWS = 6;
const LIST_PREVIEW_ACTIVE_ROW = 2;

type Device = 'pc' | 'mobile';

export function BannerPreviewDialog({
  open,
  onOpenChange,
  title,
  pcImageFileId,
  mobileImageFileId,
  pcSlot,
  mobileSlot,
  showList,
  listImageFileId,
  listLabel,
}: Props) {
  const [device, setDevice] = useState<Device>('pc');
  const [pcViewport, setPcViewport] = useState<number>(PC_VIEWPORT_DEFAULT);

  const isPc = device === 'pc';
  const slot = isPc ? pcSlot : mobileSlot;
  const src = resolvePublicFileUrl(isPc ? pcImageFileId : mobileImageFileId);
  const viewport = isPc ? pcViewport : MOBILE_VIEWPORT;

  // 실제 뷰포트를 그대로 그린 뒤 통째로 축소한다 — 비율과 상대 크기가 함께 보존된다.
  // 다이얼로그 폭을 꽉 채우도록 배율을 잡아야 "화면에서 얼마나 큰지"가 느껴진다.
  const scale = Math.min(1, DIALOG_INNER_WIDTH / viewport);
  // 스토어프론트는 PC 를 높이 고정으로 그린다 (banner-carousel.tsx) — 미리보기도 같아야 한다.
  // 모바일만 비율대로 그린다.
  const bannerHeight = slot
    ? isPc
      ? slot.height
      : viewport / (slot.width / slot.height)
    : 0;

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
          {isPc && (
            <div className="ml-2 flex items-center gap-1">
              {PC_VIEWPORTS.map((v) => (
                <Button
                  key={v}
                  type="button"
                  size="sm"
                  variant={pcViewport === v ? 'secondary' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => setPcViewport(v)}
                >
                  {v}
                </Button>
              ))}
            </div>
          )}
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
                className="bg-muted relative w-full"
                style={{ height: bannerHeight }}
              >
                {src ? (
                  // file-service 프록시 경유 임의 이미지라 next/image 대신 img 사용
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground flex h-full w-full items-center justify-center text-sm">
                    이미지를 먼저 업로드하세요
                  </div>
                )}
                {showList && isPc && (
                  <HeroListCard
                    listImageFileId={listImageFileId}
                    listLabel={listLabel}
                    viewportWidth={viewport}
                  />
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
              <div
                className={`grid gap-3 ${isPc ? 'grid-cols-5' : 'grid-cols-2'}`}
              >
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
          실제 스토어프론트를 흉내 낸 화면입니다. 헤더 높이와 뷰포트 폭은
          실측값이지만, 상품 영역은 자리만 표시한 것입니다.
          {showList &&
            ' 우측 리스트는 지금 편집중인 칸만 실물이고 나머지는 자리표시입니다.'}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 편집중인 칸 하나만 실물로 그리고 나머지는 회색 자리표시로 둔다.
 *
 * 그룹의 다른 배너를 불러와 완전한 리스트를 그리면 "저장 전 상태"와 "이미 저장된
 * 것"이 섞여 뭐가 반영된 건지 헷갈린다. 여기서 확인해야 하는 건 두 가지뿐이다 —
 * 오른쪽이 얼마나 가려지는지, 내 그림이 칸 안에서 어떻게 보이는지.
 */
function HeroListCard({
  listImageFileId,
  listLabel,
  viewportWidth,
}: {
  listImageFileId?: string | null;
  listLabel?: string;
  viewportWidth: number;
}) {
  const listSrc = resolvePublicFileUrl(listImageFileId);

  return (
    <div
      className="absolute overflow-hidden bg-white"
      style={{
        boxShadow: '0 4px 5px rgba(0, 0, 0, 0.3)',
        top: LIST_CARD_TOP,
        right: listCardRight(viewportWidth),
        width: LIST_CARD_WIDTH,
      }}
    >
      {Array.from({ length: LIST_PREVIEW_ROWS }).map((_, i) => {
        const isActive = i === LIST_PREVIEW_ACTIVE_ROW;
        return (
          <div
            key={i}
            className={`flex items-center gap-2 border-b px-[14px] last:border-b-0 ${
              isActive ? 'border-primary border' : ''
            }`}
            style={{ height: LIST_ROW_HEIGHT }}
          >
            {isActive ? (
              <>
                <span className="line-clamp-2 flex-1 text-sm leading-tight font-medium">
                  {listLabel || '노출문구'}
                </span>
                {listSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={listSrc}
                    alt=""
                    className="h-12 w-12 shrink-0 object-contain"
                  />
                ) : (
                  <div className="bg-muted h-12 w-12 shrink-0 rounded" />
                )}
              </>
            ) : (
              <>
                <div className="bg-muted h-3 flex-1 rounded" />
                <div className="bg-muted h-12 w-12 shrink-0 rounded" />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
