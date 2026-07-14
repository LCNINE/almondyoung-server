"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { getSubscriptionHistoryPaged } from "@lib/api/membership"
import type { SubscriptionHistoryItemDto } from "@lib/types/dto/membership"
import HistoryCard from "./history-card"

const PAGE_SIZE = 10

interface HistoryListProps {
  initialItems: SubscriptionHistoryItemDto[]
  initialTotal: number
}

export default function HistoryList({
  initialItems,
  initialTotal,
}: HistoryListProps) {
  const t = useTranslations("mypage.membership")
  const [page, setPage] = useState(0)
  const [items, setItems] = useState(initialItems)
  const [total, setTotal] = useState(initialTotal)
  const [loading, setLoading] = useState(false)
  const isFirst = useRef(true)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  useEffect(() => {
    // 초기 렌더는 서버가 넘겨준 첫 페이지를 그대로 사용
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    let active = true
    setLoading(true)
    getSubscriptionHistoryPaged(PAGE_SIZE, page * PAGE_SIZE)
      .then((res) => {
        if (active) {
          setItems(res.items)
          setTotal(res.total)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [page])

  if (!items.length) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">
        {t("history.noSubscriptionHistory")}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex flex-col gap-2 transition-opacity ${loading ? "opacity-50" : ""}`}
      >
        {items.map((item) => (
          <HistoryCard key={item.id} item={item} />
        ))}
      </div>

      {totalPages > 1 && (
        <nav className="mt-3 flex items-center justify-center gap-1">
          <button
            type="button"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="border-border text-muted-foreground hover:bg-muted flex h-9 w-9 items-center justify-center rounded-lg border disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="이전 페이지"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {/* ponytail: 구독 이력은 페이지 수가 적어 전체 번호 노출. 많아지면 윈도잉 추가 */}
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              type="button"
              disabled={loading}
              onClick={() => setPage(i)}
              className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium ${
                i === page
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            disabled={page >= totalPages - 1 || loading}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="border-border text-muted-foreground hover:bg-muted flex h-9 w-9 items-center justify-center rounded-lg border disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="다음 페이지"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  )
}
