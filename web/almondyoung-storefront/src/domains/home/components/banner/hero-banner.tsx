import { HeroBannerCarousel } from "@/components/banner/banner-carousel"
import { getBannerGroupByCode } from "@/lib/api/pim/banner"
import type { BannerGroup } from "@/lib/types/ui/pim"
import {
  getActiveBanners,
  isBannerGroupVisible,
  isHeroListReady,
} from "@/lib/utils/banner"
import liveMainHero from "./live-main-hero.json"

export async function HeroBanner() {
  const bannerGroup: BannerGroup | null =
    process.env.NODE_ENV === "development"
      ? liveMainHero
      : await getBannerGroupByCode("MAIN_HERO").catch((err) => {
          console.error("getBannerGroupByCode error:", err)
          return null
        })

  const activeBanners = getActiveBanners(bannerGroup?.banners ?? [])

  if (!isBannerGroupVisible(bannerGroup) || activeBanners.length === 0) {
    return null
  }

  return (
    <div>
      <HeroBannerCarousel
        banners={activeBanners}
        showList={isHeroListReady(activeBanners)}
        dimensions={{
          pc: { width: bannerGroup.pcWidth, height: bannerGroup.pcHeight },
          mobile: {
            width: bannerGroup.mobileWidth,
            height: bannerGroup.mobileHeight,
          },
        }}
      />
    </div>
  )
}
