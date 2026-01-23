import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { CategoryBestSection } from "./category-best-section"
import { getCategoryBestProducts } from "../../actions/get-category-products"

interface CategoryBestSectionContainerProps {
  initialCategories: StoreProductCategoryTree[]
  regionId?: string
}

export async function CategoryBestSectionContainer({
  initialCategories,
  regionId,
}: CategoryBestSectionContainerProps) {
  // 카테고리가 없으면 빈 상태로 반환
  if (!initialCategories[0]?.id) {
    return (
      <CategoryBestSection
        initialCategories={initialCategories}
        initialProducts={undefined}
        regionId={regionId}
      />
    )
  }

  const products = await getCategoryBestProducts(
    initialCategories[0].id,
    regionId
  )

  return (
    <CategoryBestSection
      initialCategories={initialCategories}
      initialProducts={products}
      regionId={regionId}
    />
  )
}
