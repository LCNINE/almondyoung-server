"use client"

import testImage from "@/assets/images/test.png"
import { useMediaQuery } from "@/hooks/use-media-query"
import { PauseIcon } from "@/icons/pause-icon"
import type { Banner } from "@/lib/types/ui/product"
import Autoplay from "embla-carousel-autoplay"
import { Play } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Button } from "../ui/button"
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../ui/carousel"

interface HeroBannerCarouselProps {
  banners: Banner[]
  pcWidth: number | null
  pcHeight: number | null
  mobileWidth: number | null
  mobileHeight: number | null
}

export function HeroBannerCarousel({
  banners,
  pcWidth,
  pcHeight,
  mobileWidth,
  mobileHeight,
}: HeroBannerCarouselProps) {
  const [api, setApi] = useState<CarouselApi>()
  const [isPlaying, setIsPlaying] = useState(true)

  const isMobile = useMediaQuery("(max-width: 768px)")

  const autoplay = useRef(Autoplay({ delay: 4000, stopOnInteraction: false }))

  useEffect(() => {
    if (!api) return

    const autoplayInstance = api.plugins().autoplay
    if (!autoplayInstance) return

    if (isPlaying) {
      autoplayInstance.play()
    } else {
      autoplayInstance.stop()
    }
  }, [isPlaying, api])

  return (
    <div className="bg-background relative w-full overflow-hidden border-b border-gray-100">
      <Carousel
        setApi={setApi}
        plugins={[autoplay.current]}
        opts={{
          loop: true,
          align: isMobile ? "start" : "center",
          skipSnaps: false,
        }}
        className="w-full"
        onMouseEnter={() => isPlaying && autoplay.current.stop()}
        onMouseLeave={() => isPlaying && autoplay.current.play()}
      >
        <CarouselContent className="-ml-6">
          {banners.map((banner) => (
            <CarouselItem
              key={banner.id}
              className="basis-[85%] pl-6 md:basis-[55%] lg:basis-[50%]"
            >
              <Link
                href={banner.linkUrl ?? "#"}
                className="relative block h-[304px] w-full overflow-hidden rounded-[24px] bg-gray-100 shadow-sm md:h-[518px]"
              >
                {/* 모바일 이미지 */}
                <div className="relative block h-full w-full md:hidden">
                  <Image
                    src={banner.mobileImageFileId}
                    alt={banner.title}
                    fill
                    sizes="(max-width: 768px) 85vw, 100vw"
                    className="object-cover transition-transform duration-500 hover:scale-105"
                    priority
                  />
                </div>

                {/* 데스크탑 이미지 */}
                <div className="relative hidden h-full w-full md:block">
                  <Image
                    src={banner.pcImageFileId}
                    alt={banner.title}
                    fill
                    sizes="(max-width: 1024px) 55vw, 50vw"
                    className="object-cover transition-transform duration-500 hover:scale-105"
                    priority
                  />
                </div>

                {/* 그라데이션 오버레이*/}
                <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/20 to-transparent" />

                {/* 콘텐츠 영역 */}
                <div className="absolute inset-x-0 bottom-0 p-6 text-white md:p-12">
                  <div className="max-w-[85%] md:max-w-[60%]">
                    <h2 className="text-xl leading-[1.2] font-bold tracking-tight md:text-4xl lg:text-5xl">
                      {banner.title}
                    </h2>
                    {banner.description && (
                      <p className="mt-2 line-clamp-1 text-xs font-medium opacity-80 md:mt-4 md:line-clamp-2 md:text-lg">
                        {banner.description}
                      </p>
                    )}

                    {/* subProduct */}
                    <div className="mt-4 md:mt-8">
                      <p className="mb-2 text-xs font-medium opacity-80 md:text-sm">
                        검색 연관 제품
                      </p>
                      <div className="flex gap-2 md:gap-4">
                        <div className="relative aspect-square w-[103px] overflow-hidden rounded-lg bg-white/20 md:w-[131px] md:rounded-xl">
                          <Image
                            src={testImage}
                            alt="product"
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div className="relative aspect-square w-[103px] overflow-hidden rounded-lg bg-white/20 md:w-[131px] md:rounded-xl">
                          <Image
                            src={testImage}
                            alt="product"
                            fill
                            className="object-cover"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </CarouselItem>
          ))}
        </CarouselContent>

        {/* 컨트롤 영역 */}
        <div className="absolute right-8 -bottom-14 z-20 hidden items-center gap-3 md:flex">
          <div className="flex h-11 items-center overflow-hidden rounded-full border border-white/40 bg-white/80 shadow-md backdrop-blur-md transition-all hover:bg-white">
            <CarouselPrevious className="static h-full w-12 translate-y-0 cursor-pointer border-none bg-transparent text-black shadow-none transition-colors hover:bg-white/80 hover:text-black" />
            <div className="h-4 w-px bg-gray-300" />
            <CarouselNext className="static h-full w-12 translate-y-0 cursor-pointer border-none bg-transparent text-black shadow-none transition-colors hover:bg-white/80 hover:text-black" />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 cursor-pointer rounded-full bg-white/80 text-black shadow-md backdrop-blur-md transition-all hover:bg-white hover:text-black active:scale-90"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? (
              <PauseIcon className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 fill-current" />
            )}
          </Button>
        </div>
      </Carousel>
    </div>
  )
}
