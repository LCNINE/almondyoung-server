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
    return (
      <div className="pt-4 pb-4 md:pb-[87px]">
        <div className="relative flex h-[350px] w-full flex-col items-center justify-center overflow-hidden rounded-lg bg-[#F8F9FA] md:h-[540px]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.03]">
            <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern
                  id="grid"
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 40 0 L 0 0 0 40"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>
          <div className="relative z-10 flex flex-col items-center gap-4">
            <h2 className="text-2xl font-extrabold tracking-tight text-[#222] md:text-3xl">
              ALMOND<span className="font-light text-blue-600">YOUNG</span>
            </h2>
            <div className="h-px w-8 bg-gray-300" />
            <p className="text-[13px] font-medium tracking-wide text-gray-500 uppercase md:text-sm">
              Professional Beauty Solution
            </p>
            <p className="mt-2 text-[12px] text-gray-400">
              현재 새로운 소식을 준비하고 있습니다.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // // 배너마다 연결된 상품 상세 정보 가져오기
  // todo: master 다중조회 api 완성시 연결
  return (
    <div className="pt-4 pb-4 md:pb-[87px]">
      <HeroBannerCarousel
        banners={activeBanners}
        pcWidth={bannerGroup?.pcWidth ?? null}
        pcHeight={bannerGroup?.pcHeight ?? null}
        mobileWidth={bannerGroup?.mobileWidth ?? null}
        mobileHeight={bannerGroup?.mobileHeight ?? null}
        // bannersWithProducts={bannersWithProducts} // todo: add bannersWithProducts
      />
    </div>
  )
}
