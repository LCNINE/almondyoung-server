import { SearchContainer } from "domains/search/search"

interface SearchPageProps {
  params: Promise<{
    countryCode: string
  }>
  searchParams: Promise<{
    q?: string
    page?: string
    sort?: string
    brands?: string
    minPrice?: string
    maxPrice?: string
  }>
}

export default async function SearchPage({
  params,
  searchParams,
}: SearchPageProps) {
  return (
    <div className="container mx-auto max-w-[1360px] px-4 py-6 md:px-[40px]">
      <SearchContainer params={params} searchParams={searchParams} />
    </div>
  )
}
