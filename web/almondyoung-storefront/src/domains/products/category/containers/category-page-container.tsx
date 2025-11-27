import { notFound } from "next/navigation"
import { CategoryPageClient } from "../components/category-page-client"
import { getCategoryBySlug } from "@lib/api/pim/pim-api"

interface CategoryPageContainerProps {
  params: Promise<{
    countryCode: string
    slug: string // 예: 'shampoo', 'hair-care'
  }>
}

export async function CategoryPageContainer({
  params,
}: CategoryPageContainerProps) {
  const { slug } = await params

  // 1. API 모듈을 통해 데이터 조회 (서버 -> 라우트핸들러 -> 백엔드)
  const categoryData = await getCategoryBySlug(slug)

  // 2. 데이터가 없으면 404 처리
  if (!categoryData) {
    return notFound()
  }

  // 3. UI에 필요한 메타데이터 구성 (필요시 categoryData 기반으로 생성)
  const categoryInfo = {
    title: categoryData.name,
    description: categoryData.description || "전문 뷰티 제품",
    // imageUrl 등이 있다면 여기서 매핑
  }

  return (
    <CategoryPageClient
      slug={slug}
      categoryInfo={categoryInfo}
      categoryData={categoryData}
    />
  )
}
