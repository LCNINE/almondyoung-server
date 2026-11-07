"use client"

import Autoplay from "embla-carousel-autoplay"
import Fade from "embla-carousel-fade"
import Image from "next/image"
import Link from "next/link"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import type { Banner } from "@/lib/types/ui/pim"
import { getBannerImageUrl } from "@/lib/utils/banner"

function BannerImage({ banner, eager }: { banner: Banner; eager: boolean }) {
  return (
    <>
      <Image
        src={getBannerImageUrl(banner.pcImageFileId)}
        alt={banner.title}
        fill
        priority={eager}
        sizes="(max-width: 767px) 0px, 100vw"
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
}

export function LandingHeroBanners({ banners }: { banners: Banner[] }) {
  return (
    <Carousel
      opts={{ loop: true }}
      plugins={[Autoplay({ delay: 4000, stopOnInteraction: false }), Fade()]}
      className="absolute inset-0 [&>div]:h-full"
    >
      <CarouselContent className="ml-0 h-full">
        {banners.map((banner, index) => (
          <CarouselItem key={banner.id} className="relative h-full pl-0">
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
                <BannerImage banner={banner} eager={index === 0} />
              </Link>
            ) : (
              <BannerImage banner={banner} eager={index === 0} />
            )}
          </CarouselItem>
        ))}
      </CarouselContent>
    </Carousel>
  )
}
