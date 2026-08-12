"use client"

import { useParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SHOP_TRADE_PAGE_SIZES } from "@/lib/types/ui/shop-listing"
import { buildListHref, type ShopTradeListParams } from "../../build-list-href"

export function PerPageSelect({ params }: { params: ShopTradeListParams }) {
  const router = useRouter()
  const t = useTranslations("shopTrade")
  const { countryCode } = useParams<{ countryCode: string }>()

  return (
    <Select
      value={String(params.size)}
      onValueChange={(next) => {
        const href = buildListHref(params, { size: Number(next), page: 1 })
        router.push(`/${countryCode}${href}`)
      }}
    >
      <SelectTrigger className="border-border h-9 w-auto gap-1 rounded-lg px-3 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SHOP_TRADE_PAGE_SIZES.map((size) => (
          <SelectItem key={size} value={String(size)}>
            {t("perPage", { count: size })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
