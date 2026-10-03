"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Skeleton } from "@/components/ui/skeleton"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import type { TeaserShop, TeaserSummary } from "@/lib/beautytop/teaser-types"

async function getTeaser<T>(params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/beautytop/teaser?${new URLSearchParams(params)}`, {
    signal, credentials: "same-origin", cache: "no-store",
  })
  if (!response.ok) throw new Error(`teaser ${response.status}`)
  return ((await response.json()) as { data: T }).data
}

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

// Bars are decoration only: their lengths carry no data, so nothing leaks through them.
const LADDER = [96, 90, 84, 80, 74, 70, 66, 61, 57, 52, 47, 42, 37, 31, 26, 20]

export function ShopTeaser({
  area,
  signedIn,
  loginHref,
  onPick,
}: {
  area: { sido: string; gugun: string }
  signedIn: boolean
  loginHref: string
  onPick: (shop: TeaserShop | null) => void
}) {
  const t = useTranslations("beautytop.teaser")
  const [term, setTerm] = useState("")
  const [shop, setShop] = useState<TeaserShop | null>(null)
  const search = useDebounced(term.trim(), 300)

  const results = useQuery({
    queryKey: ["beautytop-teaser-search", area.sido, area.gugun, search],
    queryFn: ({ signal }) => getTeaser<TeaserShop[]>({ search, sido: area.sido, gugun: area.gugun }, signal),
    enabled: signedIn && search.length >= 2 && !shop,
    staleTime: 60_000,
    retry: false,
  })
  const summary = useQuery({
    queryKey: ["beautytop-teaser-summary", shop?.id],
    queryFn: ({ signal }) => getTeaser<TeaserSummary>({ id: String(shop?.id) }, signal),
    enabled: !!shop,
    staleTime: 10 * 60_000,
    retry: false,
  })

  const pick = (next: TeaserShop | null) => {
    setShop(next)
    onPick(next)
  }

  if (!signedIn) {
    return (
      <section aria-labelledby="teaser-title" className="flex flex-col gap-3">
        <h2 id="teaser-title" className="text-lg font-bold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm break-keep">{t("loginHint")}</p>
        <LocalizedClientLink
          href={loginHref}
          className="border-border flex h-12 items-center justify-center rounded-lg border text-[15px] font-medium"
        >
          {t("login")}
        </LocalizedClientLink>
      </section>
    )
  }

  if (!shop) {
    return (
      <section aria-labelledby="teaser-title" className="flex flex-col gap-3">
        <h2 id="teaser-title" className="text-lg font-bold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("inArea", area)}</p>
        <Command shouldFilter={false} className="border-border rounded-xl border">
          <CommandInput value={term} onValueChange={setTerm} placeholder={t("placeholder")} aria-label={t("label")} />
          {search.length >= 2 && (
            <CommandList>
              {results.isPending ? (
                <div className="space-y-2 p-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /></div>
              ) : results.isError ? (
                <p className="text-muted-foreground p-3 text-sm">{t("searchError")}</p>
              ) : (
                <>
                  <CommandEmpty>{t("noResult", { term: search })}</CommandEmpty>
                  {results.data?.map((item) => (
                    <CommandItem key={item.id} value={String(item.id)} onSelect={() => pick(item)} className="flex min-h-12 flex-col items-start gap-0.5">
                      <span className="text-[15px] font-medium">{item.name}</span>
                      <span className="text-muted-foreground text-xs">{[item.sido, item.gugun, item.category].filter(Boolean).join(" · ")}</span>
                    </CommandItem>
                  ))}
                </>
              )}
            </CommandList>
          )}
        </Command>
      </section>
    )
  }

  const local = summary.data?.scopes.at(-1)
  const m = summary.data?.metrics
  return (
    <section aria-labelledby="teaser-found" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="teaser-found" className="text-lg font-bold break-keep">{t("found", { name: shop.name })}</h2>
        <button type="button" onClick={() => pick(null)} className="bg-secondary hover:bg-border h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium transition-colors duration-150">
          {t("again")}
        </button>
      </div>
      {summary.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : summary.isError || !local || !m ? (
        <p className="text-muted-foreground text-sm">{t("summaryError")}</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_112px] items-center gap-4">
            <div aria-hidden className="flex flex-col gap-1">
              {LADDER.slice(0, Math.min(LADDER.length, local.total)).map((w) => (
                <span key={w} className="h-2 rounded bg-[#ececec]" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">{local.label}</span>
              <span className="text-[26px] leading-8 font-bold">{t("outOf", { total: local.total })}</span>
              <span className="border-primary text-[#a86200] inline-flex h-10 w-[72px] items-center justify-center rounded-lg border-2 border-dashed text-[22px] font-bold">
                {t("hiddenRank")}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("metricsTitle", { count: m.ahead + m.behind + m.even + m.pricePosition + m.unknown })}</span>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {(["ahead", "behind", "even", "pricePosition", "unknown"] as const)
                .filter((k) => m[k] > 0)
                .map((k) => (
                  <li key={k} className="bg-muted flex items-center justify-between rounded-lg px-3 py-2">
                    <span className="text-muted-foreground">{t(`metric.${k}`)}</span>
                    <b>{m[k]}</b>
                  </li>
                ))}
            </ul>
            <p className="text-muted-foreground text-[13px]">{t("whichHidden")}</p>
          </div>
        </>
      )}
    </section>
  )
}
