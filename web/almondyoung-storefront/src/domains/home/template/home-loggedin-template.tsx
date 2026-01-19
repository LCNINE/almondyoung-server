import type { UserDetail } from "@/lib/types/ui/user"
import { HeroBanner } from "../components/banner/hero-banner"
import { WidgetSection } from "../components/sections/widget"
import { ProductListSection } from "../components/shared/product-list-section"

interface HomeLoggedInTemplateProps {
  user: UserDetail
}

/*───────────────────────────────────────────────
 * 로그인한 사용자용 todo: 추후 수정 필요 미완성
 *───────────────────────────────────────────────*/
export function HomeLoggedInTemplate({ user }: HomeLoggedInTemplateProps) {
  return (
    <div className="w-full">
      {/* 메인 히어로 배너 */}
      <HeroBanner />

      <ProductListSection className="border-none">
        <WidgetSection />
      </ProductListSection>
    </div>
  )
}
