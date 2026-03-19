import { CategoryBestSectionSkeleton } from "@/components/skeletons/page-skeletons"
import { UserDetail } from "@/lib/types/ui/user"
import { Suspense } from "react"
import { HeroBanner } from "../components/banner/hero-banner"
import { HomeSection } from "../components/shared/home-section"
import { CategoryBestProductsWrapper } from "./best-categories"
import { ErrorBoundary } from "@/components/shared/error-boundary"

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

interface HomeLogoutTemplateProps {
  user: UserDetail | null
  countryCode: string
}

/*──────────────────
 * 비로그인 사용자용
 *─────────────────*/
export async function HomeLogoutTemplate({
  user,
  countryCode,
}: HomeLogoutTemplateProps) {
  return (
    <div className="w-full">
      {/* 메인 히어로 배너 */}
      <HeroBanner />

      {/* 카테고리별 제품 섹션  */}
      <HomeSection>
        <ErrorBoundary
          fallback={<div>카테고리별 제품 섹션을 불러오지 못했어요.</div>}
        >
          <Suspense fallback={<CategoryBestSectionSkeleton />}>
            <CategoryBestProductsWrapper countryCode={countryCode} />
          </Suspense>
        </ErrorBoundary>
      </HomeSection>

      {/* 웰컴 딜 섹션 - 신규 회원 대상 할인 상품 */}
      {/* <ProductListSection className="border-t md:border-t-0">
        <WelcomeDealSection products={welcomeDealProducts} />
      </ProductListSection> */}
    </div>
  )
}
