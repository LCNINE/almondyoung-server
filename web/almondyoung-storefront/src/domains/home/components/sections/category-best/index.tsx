import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { CategoryBestSection } from "./category-best-section"
import { getCategoryBestProducts } from "../../actions/get-category-products"

interface CategoryBestSectionContainerProps {
  initialCategories: CategoryTreeNodeDto[]
}

export async function CategoryBestSectionContainer({
  initialCategories,
}: CategoryBestSectionContainerProps) {
  // 카테고리가 없으면 빈 상태로 반환
  if (!initialCategories[0]?.id) {
    return (
      <CategoryBestSection
        initialCategories={initialCategories}
        initialProducts={undefined}
      />
    )
  }

  const products = await getCategoryBestProducts(initialCategories[0].id)

  return (
    <CategoryBestSection
      initialCategories={initialCategories}
      initialProducts={products}
    />
  )
}
