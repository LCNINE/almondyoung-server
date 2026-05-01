import CategoryPillDropdown from "@/components/category/category-pill-dropdown"
import RankedKeywordList, { Keyword } from "./ranked-keyword-list"

export default function RankedHeader({ title }: { title: string }) {
  return (
    <>
      <div className="relative h-12 w-full">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <CategoryPillDropdown />
        </div>
        {/* 오른쪽 버튼 */}
        <button className="absolute top-1/2 right-0 -translate-y-1/2 pr-4 text-sm text-gray-500">
          랭킹기준
          <span className="text-gray-400">ⓘ</span>
        </button>
      </div>
      <div className="flex flex-col items-center justify-center gap-4">
        <h2 className="mb-6 text-2xl font-extrabold md:text-3xl">{title}</h2>
      </div>
    </>
  )
}
