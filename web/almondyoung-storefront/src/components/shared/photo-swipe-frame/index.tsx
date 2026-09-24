"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
import { cn } from "@/lib/utils"

interface Props {
  /** 그릴 사진 수. 1 이하면 이 컴포넌트를 쓰지 않는다 */
  count: number
  renderImage: (index: number) => ReactNode
  /** 칸을 꽉 채우려면 카드 사진 칸과 같은 비율을 준다 (aspect-square 등) */
  itemClassName?: string
  /** 가로로 넘기는 줄 안에 든 카드는 손짓이 겹쳐 사진 넘기기를 끈다 */
  enableSwipe?: boolean
  /** 썸네일이 작아 구역 나누기가 어려운 카드는 호버 미리보기를 끈다 */
  enableHover?: boolean
  onSelect?: (index: number) => void
  hideDots?: boolean
}

/** 카드 사진 칸을 좌우로 넘길 수 있게 감싼다. 마우스는 호버, 손가락은 스와이프. */
export function PhotoSwipeFrame({
  count,
  renderImage,
  itemClassName,
  enableSwipe = true,
  enableHover = true,
  onSelect,
  hideDots = false,
}: Props) {
  const [api, setApi] = useState<CarouselApi>()
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!api) return

    const sync = () => {
      const index = api.selectedScrollSnap()
      setActive(index)
      onSelect?.(index)
    }
    sync()
    api.on("select", sync)
    return () => {
      api.off("select", sync)
    }
  }, [api, onSelect])

  const indexes = Array.from({ length: count }, (_, index) => index)

  return (
    <div className="h-full w-full" onMouseLeave={() => api?.scrollTo(0)}>
      <Carousel
        setApi={setApi}
        className="h-full w-full"
        opts={{ watchDrag: enableSwipe }}
      >
        <CarouselContent className="ml-0">
          {indexes.map((index) => (
            <CarouselItem
              key={index}
              className={cn("relative pl-0", itemClassName)}
            >
              {renderImage(index)}
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {enableHover && (
        <>
          {/* 카드를 세로로 갈라 마우스가 놓인 구역의 사진을 보여준다.
              손가락은 캐러셀을 직접 쓸어야 하므로 마우스가 있는 기기에서만 덮는다
              (화면 폭으로 가르면 태블릿에서 이 판이 스와이프를 가로챈다) */}
          <div className="absolute inset-0 hidden [@media(pointer:fine)]:flex">
            {indexes.map((index) => (
              <div
                key={index}
                className="h-full flex-1"
                onMouseEnter={() => api?.scrollTo(index)}
              />
            ))}
          </div>

          {/* 넘길 수 없는 카드에 점만 띄우면 넘어갈 것처럼 보인다 */}
          {!hideDots && (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-2 flex justify-center transition-opacity",
                enableSwipe
                  ? "[@media(pointer:fine)]:opacity-0 [@media(pointer:fine)]:group-hover:opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              )}
            >
              {/* 흰 점만 두면 상품 카드의 흰 배경에 묻힌다 */}
              <span className="bg-foreground/45 flex items-center gap-1 rounded-full px-1.5 py-1">
                {indexes.map((index) => (
                  <span
                    key={index}
                    className={cn(
                      "h-1 rounded-full transition-all",
                      index === active ? "w-4 bg-white" : "w-1 bg-white/60"
                    )}
                  />
                ))}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
