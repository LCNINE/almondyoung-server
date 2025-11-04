import Search from "domains/search/search"

interface SearchPageProps {
  searchParams: {
    q?: string
    page?: string
    sort?: string
  }
}

export default function SearchPage({ searchParams }: SearchPageProps) {
  return (
    <div className="container mx-auto max-w-[1360px] px-4 py-6 md:px-[40px]">
      <Search />
    </div>
  )
}
