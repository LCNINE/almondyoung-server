import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { SearchPageSkeleton } from "@/components/skeletons/page-skeletons"
import { SearchTemplate } from "domains/search/search"
import { Suspense } from "react"
import type { Metadata } from "next"
import { NOINDEX } from "@lib/seo"

export const metadata: Metadata = { robots: NOINDEX }

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
      <SiteBreadcrumb className="mb-4" items={[{ label: "검색" }]} />
      <Suspense key={q} fallback={<SearchPageSkeleton />}>
        <SearchTemplate params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  )
}
