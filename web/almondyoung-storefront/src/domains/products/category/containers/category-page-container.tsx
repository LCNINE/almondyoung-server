import { notFound } from "next/navigation"
import { CategoryPageClient } from "../components/category-page-client"
import { getCategoryBySlug } from "@lib/api/pim/categories"
import { getProductsByCategoryService } from "@lib/services/pim/products/getProductListService"

interface CategoryPageContainerProps {
  params: Promise<{
    countryCode: string
    slug: string // 예: 'shampoo', 'hair-care'
  }>
}

export async function CategoryPageContainer({
  params,
}: CategoryPageContainerProps) {
  const { slug, countryCode } = await params

  // 1. API 모듈을 통해 데이터 조회 (서버 액션 -> 백엔드)
  const result = await getCategoryBySlug(slug)

  // 2. 에러 처리
  if ("error" in result) {
    console.error(
      "❌ [CategoryPageContainer] 카테고리 조회 실패:",
      result.error
    )
    return notFound()
  }

  const categoryData = result.data
  if (!categoryData) {
    return notFound()
  }

  // 3. UI에 필요한 메타데이터 구성 (필요시 categoryData 기반으로 생성)
  const categoryInfo = {
    title: categoryData.name,
    description: categoryData.description || "전문 뷰티 제품",
    // imageUrl 등이 있다면 여기서 매핑
  }

  // 4. 카테고리별 상품 목록 로드
  console.log(`🚀 [CategoryPageContainer] 상품 목록 로드 시작:`, {
    categoryId: categoryData.id,
    categoryName: categoryData.name,
  })

  let initialProducts: any[] = []
  let initialTotal = 0

  try {
    const productsResult = await getProductsByCategoryService(categoryData.id, {
      page: 1,
      limit: 20,
    })
    initialProducts = productsResult.items
    initialTotal = productsResult.total
    console.log(`✅ [CategoryPageContainer] 상품 목록 로드 완료:`, {
      itemCount: initialProducts.length,
      total: initialTotal,
    })
  } catch (error) {
    console.error("❌ [CategoryPageContainer] 상품 목록 로드 실패:", error)
    // 에러 발생 시 빈 배열로 계속 진행
  }

  return (
    <CategoryPageClient
      slug={slug}
      categoryInfo={categoryInfo}
      categoryData={categoryData}
      initialProducts={initialProducts}
      initialTotal={initialTotal}
      countryCode={countryCode}
    />
  )
}
