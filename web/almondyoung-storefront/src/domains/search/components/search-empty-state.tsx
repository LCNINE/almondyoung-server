"use client"

import { SearchX } from "lucide-react"
import { SearchHistory } from "@components/search/search-history"
// import { SearchPopularKeyword } from "@components/search/search-popular-keyword"
// import { SearchHotKeyword } from "@components/search/search-hot-keyword"

interface SearchEmptyStateProps {
  keyword: string
  historyKeywords: string[]
}

export function SearchEmptyState({
  keyword,
  historyKeywords,
}: SearchEmptyStateProps) {
  return (
    <div className="flex flex-col">
      {/* 검색 결과 없음 안내 */}
      <div className="mb-10 flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
          <SearchX className="h-8 w-8 text-gray-400" />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          <span className="text-olive-600">&apos;{keyword}&apos;</span>에 대한
          검색결과가 없습니다
        </h2>
        <p className="text-sm text-gray-500">
          다른 검색어로 다시 검색해 보세요
        </p>

        <ul className="mt-6 space-y-1 text-left text-sm text-gray-600">
          <li className="flex items-center gap-2">
            <span className="text-olive-600">•</span>
            단어의 철자가 정확한지 확인해 보세요
          </li>
          <li className="flex items-center gap-2">
            <span className="text-olive-600">•</span>
            검색어를 줄이거나 다른 검색어로 검색해 보세요
          </li>
          <li className="flex items-center gap-2">
            <span className="text-olive-600">•</span>
            일반적인 검색어로 다시 검색해 보세요
          </li>
        </ul>
      </div>

      {/* 최근 검색어 */}
      {historyKeywords.length > 0 && (
        <section className="mb-8">
          <SearchHistory />
        </section>
      )}

      {/* todo: 추천/급상승 검색어 임시 비활성화 */}
      {/* <section className="mb-8">
        <SearchPopularKeyword />
      </section>
      <section>
        <SearchHotKeyword />
      </section> */}
    </div>
  )
}
