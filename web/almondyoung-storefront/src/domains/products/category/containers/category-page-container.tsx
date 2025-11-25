import { CategoryPageClient } from "../components/category-page-client"
import { CATEGORY_DATA, CategorySlug } from "../types/category-types"

interface CategoryPageContainerProps {
    params: Promise<{
        countryCode: string
        slug: string
    }>
}

export async function CategoryPageContainer({
    params,
}: CategoryPageContainerProps) {
    const { slug } = await params
    const categoryInfo = CATEGORY_DATA[slug as CategorySlug] || {
        title: "카테고리",
        description: "전문 뷰티 제품",
    }

    return <CategoryPageClient slug={slug} categoryInfo={categoryInfo} />
}
