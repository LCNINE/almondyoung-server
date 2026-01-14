import { getBannerGroupByCode } from "@/lib/api/pim/banner"
import { BannerDto } from "@/lib/types/dto/pim"
import { BannerGroup } from "@/lib/types/ui/product"
import { cn } from "@/lib/utils"
import { getActiveBanners } from "@/lib/utils/banner"
import Link from "next/link"
import React from "react"
import { Banner } from "../shared/banner"

interface MembershipBannerProps {
  className?: string
}

export default async function MembershipBanner({
  className = "",
}: MembershipBannerProps) {
  const bannerGroup: BannerGroup | null = await getBannerGroupByCode(
    "MAIN_MEMBERSHIP"
  ).catch((err) => {
    console.error("getBannerGroupByCode error:", err)
    return null
  })

  // 배너 그룹 내에서 현재 노출 가능한 활성 배너만 필터링하고 정렬
  const activeBanners: BannerDto[] = getActiveBanners(bannerGroup?.banners)

  // 배너 에러 및 활성화된 배너가 없을경우, 에러 표시 대신 하드스타일 코드로 입력한게 노출되게끔
  if (!bannerGroup || activeBanners.length === 0) {
    return (
      <div className={cn("w-full px-0", className)}>
        <Link
          href="/mypage/membership"
          className="relative flex h-[89px] w-full flex-col items-center justify-center overflow-hidden bg-linear-to-r from-[#FF7E5F] to-[#FEB47B] text-white shadow-sm md:h-[120px]"
        >
          <div className="absolute -top-4 -left-4 h-20 w-20 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -right-4 -bottom-4 h-24 w-24 rounded-full bg-black/5 blur-2xl" />

          <div className="relative z-10 flex flex-col items-center gap-1 md:gap-2">
            <span className="text-lg font-bold tracking-tight md:text-2xl">
              멤버십 할인가
            </span>
            <p className="text-[11px] font-medium opacity-90 md:text-sm">
              아몬드영 멤버십 가입하고 추가혜택 받으세요!
            </p>
          </div>
        </Link>
      </div>
    )
  }

  return (
    <Banner
      href="/mypage/membership"
      pcSrc="/images/banner/membership_banner.png"
      mobileSrc="/images/banner/membership_banner.png"
      alt="아몬드영 멤버십 가입하고 추가혜택 받으세요!"
    />
  )
}
