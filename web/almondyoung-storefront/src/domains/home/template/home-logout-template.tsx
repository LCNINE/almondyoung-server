import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { Suspense } from "react"
import { HeroBanner } from "../components/banner/hero-banner"
import LashBannerBanner from "../components/banner/lashbanner-banner"
import { LoginPromptBanner } from "../components/banner/login-prompt-banner"
import MembershipBanner from "../components/banner/membership-banner"
import { BundleSection } from "../components/sections/bundle"
import { CategoryBestSectionContainer } from "../components/sections/category-best"
import { DigitalAssetSection } from "../components/sections/digital-asset"
import { TimeSaleSection } from "../components/sections/time-sale"
import { WelcomeDealSection } from "../components/sections/welcome-deal"
import { ProductListSection } from "../components/shared/product-list-section"

interface HomeLogoutTemplateProps {
  initialCategories: CategoryTreeNodeDto[]
}

/*──────────────────
 * 비로그인 사용자용
 *─────────────────*/
export async function HomeLogoutTemplate({
  initialCategories,
}: HomeLogoutTemplateProps) {
  return (
    <div className="w-full">
      {/* 메인 히어로 배너 */}
      <HeroBanner />

      {/* 로그인 유도 배너 */}
      <LoginPromptBanner />

      {/* 카테고리별 제품 섹션  */}
      <ProductListSection>
        <Suspense
          fallback={
            <div className="flex min-h-96 items-center justify-center">
              <p className="text-gray-500">로딩 중...</p>
            </div>
          }
        >
          <CategoryBestSectionContainer initialCategories={initialCategories} />
        </Suspense>
      </ProductListSection>

      {/* 멤버십 배너 (데스크탑) */}
      <div className="hidden w-full border-t border-gray-200 md:block">
        <ProductListSection.Inner className="px-0 pt-5 md:container md:mx-auto md:max-w-[1360px] md:px-[40px]">
          <MembershipBanner />
        </ProductListSection.Inner>
      </div>

      {/* 웰컴 딜 섹션 */}
      <ProductListSection className="border-t md:border-t-0">
        <WelcomeDealSection />
      </ProductListSection>

      {/* 래쉬 배너 (모바일) */}
      <div className="w-full border-t border-gray-200 md:hidden">
        <ProductListSection.Inner className="px-0 pt-5 md:container md:mx-auto md:max-w-[1360px] md:px-[40px]">
          <LashBannerBanner />
        </ProductListSection.Inner>
      </div>

      {/* 타임 세일 섹션 */}
      <ProductListSection>
        <TimeSaleSection initialCategories={initialCategories} />
      </ProductListSection>

      {/* 디지털 템플릿 섹션 */}
      <ProductListSection>
        <DigitalAssetSection />
      </ProductListSection>

      {/* 한꺼번에 구매 시 할인이 늘어나요 섹션 */}
      <ProductListSection>
        <BundleSection />
      </ProductListSection>
    </div>
  )
}
