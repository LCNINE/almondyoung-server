"use client"

import { useState, useCallback, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Autoplay from "embla-carousel-autoplay"

import { Banner } from "@/lib/types/ui/pim"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { cn } from "@lib/utils"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"

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
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

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

  const BannerImage = ({ banner }: { banner: Banner }) => (
    <>
      {/* PC 이미지 - md(768px) 이상에서만 표시 */}
      <Image
        src={getThumbnailUrl(banner.pcImageFileId)}
        alt={banner.title}
        fill
        priority
        sizes="(max-width: 767px) 0px, 100vw"
        className="hidden object-cover md:block"
      />
      {/* 모바일 이미지 - md(768px) 미만에서만 표시 */}
      <Image
        src={getThumbnailUrl(banner.mobileImageFileId)}
        alt={banner.title}
        fill
        priority
        sizes="(max-width: 767px) 100vw, 0px"
        className="block object-cover md:hidden"
      />
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
            stopOnMouseEnter: true,
          }),
        ]}
        className="w-full"
      >
        <CarouselContent className="ml-0">
          {banners.map((banner, index) => (
            <CarouselItem
              key={banner.id}
              // 임시 대응 - 모바일 배너 받는데 시간이 오래걸려 인덱스 2 배너는 모바일에서 깨져 보여서 임시로 숨김 처리
              className={cn("pl-0", index === 2 && "hidden md:block")}
            >
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
                    <BannerImage banner={banner} />
                  </Link>
                ) : (
                  <BannerImage banner={banner} />
                )}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>

        {/* 좌우 화살표 - 호버 시에만 표시 */}
        {banners.length > 1 && (
          <div className="hidden lg:block">
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

      {/* 도트 인디케이터 */}
      {banners.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          {banners.map((_, index) => (
            <button
              key={index}
              onClick={() => scrollTo(index)}
              className={cn(
                "h-2 w-2 cursor-pointer rounded-full transition-all duration-300",
                index === 2 && "hidden md:block",
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
