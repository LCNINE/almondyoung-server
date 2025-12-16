import { notFound } from "next/navigation"
import { CategorySubPageClient } from "../components/category-sub-page-client"
import { getCategoryBySlug } from "@lib/api/pim/categories.server"
import { getProductsByCategoryService } from "@lib/services/pim/products/getProductListService"

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

  // 서브 카테고리 정보 조회 (subSlug로 직접 조회)
  const result = await getCategoryBySlug(subSlug)

  // 에러 처리
  if ("error" in result) {
    console.error("❌ [CategorySubPageContainer] 카테고리 조회 실패:", result.error)
    return notFound()
  }

  const categoryData = result.data
  if (!categoryData) {
    return notFound()
  }

  // UI에 필요한 메타데이터 구성
  const categoryInfo = {
    title: categoryData.name,
    description: categoryData.description || "전문 뷰티 제품",
  }

  // 카테고리별 상품 목록 로드
  console.log(`🚀 [CategorySubPageContainer] 상품 목록 로드 시작:`, {
    categoryId: categoryData.id,
    categoryName: categoryData.name,
  })

  let initialProducts: any[] = []
  let initialTotal = 0

  try {
    const productsResult = await getProductsByCategoryService(
      categoryData.id,
      {
        page: 1,
        limit: 20,
      }
    )
    initialProducts = productsResult.items
    initialTotal = productsResult.total
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
      slug={slug}
      subSlug={subSlug}
      categoryInfo={categoryInfo}
      categoryData={categoryData}
      initialProducts={initialProducts}
      initialTotal={initialTotal}
      countryCode={countryCode}
      parentSlug={categoryData.slug}
    />
  )
}

