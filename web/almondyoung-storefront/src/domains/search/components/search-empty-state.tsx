"use client"

import { SearchX } from "lucide-react"
import { useTranslations } from "next-intl"
import { SearchHistory } from "@components/search/search-history"
import { SearchPopularKeyword } from "@components/search/search-popular-keyword"
import { SearchHotKeyword } from "@components/search/search-hot-keyword"

interface SearchEmptyStateProps {
  keyword: string
  historyKeywords: string[]
}

export function SearchEmptyState({
  keyword,
  historyKeywords,
}: SearchEmptyStateProps) {
  const t = useTranslations("search.empty")
  return (
    <div className="flex flex-col">
      <div className="mb-10 flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
          <SearchX className="h-8 w-8 text-gray-400" />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          {t("title", { keyword })}
        </h2>
        <p className="text-sm text-gray-500">{t("subtitle")}</p>

        <ul className="mt-6 space-y-1 text-left text-sm text-gray-600">
          <li className="flex items-center gap-2">
            <span className="text-olive-600">•</span>
            {t("tip1")}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-olive-600">•</span>
            {t("tip2")}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-olive-600">•</span>
            {t("tip3")}
          </li>
        </ul>
      </div>

      {historyKeywords.length > 0 && (
        <section className="mb-8">
          <SearchHistory />
        </section>
      )}

      <section className="mb-8">
        <SearchPopularKeyword />
      </section>
      <section>
        <SearchHotKeyword />
      </section>
    </div>
  )
}
