import { CategoryPageContainer } from "domains/products/category/containers/category-page-container"

interface CategoryPageProps {
  params: Promise<{
    countryCode: string
    slug: string
  }>
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  return <CategoryPageContainer params={params} />
}
