"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import { useTranslations } from "next-intl"
import Fade from "embla-carousel-fade"

import { trackEvent } from "@/lib/analytics/gtag"
import { Banner } from "@/lib/types/ui/pim"
import { getBannerImageUrl } from "@/lib/utils/banner"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"

/** 한 장이 머무는 시간. 아래 진행 막대가 이 시간 동안 찬다 */
const SLIDE_MS = 5000

const promotionOf = (banner: Banner, index: number, creativeName: string) => ({
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
}

export function HeroBannerCarousel({
  banners,
  dimensions,
}: BannerCarouselProps) {
  const t = useTranslations("home.heroBanner")
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [hovered, setHovered] = useState(false)
  const barRef = useRef<HTMLSpanElement>(null)
  const elapsedRef = useRef(0)
  const viewed = useRef<Set<string>>(new Set())

  const multiple = banners.length > 1
  const pcWidth = dimensions.pc.width ?? 1920
  const pcHeight = dimensions.pc.height ?? 450
  const mobileWidth = dimensions.mobile.width ?? 780
  const mobileHeight = dimensions.mobile.height ?? 360

  const paintProgress = useCallback((ratio: number) => {
    if (barRef.current) barRef.current.style.transform = `scaleX(${ratio})`
  }, [])

  // 움직임을 줄이도록 설정한 사람에게는 멈춘 채로 시작한다
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPlaying(false)
    }
  }, [])

  useEffect(() => {
    if (!api) return

    const onSelect = () => {
      setCurrent(api.selectedScrollSnap())
      elapsedRef.current = 0
      paintProgress(0)
    }
    onSelect()
    api.on("select", onSelect)

    return () => {
      api.off("select", onSelect)
    }
  }, [api, paintProgress])

  // 멈추거나 마우스를 올린 동안에는 지난 시간을 그대로 두고, 다시 움직이면 그 자리부터 이어 찬다
  const running = playing && !hovered && multiple

  useEffect(() => {
    if (!running || !api) return

    let frame = 0
    let last = performance.now()

    const tick = (now: number) => {
      elapsedRef.current += now - last
      last = now

      if (elapsedRef.current >= SLIDE_MS) {
        elapsedRef.current = 0
        api.scrollNext()
      }

      paintProgress(elapsedRef.current / SLIDE_MS)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [running, api, paintProgress])

  useEffect(() => {
    const banner = banners[current]
    if (!banner || viewed.current.has(banner.id)) return

    viewed.current.add(banner.id)
    trackEvent("view_promotion", promotionOf(banner, current, "auto"))
  }, [banners, current])

  const scrollPrev = useCallback(() => api?.scrollPrev(), [api])
  const scrollNext = useCallback(() => api?.scrollNext(), [api])

  const BannerImage = ({
    banner,
    eager,
  }: {
    banner: Banner
    eager: boolean
  }) => (
    <>
      <Image
        src={getBannerImageUrl(banner.pcImageFileId)}
        alt={banner.title}
        fill
        priority={eager}
        sizes="(max-width: 767px) 0px, (max-width: 1280px) 100vw, 1216px"
        className="hidden object-cover md:block"
      />
      <Image
        src={getBannerImageUrl(banner.mobileImageFileId)}
        alt={banner.title}
        fill
        priority={eager}
        sizes="(max-width: 767px) 100vw, 0px"
        className="block object-cover md:hidden"
      />
    </>
  )

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("label")}
      className="relative w-full overflow-hidden bg-[#0d0d0d]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Carousel
        setApi={setApi}
        opts={{ loop: true }}
        plugins={[Fade()]}
        className="w-full"
      >
        <CarouselContent className="ml-0">
          {banners.map((banner, index) => (
            <CarouselItem key={banner.id} className="pl-0">
              <div
                className="relative aspect-(--mobile-ratio) w-full md:aspect-(--pc-ratio)"
                style={
                  {
                    "--mobile-ratio": `${mobileWidth}/${mobileHeight}`,
                    "--pc-ratio": `${pcWidth}/${pcHeight}`,
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
      </Carousel>

      {multiple && (
        <>
          <div className="bg-ink/72 absolute right-2.5 bottom-2.5 z-10 flex items-center gap-0.5 rounded-full p-0.5 text-xs text-white tabular-nums md:right-4 md:bottom-4">
            <button
              type="button"
              onClick={scrollPrev}
              aria-label={t("prev")}
              className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-white/14"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span aria-live="polite" className="min-w-10 px-1 text-center">
              {current + 1} / {banners.length}
            </span>
            <button
              type="button"
              onClick={() => setPlaying((value) => !value)}
              aria-label={playing ? t("pause") : t("play")}
              className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-white/14"
            >
              {playing ? (
                <Pause className="size-3.5" fill="currentColor" aria-hidden />
              ) : (
                <Play className="size-3.5" fill="currentColor" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={scrollNext}
              aria-label={t("next")}
              className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-white/14"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>

          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 z-10 h-[3px] bg-white/18"
          >
            <span
              ref={barRef}
              className="bg-mint block h-full origin-left scale-x-0"
            />
          </div>
        </>
      )}
    </section>
  )
}
