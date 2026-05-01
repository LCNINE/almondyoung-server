import { HeroBannerCarousel } from "@/components/banner/banner-carousel"
import { getBannerGroupByCode } from "@/lib/api/pim/banner"
import type { BannerDto } from "@/lib/types/dto/pim"
import type { BannerGroup } from "@/lib/types/ui/pim"
import { getActiveBanners } from "@/lib/utils/banner"

export async function HeroBanner() {
  const bannerGroup: BannerGroup | null = await getBannerGroupByCode(
    "MAIN_HERO"
  ).catch((err) => {
    console.error("getBannerGroupByCode error:", err)
    return null
  })

  // 배너 그룹 내에서 현재 노출 가능한 활성 배너만 필터링하고 정렬
  const activeBanners: BannerDto[] = getActiveBanners(bannerGroup?.banners)

  if (!bannerGroup || activeBanners.length === 0) {
    return null
  }

  return (
    <div>
      <HeroBannerCarousel
        banners={activeBanners}
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
