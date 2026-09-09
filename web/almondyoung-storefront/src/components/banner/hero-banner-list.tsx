"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useTranslations } from "next-intl"

import { Banner } from "@/lib/types/ui/pim"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { cn } from "@lib/utils"

/**
 * 쿠팡 실측값 (2026-09-08, 뷰포트 1470px 에서 getBoundingClientRect).
 * 카드 180×60/칸, 컨테이너 상단에서 45px, 컨테이너 우측에서 10px.
 *
 * 우측 위치는 화면이 아니라 «콘텐츠 컨테이너» 기준이다 — 화면이 넓어질수록 화면
 * 우측과의 거리가 벌어진다. 홈 섹션의 1360px 이 아니라 쿠팡과 같은 1020px 을 쓰는
 * 이유는, 1360 에 맞추면 넓은 화면에서 카드가 배너 가장자리에 붙어 답답해지기
 * 때문이다. 아래 상품 섹션과 오른쪽 끝이 안 맞는 것은 그 대가로 받아들인 것.
 */
const CARD_WIDTH = 180
const CARD_TOP = 45
const CARD_RIGHT = 10
const CONTAINER_MAX = 1020
const ROW_HEIGHT = 60
/** 카드가 넘지 않는 칸 수. 이보다 많으면 카드 안에서 스크롤한다 */
const MAX_ROWS = 6
/** 화살표에 올려둔 동안 한 프레임에 움직이는 거리(px) */
const SCROLL_SPEED = 3

type Props = {
  banners: Banner[]
  current: number
  onSelect: (index: number, source: "hover" | "click") => void
}

export function HeroBannerList({ banners, current, onSelect }: Props) {
  const t = useTranslations("home.heroBanner")
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLElement | null)[]>([])
  const rafRef = useRef<number | null>(null)
  const [overflow, setOverflow] = useState({ up: false, down: false })

  const canScroll = banners.length > MAX_ROWS

  const syncOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setOverflow({
      up: el.scrollTop > 1,
      down: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    })
  }, [])

  useEffect(() => {
    syncOverflow()
  }, [banners.length, syncOverflow])

  // 자동 롤링이 리스트 밖 배너로 넘어가면 그 칸을 보이는 곳까지 끌어온다.
  // scrollIntoView 는 block:"nearest" 여도 문서까지 함께 스크롤해서, 페이지를
  // 내려둔 사용자를 롤링할 때마다 배너로 끌어올린다. 컨테이너만 직접 움직인다.
  useEffect(() => {
    const el = scrollRef.current
    const row = rowRefs.current[current]
    if (!el || !row) return
    const rowRect = row.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (rowRect.top < elRect.top) {
      el.scrollTop += rowRect.top - elRect.top
    } else if (rowRect.bottom > elRect.bottom) {
      el.scrollTop += rowRect.bottom - elRect.bottom
    }
  }, [current])

  const stopScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const startScroll = useCallback(
    (direction: -1 | 1) => {
      stopScroll()
      const step = () => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop += direction * SCROLL_SPEED
        syncOverflow()
        rafRef.current = requestAnimationFrame(step)
      }
      rafRef.current = requestAnimationFrame(step)
    },
    [stopScroll, syncOverflow]
  )

  useEffect(() => stopScroll, [stopScroll])

  const arrowProps = (direction: -1 | 1) => ({
    type: "button" as const,
    onMouseEnter: () => startScroll(direction),
    onMouseLeave: stopScroll,
    onFocus: () => startScroll(direction),
    onBlur: stopScroll,
    className:
      "flex h-6 w-full items-center justify-center text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900",
  })

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 mx-auto hidden justify-end xl:flex"
      style={{ maxWidth: CONTAINER_MAX, paddingRight: CARD_RIGHT }}
    >
      <div
        className="pointer-events-auto h-fit overflow-hidden bg-white"
        style={{
          marginTop: CARD_TOP,
          width: CARD_WIDTH,
          // 쿠팡 실측 그림자. 각진 모서리와 짝이라 DESIGN.md 의 3단계 그림자를 안 쓴다
          boxShadow: "0 4px 5px rgba(0, 0, 0, 0.3)",
        }}
      >
      {canScroll && (
        <button {...arrowProps(-1)} aria-label={t("listPrev")}>
          <ChevronUp
            className={cn("h-4 w-4", !overflow.up && "opacity-30")}
            aria-hidden
          />
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={syncOverflow}
        className="divide-y divide-gray-100 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maxHeight: MAX_ROWS * ROW_HEIGHT }}
      >
        {banners.map((banner, index) => {
          const isCurrent = index === current
          const isExternal = banner.linkUrl?.startsWith("http")
          // 테두리를 항상 들고 있어야 선택될 때 칸 내용이 1px 밀리지 않는다
          const rowClass = cn(
            "flex items-center gap-2 border border-transparent px-[14px]",
            isCurrent && "border-primary"
          )
          const rowBody = (
            <>
              <span
                className={cn(
                  "line-clamp-2 flex-1 text-sm leading-tight break-keep",
                  isCurrent ? "font-bold" : "font-medium text-gray-700"
                )}
              >
                {banner.listLabel}
              </span>
              {banner.listImageFileId && (
                <Image
                  src={getThumbnailUrl(banner.listImageFileId)}
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 shrink-0 object-contain"
                />
              )}
            </>
          )

          // 링크가 없는 배너를 href="#" 로 두면 눌렀을 때 맨 위로 튀고
          // select_promotion 까지 집계된다. 고를 수는 있어야 하니 버튼으로 둔다
          if (!banner.linkUrl) {
            return (
              <button
                key={banner.id}
                type="button"
                ref={(el) => {
                  rowRefs.current[index] = el
                }}
                onMouseEnter={() => onSelect(index, "hover")}
                onFocus={() => onSelect(index, "hover")}
                aria-current={isCurrent}
                className={cn(rowClass, "w-full text-left")}
                style={{ height: ROW_HEIGHT }}
              >
                {rowBody}
              </button>
            )
          }

          return (
            <Link
              key={banner.id}
              ref={(el) => {
                rowRefs.current[index] = el
              }}
              href={banner.linkUrl}
              target={isExternal ? "_blank" : undefined}
              rel={isExternal ? "noopener noreferrer" : undefined}
              onMouseEnter={() => onSelect(index, "hover")}
              onFocus={() => onSelect(index, "hover")}
              onClick={() => onSelect(index, "click")}
              aria-current={isCurrent}
              className={rowClass}
              style={{ height: ROW_HEIGHT }}
            >
              {rowBody}
            </Link>
          )
        })}
      </div>

        {canScroll && (
          <button {...arrowProps(1)} aria-label={t("listNext")}>
            <ChevronDown
              className={cn("h-4 w-4", !overflow.down && "opacity-30")}
              aria-hidden
            />
          </button>
        )}
      </div>
    </div>
  )
}
