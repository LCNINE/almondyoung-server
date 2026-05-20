import { ErrorBoundary } from "@/components/shared/error-boundary"
import { MainSectionSkeleton } from "@/components/skeletons/page-skeletons"
import { HomeSection } from "@/domains/home/components/shared/home-section"
import { CategoryBestProductsWrapper } from "@/domains/home/template/best-categories"
import { InterestProductsList } from "@/domains/home/template/interest-categories/interest-products-list"
import { WelcomeDealWrapper } from "@/domains/home/template/welcome-deals"
import { getInterestCategoryKeys } from "@lib/data/cookies"
import { Suspense } from "react"

export default async function BestPage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params
  const selectedKeys = await getInterestCategoryKeys()

  return (
    <div className="w-full">
      {/* 관심 카테고리 베스트 — 설문 선택값이 있을 때만 */}
      {selectedKeys.length > 0 && (
        <HomeSection>
          <ErrorBoundary
            fallback={<div>관심 카테고리 섹션을 불러오지 못했어요.</div>}
          >
            <Suspense fallback={<MainSectionSkeleton />}>
              <InterestProductsList
                countryCode={countryCode}
                selectedKeys={selectedKeys}
              />
            </Suspense>
          </ErrorBoundary>
        </HomeSection>
      )}

      {/* 카테고리별 제품 섹션 */}
      <HomeSection>
        <ErrorBoundary
          fallback={<div>카테고리별 제품 섹션을 불러오지 못했어요.</div>}
        >
          <Suspense fallback={<MainSectionSkeleton />}>
            <CategoryBestProductsWrapper countryCode={countryCode} />
          </Suspense>
        </ErrorBoundary>
      </HomeSection>

      {/* 웰컴 딜 섹션 - 신규 회원 대상 할인 상품 */}
      <HomeSection>
        <ErrorBoundary fallback={<div>웰컴 딜 섹션을 불러오지 못했어요.</div>}>
          <Suspense fallback={<MainSectionSkeleton />}>
            <WelcomeDealWrapper countryCode={countryCode} />
          </Suspense>
        </ErrorBoundary>
      </HomeSection>
    </div>
  )
}
