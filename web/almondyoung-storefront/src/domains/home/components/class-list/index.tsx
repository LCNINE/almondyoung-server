"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import ThumbnailImage from "@/domains/products/components/thumbnail/thumbnail-image"
import { cn } from "@/lib/utils"
import { formatPrice } from "@/lib/utils/price-utils"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { SectionHead } from "../header"
import {
  CLASS_REGION_TABS,
  type ClassRegionTabKey,
  type ClassRow,
} from "./class-list-data"

const MOBILE_VISIBLE = 4

interface ClassListSectionProps {
  title: string
  subtitle?: string
  accent?: string
  rows: ClassRow[]
}

export function ClassListSection({
  title,
  subtitle,
  accent,
  rows,
}: ClassListSectionProps) {
  const t = useTranslations("home.classList")
  const [active, setActive] = useState<ClassRegionTabKey | "all">("all")
  const [expanded, setExpanded] = useState(false)

  const tabs = [
    "all" as const,
    ...CLASS_REGION_TABS.filter((tab) =>
      rows.some((row) => row.tabs.includes(tab.key))
    ).map((tab) => tab.key),
  ]
  const shown =
    active === "all" ? rows : rows.filter((row) => row.tabs.includes(active))

  return (
    <div className="w-full">
      <SectionHead
        title={title}
        subtitle={subtitle}
        accent={accent}
        extra={
          tabs.length > 1 && (
            <div
              role="group"
              aria-label={t("regionLabel")}
              className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:w-auto md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
            >
              {tabs.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active === key}
                  onClick={() => setActive(key)}
                  className={cn(
                    "h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                    active === key
                      ? "border-ink bg-ink text-white"
                      : "border-border text-ink bg-white"
                  )}
                >
                  {t(`regions.${key}`)}
                </button>
              ))}
            </div>
          )
        }
      />

      <ul className="border-ink grid border-t-2 lg:grid-cols-2 lg:gap-x-10">
        {shown.map((row, index) => (
          <li
            key={row.id}
            className={cn(
              !expanded && index >= MOBILE_VISIBLE && "max-md:hidden"
            )}
          >
            <LocalizedClientLink
              href={`/products/${row.handle}`}
              className="group border-border grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b py-3.5 md:grid-cols-[64px_104px_minmax(0,1fr)_auto] md:gap-y-0"
            >
              <span className="bg-muted relative row-span-2 size-14 overflow-hidden rounded-[10px] md:row-span-1 md:size-16">
                {row.imageSrc && (
                  <ThumbnailImage image={row.imageSrc} size="small" />
                )}
              </span>
              {row.region ? (
                <span className="text-mint-deep bg-mint-tint justify-self-start rounded-md px-2 py-1 text-xs font-bold whitespace-nowrap">
                  {row.region}
                </span>
              ) : (
                <span aria-hidden />
              )}
              <span className="col-start-2 col-end-4 line-clamp-2 text-sm leading-[1.4] group-hover:underline md:col-auto">
                {row.title}
              </span>
              <span className="col-start-3 row-start-1 font-bold whitespace-nowrap tabular-nums md:col-auto md:row-auto">
                {formatPrice(row.price)}원
              </span>
            </LocalizedClientLink>
          </li>
        ))}
      </ul>

      {!expanded && shown.length > MOBILE_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="border-border mt-3 flex h-11 w-full items-center justify-center rounded-[10px] border bg-white text-sm font-semibold md:hidden"
        >
          {t("showMore")}
        </button>
      )}
    </div>
  )
}
