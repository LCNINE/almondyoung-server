import { getBestOrderMetricsByCategory } from "@/lib/api/analytics"
import { getProductList } from "@/lib/api/medusa/products"
import { getReviewsByProductId } from "@/lib/api/ugc"
import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import { ReviewResponseDto } from "@/lib/types/dto/ugc"
import type { ProductsResponseDto } from "@lib/types/dto/medusa"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { HeroBanner } from "../components/banner/hero-banner"
import LashBannerBanner from "../components/banner/lashbanner-banner"
import { LoginPromptBanner } from "../components/banner/login-prompt-banner"
import MembershipBanner from "../components/banner/membership-banner"
import { BundleSection } from "../components/sections/bundle"
import { CategoryBestSection } from "../components/sections/category-best"
import { DigitalAssetSection } from "../components/sections/digital-asset"
import { TimeSaleSection } from "../components/sections/time-sale"
import { WelcomeDealSection } from "../components/sections/welcome-deal"
import { ProductListSection } from "../components/shared/product-list-section"
import { ProductWithReviews } from "@/lib/types/ui/product"

interface HomeLogoutTemplateProps {
  initialCategories: CategoryTreeNodeDto[]
}

/*──────────────────
 * 비로그인 사용자용
 *─────────────────*/
export async function HomeLogoutTemplate({
  initialCategories,
}: HomeLogoutTemplateProps) {
  const bestOrderMetrics = await getBestOrderMetricsByCategory(
    initialCategories[0].id
  )
  const masterIds = bestOrderMetrics.map((metric) => metric.masterId)

  const bestProducts: ProductsResponseDto | null =
    masterIds.length > 0 ? await getProductList({ handle: masterIds }) : null

  let reviews: PaginatedResponseDto<ReviewResponseDto>[] = []

  if (bestProducts?.products) {
    reviews = await Promise.all(
      bestProducts.products.map(async (product) => {
        return await getReviewsByProductId({
          productId: product.id,
        })
      })
    )
  }

  const bestProdcutsWithReviews: ProductWithReviews[] | undefined =
    bestProducts?.products?.map((product) => {
      const productReview = reviews.find(
        (review) =>
          review.data.length > 0 && review.data[0].productId === product.id
      )
      return {
        ...product,
        reviews: productReview?.data,
      }
    })

  return (
    <div className="w-full">
      {/* 메인 히어로 배너 */}
      <HeroBanner />

      {/* 로그인 유도 배너 */}
      <LoginPromptBanner />

      {/* 카테고리별 제품 섹션 */}
      <ProductListSection>
        <CategoryBestSection
          initialCategories={initialCategories}
          initialProducts={bestProducts?.products || null}
        />
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
