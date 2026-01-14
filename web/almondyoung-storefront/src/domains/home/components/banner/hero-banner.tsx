import { HeroBannerCarousel } from "@/components/banner/banner-carousel"
import { getBannerGroupByCode } from "@/lib/api/pim/banner"
import type { BannerDto } from "@/lib/types/dto/pim"
import type { BannerGroup } from "@/lib/types/ui/product"
import { getActiveBanners } from "@/lib/utils/banner"

export const MOCK_BANNER_GROUP: BannerGroup = {
  id: "group_001",
  code: "MAIN_HERO",
  title: "메인 히어로 배너",
  category: "MAIN",
  pcWidth: 0,
  pcHeight: 0,
  mobileWidth: 0,
  mobileHeight: 0,
  description: "홈페이지 최상단 메인 배너 그룹입니다.",
  isActive: true,
  sortOrder: 1,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  banners: [
    {
      id: "banner_001",
      bannerGroupId: "group_001",
      title: "오늘 2시 시술 시연 라이브",
      description: "서울래쉬 포인트 더블 본딩 기법",
      pcImageFileId: "https://picsum.photos/id/10/1920/600",
      mobileImageFileId: "https://picsum.photos/id/10/720/720",
      linkUrl: "/live/123",
      isActive: true,
      sortOrder: 1,
    } as any,
    {
      id: "banner_002",
      bannerGroupId: "group_001",
      title: "플랫아르디 PLAT ARDI 신상 런칭",
      description: "입술 위에 맑고 투명한 빛을 더하다",
      pcImageFileId: "https://picsum.photos/id/20/1920/600",
      mobileImageFileId: "https://picsum.photos/id/20/720/720",
      linkUrl: "/brand/plat-ardi",
      isActive: true,
      sortOrder: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    } as any,
    {
      id: "banner_003",
      bannerGroupId: "group_001",
      title: "전문 재료를 한 곳에서, 아몬드영",
      description: "미용인들을 위한 최저가 MRO 쇼핑몰",
      pcImageFileId: "https://picsum.photos/id/30/1920/600",
      mobileImageFileId: "https://picsum.photos/id/30/720/720",
      linkUrl: "/about",
      isActive: true,
      sortOrder: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    } as any,
    {
      id: "banner_004",
      bannerGroupId: "group_001",
      title: "겨울 시즌 한정 왁싱 재료 특가",
      description: "저자극 왁스부터 진정 젤까지 최대 50%",
      pcImageFileId: "https://picsum.photos/id/40/1920/600",
      mobileImageFileId: "https://picsum.photos/id/40/720/720",
      linkUrl: "/events/winter-sale",
      isActive: true,
      sortOrder: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    } as any,
    {
      id: "banner_005",
      bannerGroupId: "group_001",
      title: "신규 가입 시 10,000원 쿠폰팩",
      description: "첫 구매 원장님께 드리는 특별한 혜택",
      pcImageFileId: "https://picsum.photos/id/50/1920/600",
      mobileImageFileId: "https://picsum.photos/id/50/720/720",
      linkUrl: "/membership",
      isActive: true,
      sortOrder: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    } as any,
  ],
}

export async function HeroBanner() {
  const bannerGroup: BannerGroup | null = await getBannerGroupByCode(
    "MAIN_HERO"
  ).catch((err) => {
    console.error("getBannerGroupByCode error:", err)
    return null
  })

  // 배너 그룹 내에서 현재 노출 가능한 활성 배너만 필터링하고 정렬
  const activeBanners: BannerDto[] = getActiveBanners(bannerGroup?.banners)

  // 배너 에러 및 활성화된 배너가 없을경우, 에러 표시 대신 브랜드 문구 노출하게끔
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
        banners={MOCK_BANNER_GROUP.banners}
        pcWidth={MOCK_BANNER_GROUP.pcWidth}
        pcHeight={MOCK_BANNER_GROUP.pcHeight}
        mobileWidth={MOCK_BANNER_GROUP.mobileWidth}
        mobileHeight={MOCK_BANNER_GROUP.mobileHeight}
        // bannersWithProducts={bannersWithProducts} // todo: add bannersWithProducts
      />
    </div>
  )
}
