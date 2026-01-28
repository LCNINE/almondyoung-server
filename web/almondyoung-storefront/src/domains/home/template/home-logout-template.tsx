import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { Suspense } from "react"
import { HeroBanner } from "../components/banner/hero-banner"
import LashBannerBanner from "../components/banner/lashbanner-banner"
import { LoginPromptBanner } from "../components/banner/login-prompt-banner"
import MembershipBanner from "../components/banner/membership-banner"
import { CategoryBestSectionContainer } from "../components/sections/category-best"
import { ProductListSection } from "../components/shared/product-list-section"

/*
 * ============================================================================
 * MEDUSA PROMOTION 연동 가이드 (향후 구현용)
 * ============================================================================
 *
 * 아래 섹션들은 Medusa의 Promotion 모듈과 연동하여 구현해야 합니다.
 * 현재는 주석 처리되어 있으며, 프로모션 시스템 구축 후 활성화하세요.
 *
 * ## 1. Medusa Promotion 기본 개념
 *
 * Medusa v2에서 Promotion은 다음과 같은 구조를 가집니다:
 * - Promotion: 할인 캠페인 (예: 웰컴딜, 타임세일)
 * - PromotionRule: 프로모션 적용 조건 (상품, 카테고리, 고객 등)
 * - Campaign: 여러 프로모션을 그룹화 (예: 신규 회원 캠페인)
 *
 * ## 2. 프로모션 타입별 구현 방법
 *
 * ### 웰컴딜 (WelcomeDealSection)
 * - Campaign: "welcome-deal"
 * - 조건: is_automatic=true, application_method.type="automatic"
 * - 대상: 신규 가입 회원
 * - API:
 *   ```typescript
 *   const { promotions } = await sdk.store.promotion.list({
 *     campaign_id: "welcome-deal-campaign-id",
 *     is_automatic: true
 *   })
 *   // 프로모션에 연결된 상품 ID 추출
 *   const productIds = promotions.flatMap(p =>
 *     p.rules?.filter(r => r.attribute === "items.product.id")
 *       .flatMap(r => r.values?.map(v => v.value))
 *   )
 *   const products = await getProductsByIds(productIds)
 *   ```
 *
 * ### 타임세일 (TimeSaleSection)
 * - Campaign: "time-sale"
 * - 조건: starts_at, ends_at 설정 (시간 제한)
 * - 구현:
 *   ```typescript
 *   const now = new Date()
 *   const { promotions } = await sdk.store.promotion.list({
 *     campaign_id: "time-sale-campaign-id",
 *     starts_at: { $lte: now },
 *     ends_at: { $gte: now }
 *   })
 *   ```
 *
 * ### 번들 할인 (BundleSection)
 * - type: "buyget" (Buy X Get Y)
 * - application_method.type: "automatic"
 * - 구현:
 *   ```typescript
 *   const { promotions } = await sdk.store.promotion.list({
 *     type: ["buyget"],
 *     is_automatic: true
 *   })
 *   ```
 *
 * ### 디지털 에셋 (DigitalAssetSection)
 * - 별도 카테고리로 관리 권장
 * - product.metadata.type = "digital" 로 필터링
 *
 * ## 3. 프로모션 Admin 설정 가이드
 *
 * Medusa Admin에서 프로모션 생성 시:
 * 1. Promotion > Create Promotion
 * 2. Code: 프로모션 식별자 (예: WELCOME100)
 * 3. Type: "standard" 또는 "buyget"
 * 4. Application Method:
 *    - Type: "automatic" (자동 적용) 또는 "code" (코드 입력)
 *    - Value: 할인 금액 또는 비율
 *    - Target Type: "order" (주문) 또는 "items" (상품)
 * 5. Rules: 적용 조건 설정
 *    - items.product.id: 특정 상품
 *    - items.product.category_id: 특정 카테고리
 *    - customer.groups.id: 특정 고객 그룹
 *
 * ## 4. 필요한 API 엔드포인트
 *
 * lib/api/medusa/promotions.ts 생성 필요:
 * ```typescript
 * export async function getActivePromotions(campaignId?: string) {
 *   const { promotions } = await sdk.store.promotion.list({
 *     campaign_id: campaignId,
 *     is_automatic: true,
 *     fields: "+rules,+rules.values"
 *   })
 *   return promotions
 * }
 *
 * export async function getPromotionProducts(promotionId: string) {
 *   const promotion = await sdk.store.promotion.retrieve(promotionId, {
 *     fields: "+rules,+rules.values"
 *   })
 *   const productIds = promotion.rules
 *     ?.filter(r => r.attribute === "items.product.id")
 *     .flatMap(r => r.values?.map(v => v.value) || [])
 *   return getProductsByIds(productIds || [])
 * }
 * ```
 *
 * ============================================================================
 */

// 프로모션 연동 시 활성화할 imports
// import { getProductList } from "@/lib/api/medusa/products"
// import { mapStoreProductsToCardProps } from "@/lib/utils/product-card"
// import type { ProductCardProps } from "@/lib/types/ui/product"
// import { BundleSection } from "../components/sections/bundle"
// import { DigitalAssetSection } from "../components/sections/digital-asset"
// import { TimeSaleSection } from "../components/sections/time-sale"
// import { WelcomeDealSection } from "../components/sections/welcome-deal"
// import { getTimeSaleProducts } from "../components/actions/get-category-products"

