import { ErrorBoundary } from "@/components/shared/error-boundary"
import { MainSectionSkeleton } from "@/components/skeletons/page-skeletons"
import type { UserDetail } from "@/lib/types/ui/user"
import { Suspense } from "react"
import { HeroBanner } from "../components/banner/hero-banner"
import { HomeQuickLinks } from "../components/quick-links"
import { WidgetSection } from "../components/sections/widget"
import { HomeSection } from "../components/shared/home-section"
import { BrandShowcaseWrapper } from "./brand-showcase"

interface HomeLoggedInTemplateProps {
  user: UserDetail
}

/*───────────────────────────────────────────────
 * 로그인한 사용자용 todo: 추후 수정 필요 미완성
 *───────────────────────────────────────────────*/
export async function HomeLoggedInTemplate({
  user,
}: HomeLoggedInTemplateProps) {
  return (
    <div className="w-full">
      {/* 메인 히어로 배너 */}
      <HeroBanner />

      <div className="xl:hidden">
        <HomeQuickLinks />
      </div>

      {/* 브랜드별 탐색 — 비로그인 템플릿과 동일 섹션 */}
      <ErrorBoundary fallback={null}>
        <Suspense
          fallback={
            <HomeSection>
              <MainSectionSkeleton />
            </HomeSection>
          }
        >
          <BrandShowcaseWrapper />
        </Suspense>
      </ErrorBoundary>

      <HomeSection className="border-none">
        <WidgetSection />
      </HomeSection>
    </div>
  )
}
