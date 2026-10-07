"use client"

import { cn } from "@/lib/utils"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { queryBeautyTop } from "@/lib/beautytop/client"
import { useInfiniteQuery } from "@tanstack/react-query"
import type { BeautyTopFranchise } from "../types"
import { useNumberFormats } from "../use-number-formats"
import { Big, Card, Chip, Headline, LoadError } from "./parts"

const SUGGESTIONS = ["속눈썹", "네일", "헤어", "왁싱", "피부", "반영구"]
const PAGE_SIZE = 20

export function FranchiseTab() {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const [input, setInput] = useState(SUGGESTIONS[0])
  const [query, setQuery] = useState(SUGGESTIONS[0])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300)
    return () => clearTimeout(timer)
  }, [input])

  const franchise = useInfiniteQuery({
    queryKey: ["beautytop", "franchise", query],
    queryFn: ({ pageParam, signal }) =>
      queryBeautyTop<BeautyTopFranchise>(
        {
          resource: "franchise",
          search: query,
          page: pageParam,
          page_size: PAGE_SIZE,
        },
        signal
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination?.has_next
        ? (last.pagination.next_page ?? undefined)
        : undefined,
    enabled: query.length >= 2,
    retry: false,
  })

  const total = franchise.data?.pages[0]?.data.total ?? 0
  const seen = new Set<string>()
  const brands = (franchise.data?.pages ?? [])
    .flatMap((page) => page.data.items)
    .filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)))
    .map((item) => {
      const latest = [...item.history]
        .reverse()
        .find((h) => h.franchised != null || h.average_sales_won != null)
      return { ...item, brand: item.brand.trim(), latest }
    })

  return (
    <Card note={t("franchise.note")}>
      <label className="bg-muted flex h-12 items-center gap-2 rounded-xl px-4">
        <Search aria-hidden className="text-muted-foreground h-5 w-5" />
        <span className="sr-only">{t("franchise.searchLabel")}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("franchise.searchPlaceholder")}
          className="text-foreground h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#b0b3ba]"
        />
      </label>
      <div className="scrollbar-hide -mx-6 mt-3 flex gap-2 overflow-x-auto px-6">
        {SUGGESTIONS.map((word) => (
          <Chip
            key={word}
            active={input === word}
            onClick={() => setInput(word)}
          >
            {word}
          </Chip>
        ))}
      </div>

      {query.length < 2 ? null : franchise.isPending ? (
        <div className="mt-5 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-16 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : franchise.isError && !franchise.data ? (
        <LoadError onRetry={() => franchise.refetch()} />
      ) : brands.length === 0 ? (
        <p className="text-muted-foreground mt-5 text-[15px]">
          {t("franchise.noResult", { query })}
        </p>
      ) : (
        <>
          <div className="mt-6">
            <Headline>
              {t.rich("franchise.headline", {
                count: fmt.full(total),
                b: (chunks) => <Big>{chunks}</Big>,
              })}
            </Headline>
          </div>
          <ul className="divide-border mt-3 divide-y">
            {brands.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 py-4"
              >
                <span className="min-w-0">
                  <span className="text-foreground block truncate text-[17px] leading-[25.5px] font-medium">
                    {item.brand}
                  </span>
                  <span className="text-muted-foreground block text-[13px]">
                    {item.latest
                      ? t("franchise.year", { year: item.latest.report_year })
                      : t("franchise.noFigures")}
                  </span>
                </span>
                {item.latest && (
                  <span className="shrink-0 text-right tabular-nums">
                    {item.latest.franchised != null && (
                      <span
                        className={cn(
                          "block text-[17px] font-bold",
                          item.latest.franchised > 0
                            ? "text-foreground"
                            : "text-muted-foreground/60"
                        )}
                      >
                        {t("franchise.stores", {
                          count: fmt.full(item.latest.franchised),
                        })}
                      </span>
                    )}
                    {item.latest.average_sales_won != null && (
                      <span className="text-muted-foreground block text-[13px]">
                        {t("franchise.sales", {
                          amount: t("unit.won", {
                            value: fmt.money(item.latest.average_sales_won),
                          }),
                        })}
                      </span>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {franchise.hasNextPage && (
            <button
              type="button"
              disabled={franchise.isFetchingNextPage}
              onClick={() => franchise.fetchNextPage()}
              className="bg-secondary text-foreground mt-3 h-12 w-full rounded-xl text-[15px] font-medium disabled:opacity-60"
            >
              {franchise.isFetchingNextPage
                ? t("shop.loading")
                : franchise.isFetchNextPageError
                  ? t("retry")
                  : t("franchise.more", {
                      shown: fmt.full(brands.length),
                      total: fmt.full(total),
                    })}
            </button>
          )}
        </>
      )}
    </Card>
  )
}
