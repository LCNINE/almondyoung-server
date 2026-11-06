import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import type { MembershipHallTab } from "@/lib/types/ui/membership-hall"
import {
  HALL_TABS,
  hallHref,
  type HallFieldKey,
  type HallState,
} from "../utils/hall-params"
import { HallSortSelect } from "./hall-sort-select"

export async function HallToolbar({
  state,
  total,
  hasMembershipSale,
  fields,
}: {
  state: HallState
  total: number
  hasMembershipSale: boolean
  fields: HallFieldKey[]
}) {
  const [t, tCat] = await Promise.all([
    getTranslations("membershipHall"),
    getTranslations("categories"),
  ])
  const tabs = HALL_TABS.filter(
    (tab: MembershipHallTab) => tab !== "sale" || hasMembershipSale
  )
  const chips: Array<{ key: HallFieldKey | null; label: string }> = [
    { key: null, label: t("allFields") },
    ...fields.map((key) => ({ key, label: tCat(key) })),
  ]

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2 md:mt-7 md:flex-nowrap md:border-b md:border-[#eceef0]">
        <nav
          aria-label={t("tabsLabel")}
          className="flex w-full gap-6 border-b border-[#eceef0] md:w-auto md:border-b-0"
        >
          {tabs.map((tab) => {
            const active = tab === state.tab

            return (
              <LocalizedClientLink
                key={tab}
                href={hallHref(state, { tab })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 items-center px-0.5 text-[15px]",
                  active
                    ? "text-ink after:bg-mint font-bold after:absolute after:inset-x-0 after:-bottom-px after:h-0.5"
                    : "text-muted-foreground font-medium"
                )}
              >
                {t(`tabs.${tab}`)}
              </LocalizedClientLink>
            )
          })}
        </nav>
        <div className="text-muted-foreground mt-2 flex w-full items-center justify-between gap-3 text-[13px] md:mt-0 md:ml-auto md:w-auto md:justify-end">
          <span>{t("count", { count: total.toLocaleString() })}</span>
          <HallSortSelect state={state} />
        </div>
      </div>

      {fields.length > 0 && (
        <nav
          aria-label={t("fieldsLabel")}
          className="-mx-4 mt-3 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:mt-4 md:mb-5 md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {chips.map((chip) => {
            const active = chip.key === state.field

            return (
              <LocalizedClientLink
                key={chip.key ?? "all"}
                href={hallHref(state, { field: chip.key })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-ink flex h-8 flex-none items-center rounded-full px-3 text-[13px]",
                  active ? "bg-mint font-bold" : "bg-secondary font-medium"
                )}
              >
                {chip.label}
              </LocalizedClientLink>
            )
          })}
        </nav>
      )}
    </>
  )
}
