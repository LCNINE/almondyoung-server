import { notFound } from "next/navigation"
import { CategorySubPageClient } from "../components/category-sub-page-client"
import { getCategoryByHandle } from "@lib/api/medusa/categories"
import { getProductList } from "@lib/api/medusa/products"
import { getRegion } from "@lib/api/medusa/regions"
import { mapMedusaProductsToCards } from "@lib/utils/map-medusa-product-card"
import type { StoreProductCategoryTree } from "@lib/types/medusa-category"

interface CategorySubPageContainerProps {
  params: Promise<{
    countryCode: string
    slug: string // 부모 카테고리 slug
    sub: string // 서브 카테고리 slug
  }>
}

export async function CategorySubPageContainer({
  params,
}: CategorySubPageContainerProps) {
  const { slug, sub: subSlug, countryCode } = await params
  const region = await getRegion(countryCode)

  const parentCategory = await getCategoryByHandle(slug)
  const categoryData = parentCategory
    ? findCategoryByHandle(parentCategory.category_children ?? [], subSlug)
    : null
  if (!categoryData) {
    return notFound()
  }

  // UI에 필요한 메타데이터 구성
  const categoryInfo = {
    title: categoryData.name,
    description: categoryData.description ?? "",
  }

  // 카테고리별 상품 목록 로드
  console.log(`🚀 [CategorySubPageContainer] 상품 목록 로드 시작:`, {
    categoryId: categoryData.id,
    categoryName: categoryData.name,
  })

  let initialProducts: any[] = []
  let initialTotal = 0

  try {
    const categoryIds = collectCategoryIds(categoryData)
    const productsResult = await getProductList({
      page: 1,
      limit: 20,
      categoryId: categoryIds,
      region_id: region?.id,
    })
    initialProducts = mapMedusaProductsToCards(productsResult.products)
    initialTotal = productsResult.count
    console.log(`✅ [CategorySubPageContainer] 상품 목록 로드 완료:`, {
      itemCount: initialProducts.length,
      total: initialTotal,
    })
  } catch (error) {
    console.error("❌ [CategorySubPageContainer] 상품 목록 로드 실패:", error)
    // 에러 발생 시 빈 배열로 계속 진행
  }

  return (
    <CategorySubPageClient
      subSlug={subSlug}
      categoryInfo={categoryInfo}
      categoryData={categoryData}
      initialProducts={initialProducts}
      initialTotal={initialTotal}
      countryCode={countryCode}
    />
  )
}

const findCategoryByHandle = (
  categories: StoreProductCategoryTree[],
  handle: string
): StoreProductCategoryTree | null => {
  for (const category of categories) {
    if (category.handle === handle) {
      return category
    }

    if (category.category_children?.length) {
      const found = findCategoryByHandle(category.category_children, handle)
      if (found) {
        return found
      }
    }
  }

  return null
}

const collectCategoryIds = (category: StoreProductCategoryTree) => {
  const ids: string[] = []

  const walk = (node: StoreProductCategoryTree) => {
    ids.push(node.id)
    node.category_children?.forEach((child) => walk(child))
  }

  walk(category)

  return ids
}
