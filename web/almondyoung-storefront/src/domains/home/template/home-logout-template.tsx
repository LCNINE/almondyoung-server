import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { MembershipBanner } from "../components/banner/membership-banner"

import { ProductListSection } from "../components/common/product-list-section"
import { CategoryBestSection } from "../components/sections/category-best"

interface HomeLogoutTemplateProps {
  initialCategories: CategoryTreeNodeDto[]
}

/*──────────────────
 * 비로그인 사용자용
 *─────────────────*/
export function HomeLogoutTemplate({
  initialCategories,
}: HomeLogoutTemplateProps) {
  return (
    <div className="w-full">
      {/* 카테고리별 제품 섹션 */}
      <ProductListSection>
        <CategoryBestSection initialCategories={initialCategories} />
      </ProductListSection>

      {/* 멤버십 배너 섹션 */}
      <ProductListSection>
        <MembershipBanner className="mb-4" />
      </ProductListSection>
    </div>
  )
}
