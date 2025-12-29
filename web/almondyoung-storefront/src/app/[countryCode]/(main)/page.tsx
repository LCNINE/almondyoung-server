import { ThemeManager } from "@components/common/theme-manager"
import ProtectedRoute from "@components/protected-route"
import { getCategoryTree } from "@lib/api/pim/categories.server"
import { getProductsByCategoryService } from "@lib/services/pim/products/getProductListService"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim.dto"
import type { ProductCard } from "@lib/types/ui/product"
import HomeTemplate from "domains/home/template/home-template"

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  // 카테고리 트리 조회
  let categories: CategoryTreeNodeDto[] = []
  let initialCategoryProducts: ProductCard[] = []
  let initialCategoryId: string | null = null

  try {
    const result = await getCategoryTree()
    if (result.error) {
      console.error("❌ [Home] 카테고리 조회 실패:", result.error)
    } else {
      categories = result.data?.categories || []
    }

    // 첫 번째 카테고리 선택 (또는 루트 카테고리의 첫 번째 자식)
    if (categories.length > 0) {
      // 루트 카테고리의 첫 번째 자식이 있으면 그것을 사용, 없으면 루트 카테고리 사용
      const firstCategory = categories[0]
      initialCategoryId =
        firstCategory.children && firstCategory.children.length > 0
          ? firstCategory.children[0].id
          : firstCategory.id

      // 초기 카테고리의 제품 목록 조회
      if (initialCategoryId) {
        const productsResult = await getProductsByCategoryService(
          initialCategoryId,
          {
            page: 1,
            limit: 20,
          }
        )
        initialCategoryProducts = productsResult.items || []
      }
    }
  } catch (error) {
    console.error("❌ [Home] 카테고리/제품 로드 실패:", error)
    // 에러 발생 시 빈 배열로 계속 진행
  }

  return (
    <ProtectedRoute>
      <HomeTemplate
        categories={categories}
        initialCategoryId={initialCategoryId}
        initialCategoryProducts={initialCategoryProducts}
      />

      {/* 테마 매니저 (개발 모드에서만 표시) */}
      {process.env.NODE_ENV === "development" && <ThemeManager />}
    </ProtectedRoute>
  )
}
