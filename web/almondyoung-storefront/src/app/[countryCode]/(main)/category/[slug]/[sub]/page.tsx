import { CategorySubPageContainer } from "domains/products/category/containers/category-sub-page-container"

interface CategorySubPageProps {
  params: Promise<{
    countryCode: string
    slug: string
    sub: string
  }>
}

export default async function CategorySubPage({
  params,
}: CategorySubPageProps) {
  return <CategorySubPageContainer params={params} />
}
