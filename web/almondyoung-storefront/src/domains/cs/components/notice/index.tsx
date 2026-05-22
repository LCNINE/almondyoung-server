"use client"

import { ChevronRight, Pin } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { Skeleton } from "@/components/ui/skeleton"
import { listPublicNotices } from "@/lib/api/pim/notices"
import { cn } from "@/lib/utils"
import { sanitizeNoticeHtml } from "@/lib/utils/sanitize-html"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { NoticeBadge, NoticeCategory } from "@/lib/types/dto/notice"
import type { NoticeCategoryFilter, NoticeItem } from "@/lib/types/ui/notice"

const CATEGORY_QUERY_KEY = "notice-category"

const BADGE_STYLE: Record<NoticeBadge, string> = {
  important: "bg-red-500 text-white",
  urgent: "bg-red-700 text-white",
  new: "bg-blue-500 text-white",
}

const NOTICE_FILTER_VALUES: NoticeCategoryFilter[] = [
  "all",
  "general",
  "event",
  "delivery",
  "service",
]

const NOTICE_CATEGORY_VALUES: NoticeCategory[] = [
  "general",
  "event",
  "delivery",
  "service",
]

function isNoticeCategory(value: string | null): value is NoticeCategory {
  return (
    value !== null && NOTICE_CATEGORY_VALUES.includes(value as NoticeCategory)
  )
}

function BadgeChip({
  badge,
  size = "md",
}: {
  badge: NoticeBadge
  size?: "sm" | "md"
}) {
  const t = useTranslations("cs.notice.badge")
  return (
    <span
      className={cn(
        "rounded font-medium",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        BADGE_STYLE[badge]
      )}
    >
      {t(badge)}
    </span>
  )
}

function NoticeMetaRow({
  item,
  badgeSize = "sm",
}: {
  item: NoticeItem
  badgeSize?: "sm" | "md"
}) {
  const t = useTranslations("cs.notice")
  const tCat = useTranslations("cs.notice.categories")
  return (
    <div className="flex flex-wrap items-center gap-2">
      {item.isPinned && (
        <Pin
          className="w-3 h-3 text-gray-400 shrink-0"
          aria-label={t("pinAria")}
        />
      )}
      {item.badge && <BadgeChip badge={item.badge} size={badgeSize} />}
      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
        {tCat(item.category as "general")}
      </span>
      <span className="text-xs text-gray-400">
        {formatDate(item.createdAt, DATE_FORMATS.KO_DOT)}
      </span>
    </div>
  )
}

function CategoryFilter({
  selected,
  onChange,
}: {
  selected: NoticeCategoryFilter
  onChange: (next: NoticeCategoryFilter) => void
}) {
  const t = useTranslations("cs.notice")
  const tCat = useTranslations("cs.notice.categories")
  return (
    <div
      role="group"
      aria-label={t("ariaCategory")}
      className="flex gap-2 px-4 mb-4 -mx-4 overflow-x-auto scrollbar-hide"
    >
      {NOTICE_FILTER_VALUES.map((value) => {
        const isActive = selected === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(value)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors",
              "focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:outline-none",
              isActive
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {tCat(value as "all")}
          </button>
        )
      })}
    </div>
  )
}

export function Notice() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations("cs.notice")

  const initialCategory: NoticeCategoryFilter = (() => {
    const v = searchParams.get(CATEGORY_QUERY_KEY)
    return isNoticeCategory(v) ? v : "all"
  })()

  const [selectedCategory, setSelectedCategory] =
    useState<NoticeCategoryFilter>(initialCategory)
  const [notices, setNotices] = useState<NoticeItem[]>([])
  const [selectedNoticeId, setSelectedNoticeId] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      try {
        setHasError(false)
        const apiCategory =
          selectedCategory === "all" ? undefined : selectedCategory
        const data = await listPublicNotices(apiCategory)
        setNotices(data)
      } catch {
        setHasError(true)
      }
    })
  }, [selectedCategory])

  const handleCategoryChange = (next: NoticeCategoryFilter) => {
    if (next === selectedCategory) return

    setSelectedCategory(next)
    setSelectedNoticeId(null)

    const params = new URLSearchParams(searchParams.toString())
    if (next === "all") {
      params.delete(CATEGORY_QUERY_KEY)
    } else {
      params.set(CATEGORY_QUERY_KEY, next)
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const selectedItem = notices.find((item) => item.id === selectedNoticeId)

  if (selectedItem) {
    return (
      <div className="px-4 py-6">
        <button
          type="button"
          onClick={() => setSelectedNoticeId(null)}
          className="flex items-center gap-1 mb-4 text-sm text-gray-500 hover:text-gray-700"
        >
          <ChevronRight className="w-4 h-4 rotate-180" aria-hidden="true" />
          <span>{t("backToList")}</span>
        </button>
        <div className="p-4 border border-gray-200 rounded-lg">
          <div className="mb-2">
            <NoticeMetaRow item={selectedItem} badgeSize="md" />
          </div>
          <h2 className="mb-4 text-lg font-bold">{selectedItem.title}</h2>
          <div
            className="notice-content text-sm leading-relaxed text-gray-600"
            dangerouslySetInnerHTML={{
              __html: sanitizeNoticeHtml(selectedItem.content),
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <h2 className="mb-4 text-lg font-bold">{t("title")}</h2>
      <CategoryFilter
        selected={selectedCategory}
        onChange={handleCategoryChange}
      />

      {isPending ? (
        <div
          aria-live="polite"
          aria-busy="true"
          className="border border-gray-200 divide-y divide-gray-100 rounded-lg"
        >
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between w-full px-4 py-3"
            >
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="w-10 h-4" />
                  <Skeleton className="w-12 h-3" />
                  <Skeleton className="w-16 h-3" />
                </div>
                <Skeleton className="w-3/4 h-4" />
              </div>
              <ChevronRight
                className="w-4 h-4 text-gray-200 shrink-0"
                aria-hidden="true"
              />
            </div>
          ))}
        </div>
      ) : hasError ? (
        <div className="px-4 py-12 text-sm text-center text-gray-400 border border-gray-200 rounded-lg">
          {t("loadFail")}
        </div>
      ) : notices.length === 0 ? (
        <div className="px-4 py-12 text-sm text-center text-gray-400 border border-gray-200 rounded-lg">
          {selectedCategory === "all" ? t("emptyAll") : t("emptyCategory")}
        </div>
      ) : (
        <div className="border border-gray-200 divide-y divide-gray-100 rounded-lg">
          {notices.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedNoticeId(item.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:text-[#f29219]"
            >
              <div className="flex-1 min-w-0">
                <div className="mb-1">
                  <NoticeMetaRow item={item} />
                </div>
                <p className="text-sm font-medium line-clamp-1">{item.title}</p>
              </div>
              <ChevronRight
                className="w-4 h-4 ml-2 text-gray-400 shrink-0"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
