"use client"

import { ChevronRight, Pin } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { listPublicNotices } from "@/lib/api/pim/notices"
import { cn } from "@/lib/utils"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { NoticeBadge, NoticeCategory } from "@/lib/types/dto/notice"
import {
  NOTICE_CATEGORIES,
  getNoticeCategoryLabel,
  type NoticeCategoryFilter,
  type NoticeItem,
} from "@/lib/types/ui/notice"

const CATEGORY_QUERY_KEY = "notice-category"

const BADGE_STYLE: Record<NoticeBadge, { label: string; className: string }> = {
  important: { label: "중요", className: "bg-red-500 text-white" },
  urgent: { label: "긴급", className: "bg-red-700 text-white" },
  new: { label: "NEW", className: "bg-blue-500 text-white" },
}

const NOTICE_CATEGORY_VALUES: NoticeCategory[] = [
  "general",
  "event",
  "delivery",
  "service",
]

function isNoticeCategory(value: string | null): value is NoticeCategory {
  return value !== null && NOTICE_CATEGORY_VALUES.includes(value as NoticeCategory)
}

function BadgeChip({
  badge,
  size = "md",
}: {
  badge: NoticeBadge
  size?: "sm" | "md"
}) {
  const { label, className } = BADGE_STYLE[badge]
  return (
    <span
      className={cn(
        "rounded font-medium",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        className
      )}
    >
      {label}
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
  return (
    <div className="flex flex-wrap items-center gap-2">
      {item.isPinned && (
        <Pin
          className="h-3 w-3 shrink-0 text-gray-400"
          aria-label="상단 고정"
        />
      )}
      {item.badge && <BadgeChip badge={item.badge} size={badgeSize} />}
      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
        {getNoticeCategoryLabel(item.category)}
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
  return (
    <div
      role="group"
      aria-label="공지사항 분류"
      className="scrollbar-hide -mx-4 mb-4 flex gap-2 overflow-x-auto px-4"
    >
      {NOTICE_CATEGORIES.map((cat) => {
        const isActive = selected === cat.value
        return (
          <button
            key={cat.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(cat.value)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-sm transition-colors",
              "focus-visible:ring-2 focus-visible:ring-[#f29219]/40 focus-visible:outline-none",
              isActive
                ? "border-[#f29219] bg-[#f29219]/10 text-[#f29219]"
                : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
            )}
          >
            {cat.label}
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
          className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />
          <span>목록으로</span>
        </button>
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-2">
            <NoticeMetaRow item={selectedItem} badgeSize="md" />
          </div>
          <h2 className="mb-4 text-lg font-bold">{selectedItem.title}</h2>
          <p className="text-sm leading-relaxed whitespace-pre-line text-gray-600">
            {selectedItem.content}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <h2 className="mb-4 text-lg font-bold">공지사항</h2>
      <CategoryFilter
        selected={selectedCategory}
        onChange={handleCategoryChange}
      />

      {isPending ? (
        <div
          aria-live="polite"
          aria-busy="true"
          className="divide-y divide-gray-100 rounded-lg border border-gray-200"
        >
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex w-full items-center justify-between px-4 py-3"
            >
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-4 w-3/4" />
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-gray-200"
                aria-hidden="true"
              />
            </div>
          ))}
        </div>
      ) : hasError ? (
        <div className="rounded-lg border border-gray-200 px-4 py-12 text-center text-sm text-gray-400">
          공지사항을 불러오지 못했습니다.
        </div>
      ) : notices.length === 0 ? (
        <div className="rounded-lg border border-gray-200 px-4 py-12 text-center text-sm text-gray-400">
          {selectedCategory === "all"
            ? "등록된 공지사항이 없습니다."
            : "선택한 분류의 공지사항이 없습니다."}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {notices.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedNoticeId(item.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:text-[#f29219]"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1">
                  <NoticeMetaRow item={item} />
                </div>
                <p className="line-clamp-1 text-sm font-medium">{item.title}</p>
              </div>
              <ChevronRight
                className="ml-2 h-4 w-4 shrink-0 text-gray-400"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
