"use client"

import { useLocale } from "next-intl"
import { useMemo } from "react"

export function useNumberFormats() {
  const locale = useLocale()
  return useMemo(() => {
    const full = new Intl.NumberFormat(locale)
    const compact = new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    })
    const money = new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumSignificantDigits: 3,
    })
    return {
      full: (value: number) => full.format(value),
      compact: (value: number) => compact.format(value),
      money: (value: number) => money.format(value),
    }
  }, [locale])
}
