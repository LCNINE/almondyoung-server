"use client"

import { useTranslations } from "next-intl"
import { useAreaShopCount } from "../use-area-shop-count"
import { useNumberFormats } from "../use-number-formats"

/** States what closes with the membership, as plain information; it never sits between the member and the cancel buttons. */
export function CancelAreaLine() {
  const t = useTranslations("mypage.membership.cancel")
  const fmt = useNumberFormats()
  const { filters, shops } = useAreaShopCount()
  if (shops === null) return null

  return (
    <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-xs leading-4 break-keep">
      {t.rich("beautytopLoss", {
        gugun: filters.gugun,
        category: filters.category,
        count: fmt.full(shops),
        b: (chunks) => <b className="text-foreground font-bold">{chunks}</b>,
      })}
    </p>
  )
}