interface HomeLogoutTemplateProps {
  initialCategories: StoreProductCategoryTree[]
  regionId?: string
}

/*──────────────────
 * 비로그인 사용자용
 *─────────────────*/
export async function HomeLogoutTemplate({
  initialCategories,
  regionId,
}: HomeLogoutTemplateProps) {
  /*
   * ========================================================================
   * 프로모션 섹션 데이터 로딩 (현재 비활성화)
   * ========================================================================
   *
   * Medusa Promotion 연동 후 아래 코드를 활성화하세요.
   *
   * 1. lib/api/medusa/promotions.ts 파일 생성
   * 2. 각 섹션별 프로모션 캠페인 ID 설정
   * 3. 아래 데이터 로딩 로직 활성화
   *
   * ========================================================================
   */

  // const findCategoryByHandle = (
  //   categories: StoreProductCategoryTree[],
  //   handle: string
  // ): StoreProductCategoryTree | undefined => {
  //   for (const category of categories) {
  //     if (category.handle === handle) return category
  //     if (category.category_children?.length) {
  //       const match = findCategoryByHandle(category.category_children, handle)
  //       if (match) return match
  //     }
  //   }
  //   return undefined
  // }

  // const fetchSectionProducts = async (
  //   handle: string,
  //   fallbackLimit = 12
  // ): Promise<ProductCardProps[]> => {
  //   try {
  //     const category = findCategoryByHandle(initialCategories, handle)
  //     const list = await getProductList({
  //       categoryId: category?.id,
  //       region_id: regionId,
  //       limit: fallbackLimit,
  //     })
  //     const mapped = mapStoreProductsToCardProps(list.products || [])
  //     if (mapped.length > 0 || !category?.id) {
  //       return mapped
  //     }
  //
  //     const fallbackList = await getProductList({
  //       region_id: regionId,
  //       limit: fallbackLimit,
  //     })
  //     return mapStoreProductsToCardProps(fallbackList.products || [])
  //   } catch (error) {
  //     console.error(`홈 섹션 상품 로드 실패: ${handle}`, error)
  //     return []
  //   }
  // }

  // const timeSaleInitialCategory = initialCategories[0]

  // Medusa Promotion 연동 시 아래 코드 활성화
  // const [
  //   welcomeDealProducts,
  //   digitalAssetProducts,
  //   bundleProducts,
  //   timeSaleInitialProducts,
  // ] = await Promise.all([
  //   fetchSectionProducts("welcome-deal"),      // TODO: getPromotionProducts("welcome-deal-campaign-id")로 변경
  //   fetchSectionProducts("digital-asset"),     // TODO: getProductsByMetadata({ type: "digital" })로 변경
  //   fetchSectionProducts("bulk-discount"),     // TODO: getBuyGetPromotionProducts()로 변경
  //   timeSaleInitialCategory?.id
  //     ? getTimeSaleProducts(timeSaleInitialCategory.id, regionId)
  //     : Promise.resolve([]),                   // TODO: getTimeSalePromotionProducts()로 변경
  // ])

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
          <CategoryBestSectionContainer
            initialCategories={initialCategories}
            regionId={regionId}
          />
        </Suspense>
      </ProductListSection>

      {/* 멤버십 배너 (데스크탑) */}
      <div className="hidden w-full border-t border-gray-200 md:block">
        <ProductListSection.Inner className="px-0 pt-5 md:container md:mx-auto md:max-w-[1360px] md:px-[40px]">
          <MembershipBanner />
        </ProductListSection.Inner>
      </div>

      {/*
       * ====================================================================
       * 프로모션 섹션들 (Medusa Promotion 연동 후 활성화)
       * ====================================================================
       *
       * 아래 섹션들은 Medusa Promotion 모듈 연동 후 활성화하세요.
       *
       * 구현 순서:
       * 1. Medusa Admin에서 각 프로모션 캠페인 생성
       * 2. lib/api/medusa/promotions.ts에서 API 함수 구현
       * 3. 위의 데이터 로딩 코드 활성화
       * 4. 아래 JSX 주석 해제
       *
       * ====================================================================
       */}

      {/* 웰컴 딜 섹션 - 신규 회원 대상 할인 상품 */}
      {/* <ProductListSection className="border-t md:border-t-0">
        <WelcomeDealSection products={welcomeDealProducts} />
      </ProductListSection> */}

      {/* 래쉬 배너 (모바일) */}
      <div className="w-full border-t border-gray-200 md:hidden">
        <ProductListSection.Inner className="px-0 pt-5 md:container md:mx-auto md:max-w-[1360px] md:px-[40px]">
          <LashBannerBanner />
        </ProductListSection.Inner>
      </div>

      {/* 타임 세일 섹션 - 시간 제한 할인 상품 */}
      {/* <ProductListSection>
        <TimeSaleSection
          initialCategories={initialCategories}
          initialProducts={timeSaleInitialProducts}
          regionId={regionId}
        />
      </ProductListSection> */}

      {/* 디지털 템플릿 섹션 - 디지털 상품 */}
      {/* <ProductListSection>
        <DigitalAssetSection products={digitalAssetProducts} />
      </ProductListSection> */}

      {/* 번들 섹션 - Buy X Get Y 할인 상품 */}
      {/* <ProductListSection>
        <BundleSection products={bundleProducts} />
      </ProductListSection> */}
    </div>
  )
}
