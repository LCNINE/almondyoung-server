"use client"

import { useParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import type { MembershipHallSort } from "@/lib/types/ui/membership-hall"
import { HALL_SORTS, hallHref, type HallState } from "../utils/hall-params"

export function HallSortSelect({ state }: { state: HallState }) {
  const t = useTranslations("membershipHall")
  const router = useRouter()
  const { countryCode } = useParams<{ countryCode: string }>()

  const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const sort = HALL_SORTS.find((item) => item === event.target.value)
    if (!sort) return

    router.push(`/${countryCode}${hallHref(state, { sort })}`)
  }

  return (
    <label className="relative inline-flex">
      <span className="sr-only">{t("sortLabel")}</span>
      <select
        value={state.sort}
        onChange={onChange}
        className="border-border text-ink focus-visible:outline-mint-deep h-8 cursor-pointer appearance-none rounded-lg border bg-white pr-8 pl-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {HALL_SORTS.map((sort: MembershipHallSort) => (
          <option key={sort} value={sort}>
            {t(`sorts.${sort}`)}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="border-ink pointer-events-none absolute top-3 right-3 size-1.5 rotate-45 border-r-[1.5px] border-b-[1.5px]"
      />
    </label>
  )
}
