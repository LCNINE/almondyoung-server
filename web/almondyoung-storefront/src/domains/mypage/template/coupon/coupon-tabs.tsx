"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import type { Promotion } from "@/lib/types/ui/promotion"
import { claimCoupon } from "@/lib/api/medusa/promotion"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CouponCard } from "./coupon-card"

export interface CouponItem {
  promo: Promotion
  expiry: string
}

type SortKey = "discount" | "minOrder"

// 할인율 높은순: 정률(%) 쿠폰을 위로, 각 그룹 안에서 값 큰 순.
// 최소주문금액 낮은순: 최소 주문 금액 오름차순(없으면 0으로 간주).
function sortItems(items: CouponItem[], key: SortKey): CouponItem[] {
  const sorted = [...items]
  if (key === "discount") {
    sorted.sort((a, b) => {
      const rank = (p: Promotion) => (p.application_method?.type === "percentage" ? 1 : 0)
      const r = rank(b.promo) - rank(a.promo)
      if (r !== 0) return r
      return (b.promo.application_method?.value ?? 0) - (a.promo.application_method?.value ?? 0)
    })
  } else {
    sorted.sort(
      (a, b) => (a.promo.min_order_amount ?? 0) - (b.promo.min_order_amount ?? 0)
    )
  }
  return sorted
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-10 text-center">
      <p className="text-sm text-stone-400">{message}</p>
    </div>
  )
}

export function CouponTabs({
  mine,
  claimable,
  expired,
}: {
  mine: CouponItem[]
  claimable: CouponItem[]
  expired: CouponItem[]
}) {
  const t = useTranslations("mypage.coupon")
  const [sort, setSort] = useState<SortKey>("discount")

  const sortedMine = useMemo(() => sortItems(mine, sort), [mine, sort])
  const sortedClaimable = useMemo(() => sortItems(claimable, sort), [claimable, sort])

  return (
    <Tabs defaultValue="mine" className="w-full">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="mine">
          {t("tabMine")} {mine.length > 0 && <span className="ml-1 tabular-nums">{mine.length}</span>}
        </TabsTrigger>
        <TabsTrigger value="claim">{t("tabClaim")}</TabsTrigger>
        <TabsTrigger value="expired">{t("tabExpired")}</TabsTrigger>
      </TabsList>

      {/* 정렬: 내 쿠폰 / 쿠폰 받기 탭에만 노출 */}
      <TabsContent value="mine" className="mt-4">
        <div className="mb-3 flex justify-start">
          <SortSelect value={sort} onChange={setSort} />
        </div>
        {sortedMine.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {sortedMine.map(({ promo, expiry }) => (
              <CouponCard key={promo.id} promo={promo} expiry={expiry} />
            ))}
          </ul>
        ) : (
          <EmptyState message={t("emptyMine")} />
        )}
      </TabsContent>

      <TabsContent value="claim" className="mt-4">
        <div className="mb-3 flex justify-start">
          <SortSelect value={sort} onChange={setSort} />
        </div>
        {sortedClaimable.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {sortedClaimable.map(({ promo, expiry }) => (
              <CouponCard
                key={promo.id}
                promo={promo}
                expiry={expiry}
                onClaim={() => claimCoupon(promo.id)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState message={t("emptyClaim")} />
        )}
      </TabsContent>

      <TabsContent value="expired" className="mt-4">
        {expired.length > 0 ? (
          <>
            <p className="mb-3 text-xs text-stone-400">{t("expiredNotice")}</p>
            <ul className="flex flex-col gap-3">
              {expired.map(({ promo, expiry }) => (
                <CouponCard key={promo.id} promo={promo} expiry={expiry} expired />
              ))}
            </ul>
          </>
        ) : (
          <EmptyState message={t("emptyExpired")} />
        )}
      </TabsContent>
    </Tabs>
  )
}

function SortSelect({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  const t = useTranslations("mypage.coupon")
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortKey)}>
      <SelectTrigger className="h-9 w-44 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="discount">{t("sortDiscount")}</SelectItem>
        <SelectItem value="minOrder">{t("sortMinOrder")}</SelectItem>
      </SelectContent>
    </Select>
  )
}
