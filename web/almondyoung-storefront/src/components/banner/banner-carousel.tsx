"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Autoplay from "embla-carousel-autoplay"
import Fade from "embla-carousel-fade"

import { trackEvent } from "@/lib/analytics/gtag"
import { logoContestPrizeBubble } from "@/domains/logo-contest/banner-assets"
import { Banner } from "@/lib/types/ui/pim"
import { getBannerImageUrl } from "@/lib/utils/banner"
import { cn } from "@lib/utils"
import { HeroBannerList } from "./hero-banner-list"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"

const promotionOf = (
  banner: Banner,
  index: number,
  creativeName: string
) => ({
  promotion_id: banner.id,
  promotion_name: banner.title,
  creative_slot: `main_hero_${index + 1}`,
  creative_name: creativeName,
})

type BannerCarouselProps = {
  banners: Banner[]
  dimensions: {
    pc: { width: number | null; height: number | null }
    mobile: { width: number | null; height: number | null }
  }
  /** 그룹의 모든 배너에 리스트 정보가 채워졌을 때만 켠다 */
  showList?: boolean
}

export function HeroBannerCarousel({
  banners,
  dimensions,
  showList,
}: BannerCarouselProps) {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  /**
   * 이 배너를 자동 롤링으로 보게 됐는지, 리스트에 마우스를 올려 보게 됐는지.
   * view_promotion 을 쏘고 나면 auto 로 되돌려 다음 전환에 새로 판정한다.
   */
  const viewSourceRef = useRef<"auto" | "hover">("auto")

  const pcWidth = dimensions.pc.width ?? 1920
  const pcHeight = dimensions.pc.height ?? 600
  const mobileWidth = dimensions.mobile.width ?? 750
  const mobileHeight = dimensions.mobile.height ?? 500

  useEffect(() => {
    if (!api) return

    setCurrent(api.selectedScrollSnap())

    api.on("select", () => {
      setCurrent(api.selectedScrollSnap())
    })
  }, [api])

  // 리스트는 배너 위에 얹힌 오버레이라 embla 의 hover 범위 밖이다. 리스트를 포함하는
  // 바깥 div 의 hover 로 자동 롤링을 멈추고, 벗어나면 그 자리부터 재개한다
  useEffect(() => {
    const autoplay = api?.plugins()?.autoplay
    if (!autoplay) return
    if (isHovered) autoplay.stop()
    else autoplay.play()
  }, [api, isHovered])

  const viewed = useRef<Set<string>>(new Set())

  useEffect(() => {
    const banner = banners[current]
    if (!banner) return
    const source = viewSourceRef.current
    viewSourceRef.current = "auto"
    if (viewed.current.has(banner.id)) return
    viewed.current.add(banner.id)
    trackEvent("view_promotion", promotionOf(banner, current, source))
  }, [banners, current])

  const handleListSelect = useCallback(
    (index: number, source: "hover" | "click") => {
      if (source === "click") {
        trackEvent(
          "select_promotion",
          promotionOf(banners[index], index, "list")
        )
        return
      }
      viewSourceRef.current = "hover"
      // jump: true — Fade 플러그인의 전환을 건너뛴다. 마우스를 훑으면 페이드가
      // 겹쳐 배너가 깜빡이는 것처럼 보인다
      api?.scrollTo(index, true)
    },
    [api, banners]
  )

  const scrollTo = useCallback(
    (index: number) => {
      api?.scrollTo(index)
    },
    [api]
  )

  const scrollPrev = useCallback(() => {
    api?.scrollPrev()
  }, [api])

  const scrollNext = useCallback(() => {
    api?.scrollNext()
  }, [api])

  const BannerImage = ({
    banner,
    eager,
  }: {
    banner: Banner
    eager: boolean
  }) => (
    <>
      {/* PC 이미지 - md(768px) 이상에서만 표시 */}
      <Image
        src={getBannerImageUrl(banner.pcImageFileId)}
        alt={banner.title}
        fill
        priority={eager}
        sizes="(max-width: 767px) 0px, 100vw"
        className="hidden object-cover md:block"
      />
      {/* 모바일 이미지 - md(768px) 미만에서만 표시 */}
      <Image
        src={getBannerImageUrl(banner.mobileImageFileId)}
        alt={banner.title}
        fill
        priority={eager}
        sizes="(max-width: 767px) 100vw, 0px"
        className={cn(
          "block object-cover md:hidden",
          banner.id === "local-logo-contest" && "object-[75%_center]"
        )}
      />
      {banner.id === "local-logo-contest" && (
        <div className="absolute top-[9%] left-[6%] z-10 text-[#143247] md:top-[13%] md:left-[14%]">
          <div className="text-[10px] font-extrabold md:text-base">로고 공모전</div>
          <div
            className="mt-1 text-[23px] leading-[1.12] whitespace-pre-line [text-shadow:0_2px_0_#9bdcf5,0_4px_0_#5fb9df] md:mt-3 md:text-[clamp(36px,3.4vw,64px)]"
            style={{ fontFamily: '"Jua Logo Contest", Pretendard, sans-serif' }}
          >
            {"아몬드영의 새 로고를\n함께 만들어 주세요"}
          </div>
          <div className="relative mt-2 h-[54px] w-[145px] md:mt-7 md:h-[100px] md:w-[260px]">
            <Image
              src={logoContestPrizeBubble}
              alt=""
              fill
              sizes="(max-width: 767px) 145px, 260px"
              className="object-contain"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-1 text-[8px] font-semibold md:pt-3 md:text-sm">
              <span>대상 수상자 · 1명</span>
              <strong className="text-[13px] md:text-xl">20만 포인트</strong>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return (
    <div
      className="relative w-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Carousel
        setApi={setApi}
        opts={{
          loop: true,
        }}
        plugins={[
          Autoplay({
            delay: 4000,
            stopOnInteraction: false,
            // embla 의 hover 판정 기준은 CarouselContent 안쪽 div 라, 그 위에 얹힌
            // 리스트에 마우스를 올리면 오히려 mouseleave 로 잡혀 롤링이 재개된다.
            // 리스트까지 감싸는 isHovered 로 아래에서 직접 멈춘다
            stopOnMouseEnter: false,
          }),
          Fade(),
        ]}
        className="w-full"
      >
        <CarouselContent className="ml-0">
          {banners.map((banner, index) => (
            <CarouselItem key={banner.id} className="pl-0">
              <div
                /*
                 * 높이 고정은 «리스트 카드가 뜨는 폭에서만» 쓴다 (xl 이상, 쿠팡과 같다).
                 * 카드는 45+6×60=405px 로 고정이라 배너를 비율로 두면 좁은 화면에서
                 * 카드가 배너 밖으로 삐져나간다 — 그래서 높이를 고정하고 좌우가
                 * 잘리는 걸 감수한다.
                 *
                 * 카드가 없는 md~xl 에서까지 고정 높이를 끌고 내려가면 감수할 이유가
                 * 없는 잘림만 남는다. 1134px 에서 좌우 393px 씩 먹혀 배너 카피가
                 * 잘려 나갔다. 그 구간은 이미지 비율대로 축소한다.
                 */
                className="relative aspect-(--mobile-ratio) w-full md:aspect-(--pc-ratio) xl:aspect-auto xl:h-(--pc-height)"
                style={
                  {
                    "--mobile-ratio": `${mobileWidth}/${mobileHeight}`,
                    "--pc-ratio": `${pcWidth}/${pcHeight}`,
                    "--pc-height": `${pcHeight}px`,
                  } as React.CSSProperties
                }
              >
                {banner.linkUrl ? (
                  <Link
                    href={banner.linkUrl}
                    onClick={() =>
                      trackEvent(
                        "select_promotion",
                        promotionOf(banner, index, "main")
                      )
                    }
                    className="relative block h-full w-full"
                    target={
                      banner.linkUrl.startsWith("http") ? "_blank" : undefined
                    }
                    rel={
                      banner.linkUrl.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                  >
                    <BannerImage banner={banner} eager={index === 0} />
                  </Link>
                ) : (
                  <BannerImage banner={banner} eager={index === 0} />
                )}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>

        {showList && (
          <HeroBannerList
            banners={banners}
            current={current}
            onSelect={handleListSelect}
          />
        )}

        {/* 좌우 화살표 - 호버 시에만 표시. 리스트가 뜨면 자리가 겹치고 역할도 겹친다 */}
        {banners.length > 1 && (
          <div className={cn("hidden lg:block", showList && "xl:hidden")}>
            <button
              onClick={scrollPrev}
              className={cn(
                "hover:bg-yellow-30 absolute top-1/2 left-[15%] z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/80 text-gray-800 shadow-md transition-all duration-300 hover:text-white",
                isHovered ? "opacity-100" : "opacity-0"
              )}
              aria-label="이전 배너"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={scrollNext}
              className={cn(
                "hover:bg-yellow-30 absolute top-1/2 right-[15%] z-10 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/80 text-gray-800 shadow-md transition-all duration-300 hover:text-white",
                isHovered ? "opacity-100" : "opacity-0"
              )}
              aria-label="다음 배너"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>
        )}
      </Carousel>

      {/* 도트 인디케이터 — 리스트가 뜨는 큰 화면에서는 리스트가 그 역할을 한다 */}
      {banners.length > 1 && (
        <div
          className={cn(
            "absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2",
            showList && "xl:hidden"
          )}
        >
          {banners.map((_, index) => (
            <button
              key={index}
              onClick={() => scrollTo(index)}
              className={cn(
                "h-2 w-2 cursor-pointer rounded-full transition-all duration-300",
                current === index
                  ? "w-6 bg-white"
                  : "bg-white/50 hover:bg-white/80"
              )}
              aria-label={`배너 ${index + 1}로 이동`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
