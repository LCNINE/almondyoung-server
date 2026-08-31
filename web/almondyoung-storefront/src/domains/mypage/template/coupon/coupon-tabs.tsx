"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import type { Promotion } from "@/lib/types/ui/promotion"
import { claimCoupon } from "@/lib/api/medusa/promotion"
import { maxPossibleDiscount } from "@/lib/utils/coupon-discount"
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

// 할인 큰 순: 「이 쿠폰이 낼 수 있는 최대 할인액」으로 비교한다.
// 최소주문금액 낮은순: 최소 주문 금액 오름차순(없으면 0으로 간주).
function sortItems(items: CouponItem[], key: SortKey): CouponItem[] {
  const sorted = [...items]
  if (key === "discount") {
    // 옛 구현은 정률을 무조건 정액 위로 올리고 raw value 로 비교해서
    // 「10% 최대 3천원」이 「5만원 정액」보다 위에 왔다(#488 A4).
    // ⚠️ 뺄셈으로 쓰면 상한 없는 정률끼리 Infinity - Infinity = NaN 이라 순서가 무너진다.
    sorted.sort((a, b) => {
      const left = maxPossibleDiscount(
        a.promo.application_method,
        a.promo.max_discount_amount
      )
      const right = maxPossibleDiscount(
        b.promo.application_method,
        b.promo.max_discount_amount
      )
      if (left === right) return 0
      return right > left ? 1 : -1
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
