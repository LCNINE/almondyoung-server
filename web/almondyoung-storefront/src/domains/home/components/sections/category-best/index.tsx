import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { CategoryBestSection } from "./category-best-section"
import { getCategoryBestProducts } from "../../actions/get-category-products"

interface CategoryBestSectionContainerProps {
  regionId?: string
}

export async function CategoryBestSectionContainer({
  regionId,
}: CategoryBestSectionContainerProps) {
  const products = await getCategoryBestProducts(
    FIXED_CATEGORIES[0].id,
    regionId
  )

  return <CategoryBestSection initialProducts={products} regionId={regionId} />
}
