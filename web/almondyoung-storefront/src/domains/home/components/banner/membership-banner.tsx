import { getBannerGroupByCode } from "@/lib/api/pim/banner"
import { BannerDto } from "@/lib/types/dto/pim"
import type { BannerGroup } from "@/lib/types/ui/pim"
import { getActiveBanners } from "@/lib/utils/banner"
import React from "react"
import { Banner } from "../shared/banner"

interface MembershipBannerProps {
  className?: string
}

export default async function MembershipBanner({
  className = "",
}: MembershipBannerProps) {
  const bannerGroup: BannerGroup | null = await getBannerGroupByCode(
    "MEMBER_SHIP_HERO"
  ).catch((err) => {
    console.error("getBannerGroupByCode error:", err)
    return null
  })

  // 배너 그룹 내에서 현재 노출 가능한 활성 배너만 필터링하고 정렬
  const activeBanners: BannerDto[] = getActiveBanners(bannerGroup?.banners)

  if (!bannerGroup || activeBanners.length === 0) {
    return
  }

  const banner = activeBanners[0]

  return (
    <Banner
      className={className}
      href={banner.linkUrl}
      pcSrc={banner.pcImageFileId}
      mobileSrc={banner.mobileImageFileId}
      alt={banner.title || "membership banner"}
      hideOnMobile
      dimensions={{
        pc: { width: bannerGroup.pcWidth, height: bannerGroup.pcHeight },
        mobile: {
          width: bannerGroup.mobileWidth,
          height: bannerGroup.mobileHeight,
        },
      }}
    />
  )
}
