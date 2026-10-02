"use client"

import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { useScopeFilters } from "../components/neighborhood-tab"
import type { BeautyTopMarket } from "../types"
import { useArea } from "../use-area"
import { useNumberFormats } from "../use-number-formats"

/** One public-cache number on the membership benefit card; stays hidden until there is a real count. */
export function BenefitAreaLine() {
  const t = useTranslations("mypage.membership.currentBenefits.benefit17")
  const fmt = useNumberFormats()
  const [filters] = useScopeFilters()
  // The saved area is read in an effect; asking before it lands would fetch the default area for nothing.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const market = useArea<BeautyTopMarket>("market", filters, ready)

  const shops = market.data?.available ? (market.data.shops ?? 0) : 0
  if (shops === 0) return null

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
