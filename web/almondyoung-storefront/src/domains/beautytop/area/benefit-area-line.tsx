"use client"

import { useTranslations } from "next-intl"
import { useAreaShopCount } from "../use-area-shop-count"
import { useNumberFormats } from "../use-number-formats"

/** One public-cache number on the membership benefit card; stays hidden until there is a real count. */
export function BenefitAreaLine() {
  const t = useTranslations("mypage.membership.currentBenefits.benefit17")
  const fmt = useNumberFormats()
  const { filters, shops } = useAreaShopCount()
  if (shops === null) return null

  return (
    <p className="mt-3 text-sm leading-relaxed break-keep text-white">
      {t.rich("teaser", {
        gugun: filters.gugun,
        category: filters.category,
        count: fmt.full(shops),
        b: (chunks) => <b className="font-bold text-[#ffa500]">{chunks}</b>,
      })}
    </p>
  )
}
