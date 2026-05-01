import { SearchPageSkeleton } from "@/components/skeletons/page-skeletons"
import { SearchContainer } from "domains/search/search"
import { Suspense } from "react"

interface SearchPageProps {
  params: Promise<{
    countryCode: string
  }>
  searchParams: Promise<{
    q?: string
    page?: string
    sort?: string | string[]
    categoryIds?: string | string[]
    brands?: string | string[]
    minPrice?: string
    maxPrice?: string
  }>
}

export default async function SearchPage({
  params,
  searchParams,
}: SearchPageProps) {
  const { q = "" } = await searchParams
  return (
    <div className="container mx-auto max-w-[1360px] px-4 py-6 md:px-[40px]">
      <Suspense key={q} fallback={<SearchPageSkeleton />}>
        <SearchContainer params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  )
}
