import type { Metadata } from "next"
import { notFound } from "next/navigation"
import type { SortOptions } from "@/domains/category/components/refinement-list/sort-products"
import { CategoryTemplate } from "@/domains/category/templates"
import { getCategoryByHandleCached } from "@/lib/data/category"

export const dynamic = "force-dynamic"
export const revalidate = 0

type Props = {
  params: Promise<{
    countryCode: string
    segments: string[]
  }>
  searchParams: Promise<{ page?: string }>
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { countryCode, segments } = await params
  const page = normalizePage((await searchParams).page)

  const category = await getCategoryByHandleCached(segments)

  if (!category) {
    return {
      title: "카테고리",
      description: "카테고리를 찾을 수 없습니다.",
    }
  }

  const description =
    category.description || `${category.name} 카테고리 상품을 만나보세요.`

  const base = `/${countryCode}/category/${segments.join("/")}`
  const pageUrl = (n: number) => (n <= 1 ? base : `${base}?page=${n}`)

  return {
    // 2페이지 이상은 제목에 페이지 번호를 붙인다. 안 붙이면 전 페이지가 같은
    // title/description 이라 중복으로 취급된다.
    title: page > 1 ? `${category.name} (${page}페이지)` : category.name,
    description,
    openGraph: {
      title: category.name,
      description,
    },
    alternates: {
      // countryCode 를 빼면 리다이렉트되는 주소를 canonical 로 가리키게 된다.
      // 페이지별 canonical 은 자기 자신 — 1페이지로 몰면 2페이지 이후 상품이
      // 어느 URL 에도 속하지 않게 된다.
      canonical: pageUrl(page),
    },
    ...(page > 1 ? { other: { prev: pageUrl(page - 1) } } : {}),
  }
}

// 무한스크롤은 그대로 두고, 크롤러가 따라갈 수 있는 실제 URL 만 추가한다.
// 사람이 주소창에 쳐도 같은 화면이 나오므로 UA 분기(클로킹)가 아니다.
function normalizePage(value?: string): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

type Params = {
  searchParams: Promise<{
    sortBy?: SortOptions
    limit?: string
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
  const { sortBy, limit } = searchParams
  const page = normalizePage(searchParams.page)

  const category = await getCategoryByHandleCached(params.segments)

  // 이 가드가 없으면 categoryIds가 undefined 로 흘러가 category_id 필터 없이 전체 상품이 노출된다.
  if (!category) {
    notFound()
  }

  return (
    <CategoryTemplate
      sortBy={sortBy}
      limit={limit}
      page={page}
      countryCode={params.countryCode}
      category={category}
      segments={params.segments}
    />
  )
}
