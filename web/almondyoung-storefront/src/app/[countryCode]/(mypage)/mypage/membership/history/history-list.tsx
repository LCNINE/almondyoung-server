"use client"

import { useState } from "react"
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
  const [items, setItems] = useState(initialItems)
  const [total, setTotal] = useState(initialTotal)
  const [loading, setLoading] = useState(false)

  const hasMore = items.length < total

  const loadMore = async () => {
    setLoading(true)
    try {
      // offset 은 이미 그린 개수 — 0 → 10 → 20 으로 누적된다
      const res = await getSubscriptionHistoryPaged(PAGE_SIZE, items.length)
      setItems((prev) => [...prev, ...res.items])
      setTotal(res.total)
    } catch {
      // 다음 페이지 로드 실패 — 이미 보이는 목록은 그대로 두고 재시도 가능하게 둔다
    } finally {
      setLoading(false)
    }
  }

  if (!items.length) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">
        {t("history.noSubscriptionHistory")}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <HistoryCard key={item.id} item={item} />
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="border-border text-foreground hover:bg-muted mt-2 h-12 w-full rounded-xl border bg-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading
            ? t("history.loadingMore")
            : t("history.loadMore", { loaded: items.length, total })}
        </button>
      )}
    </div>
  )
}
