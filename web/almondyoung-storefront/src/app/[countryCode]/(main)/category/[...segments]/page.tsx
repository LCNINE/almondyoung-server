import type { Metadata } from "next"
import { SortOptions } from "@/domains/category/components/refinement-list/sort-products"
import { CategoryTemplate } from "@/domains/category/templates"
import { siteConfig } from "@/lib/config/site"
import { getCategoryByHandle } from "@/lib/api/medusa/categories"

type Props = {
  params: Promise<{
    countryCode: string
    segments: string[]
  }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { segments } = await params

  const category = await getCategoryByHandle(segments)

  if (!category) {
    return {
      title: "카테고리",
      description: "카테고리를 찾을 수 없습니다.",
    }
  }

  const description =
    category.description || `${category.name} 카테고리 상품을 만나보세요.`

  return {
    title: category.name,
    description,
    openGraph: {
      title: `${category.name} | ${siteConfig.appName}`,
      description,
    },
    alternates: {
      canonical: `/category/${segments.join("/")}`,
    },
  }
}

type Params = {
  searchParams: Promise<{
    sortBy?: SortOptions
    page?: string
  }>
  params: Promise<{
    countryCode: string
    segments: string[]
  }>
}

export default async function CategoryPage(props: Params) {
  const params = await props.params
  const searchParams = await props.searchParams
  const { sortBy, page } = searchParams

  const category = await getCategoryByHandle(params.segments)

  return (
    <CategoryTemplate
      sortBy={sortBy}
      page={page}
      countryCode={params.countryCode}
      category={category}
      segments={params.segments}
    />
  )
}
