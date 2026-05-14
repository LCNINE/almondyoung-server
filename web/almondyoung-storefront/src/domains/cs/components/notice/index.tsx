"use client"

import { ChevronRight } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { NoticeBadge } from "@/lib/types/dto/notice"
import type { NoticeItem } from "@/lib/types/ui/notice"

interface NoticeProps {
  notices: NoticeItem[]
}

const BADGE_STYLE: Record<NoticeBadge, { label: string; className: string }> = {
  important: { label: "중요", className: "bg-red-500 text-white" },
  urgent: { label: "긴급", className: "bg-red-700 text-white" },
  new: { label: "NEW", className: "bg-blue-500 text-white" },
}

function BadgeChip({ badge, size = "md" }: { badge: NoticeBadge; size?: "sm" | "md" }) {
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

export function Notice({ notices }: NoticeProps) {
  const [selectedNoticeId, setSelectedNoticeId] = useState<string | null>(null)

  const selectedItem = notices.find((item) => item.id === selectedNoticeId)

  if (selectedItem) {
    return (
      <div className="px-4 py-6">
        <button
          onClick={() => setSelectedNoticeId(null)}
          className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
          <span>목록으로</span>
        </button>
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-2 flex items-center gap-2">
            {selectedItem.badge && <BadgeChip badge={selectedItem.badge} />}
            <span className="text-xs text-gray-400">
              {formatDate(selectedItem.createdAt, DATE_FORMATS.KO_DOT)}
            </span>
          </div>
          <h2 className="mb-4 text-lg font-bold">{selectedItem.title}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">
            {selectedItem.content}
          </p>
        </div>
      </div>
    )
  }

  if (notices.length === 0) {
    return (
      <div className="px-4 py-6">
        <h2 className="mb-4 text-lg font-bold">공지사항</h2>
        <div className="rounded-lg border border-gray-200 px-4 py-12 text-center text-sm text-gray-400">
          등록된 공지사항이 없습니다.
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <h2 className="mb-4 text-lg font-bold">공지사항</h2>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {notices.map((item) => (
          <button
            key={item.id}
            onClick={() => setSelectedNoticeId(item.id)}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:text-[#f29219]"
          >
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-2">
                {item.badge && <BadgeChip badge={item.badge} size="sm" />}
                <span className="text-xs text-gray-400">
                  {formatDate(item.createdAt, DATE_FORMATS.KO_DOT)}
                </span>
              </div>
              <p className="line-clamp-1 text-sm font-medium">{item.title}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        ))}
      </div>
    </div>
  )
}
