import { getCategoryTree } from "@lib/api/medusa/categories"
import { CategorySidebar } from "@/domains/products/category/components/category-sidebar"

interface CategorySidebarContainerProps {
  countryCode: string
}

export async function CategorySidebarContainer({
  countryCode,
}: CategorySidebarContainerProps) {
  const categories = await getCategoryTree().catch(() => [])

  if (categories.length === 0) {
    return null
  }

  return <CategorySidebar categories={categories} countryCode={countryCode} />
}
