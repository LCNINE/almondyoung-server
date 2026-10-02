import { HeroBannerCarousel } from "@/components/banner/banner-carousel"
import {
  logoContestHeroImage,
  logoContestListThumbnail,
} from "@/domains/logo-contest/banner-assets"
import { getBannerGroupByCode } from "@/lib/api/pim/banner"
import type { BannerDto } from "@/lib/types/dto/pim"
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

  // 배너 그룹 내에서 현재 노출 가능한 활성 배너만 필터링하고 정렬
  const activeBanners: BannerDto[] = getActiveBanners([
    ...(bannerGroup?.banners ?? []),
    ...(process.env.NODE_ENV === "development" && bannerGroup
      ? [
          {
            ...bannerGroup.banners[0],
            id: "local-logo-contest",
            title: "아몬드영 로고 공모전",
            pcImageFileId: logoContestHeroImage,
            mobileImageFileId: logoContestHeroImage,
            listImageFileId: logoContestListThumbnail,
            listLabel: "로고 공모전",
            linkUrl: "/kr/logo-contest",
            sortOrder: 5,
          },
        ]
      : []),
  ])

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
