"use client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslations } from "next-intl"
import type {
  BeautyTopBriefing,
  BeautyTopShop,
  BeautyTopTarget,
} from "../types"
import { useBeautyTop } from "../use-beautytop"
import { useNumberFormats } from "../use-number-formats"
import { StatTile, stripLeadingSymbols } from "./parts"

const METRIC_LABELS = {
  visitor_reviews: "shop.reviews",
  blog_reviews: "shop.blogReviews",
  followers: "shop.followers",
  posts: "shop.posts",
} as const

export function ShopSheet({
  target,
  onClose,
}: {
  target: BeautyTopTarget | null
  onClose: () => void
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[88vh] max-w-[640px] overflow-y-auto rounded-t-2xl border-0 px-5 pt-3 pb-10"
      >
        <div
          aria-hidden
          className="bg-border mx-auto mb-5 h-1 w-10 rounded-full"
        />
        {target && <ShopDetail target={target} />}
      </SheetContent>
    </Sheet>
  )
}

function ShopDetail({ target }: { target: BeautyTopTarget }) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const shop = useBeautyTop<BeautyTopShop>({
    resource: "shop",
    id: target.id,
    kind: target.kind,
  })
  const briefing = useBeautyTop<BeautyTopBriefing>({
    resource: "briefing",
    id: target.id,
    kind: target.kind,
  })

  if (shop.isError) {
    return (
      <>
        <SheetTitle className="sr-only">{t("error")}</SheetTitle>
        <p className="text-muted-foreground py-8 text-center text-[15px]">
          {t("error")}
        </p>
      </>
    )
  }

  if (!shop.data) {
    return (
      <div className="space-y-4">
        <SheetTitle className="sr-only">{t("shop.loading")}</SheetTitle>
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const data = shop.data
  const metrics = data.growth.metrics.filter(
    (m): m is { key: keyof typeof METRIC_LABELS; current: number } =>
      m.key in METRIC_LABELS && m.current != null
  )
  const menus = data.price_history.series
    .map((s) => ({
      name: stripLeadingSymbols(s.name),
      value: s.points.at(-1)?.value,
    }))
    .filter((m): m is { name: string; value: number } => m.value != null)
    .slice(0, 10)
  const instagram = data.social_accounts[0]?.handle
  const peers = briefing.data?.peers
  const price = peers?.metrics.find(
    (m) => m.key === "price" && m.status === "READY"
  )
  const priceService = peers?.services.find((s) => s.id === peers.service)
  const priceDiff =
    price?.current != null && price.median != null
      ? price.current - price.median
      : null

  return (
    <>
      <p className="text-muted-foreground text-[13px] font-medium">
        {data.category}
      </p>
      <SheetTitle className="text-foreground mt-1 text-xl font-bold">
        {data.name}
      </SheetTitle>
      <SheetDescription className="text-muted-foreground mt-1 text-[13px]">
        {data.address}
      </SheetDescription>

      {priceDiff != null && priceService && (
        <p className="text-foreground bg-muted mt-5 rounded-xl p-4 text-[15px] break-keep">
          {t.rich("shop.priceCompare", {
            service: priceService.name,
            verdict:
              Math.abs(priceDiff) < (price?.median ?? 1) * 0.03
                ? t("myShop.same")
                : t(priceDiff > 0 ? "myShop.higher" : "myShop.lower", {
                    diff: t("unit.won", {
                      value: fmt.full(Math.abs(priceDiff)),
                    }),
                  }),
            b: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      )}

      {metrics.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-2">
          {metrics.map((m) => (
            <StatTile
              key={m.key}
              label={t(METRIC_LABELS[m.key])}
              value={fmt.full(m.current)}
            />
          ))}
        </div>
      )}

      {menus.length > 0 && (
        <section className="mt-8">
          <h3 className="text-foreground text-[17px] font-bold">
            {t("shop.menus")}
          </h3>
          <ul className="divide-border mt-2 divide-y">
            {menus.map((menu, index) => (
              <li
                key={`${menu.name}-${index}`}
                className="flex items-baseline justify-between gap-4 py-3 text-[15px]"
              >
                <span className="text-foreground min-w-0 truncate">
                  {menu.name}
                </span>
                <span className="text-foreground shrink-0 font-bold tabular-nums">
                  {t("unit.won", { value: fmt.full(menu.value) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(data.naver?.url || instagram) && (
        <div className="mt-8 grid grid-cols-2 gap-2">
          {data.naver?.url && (
            <a
              href={data.naver.url}
              target="_blank"
              rel="noreferrer"
              className="bg-secondary text-foreground flex h-12 items-center justify-center rounded-xl text-[17px] leading-[25.5px] font-medium"
            >
              {t("shop.naverMap")}
            </a>
          )}
          {instagram && (
            <a
              href={`https://www.instagram.com/${encodeURIComponent(instagram)}/`}
              target="_blank"
              rel="noreferrer"
              className="bg-secondary text-foreground flex h-12 items-center justify-center rounded-xl text-[17px] leading-[25.5px] font-medium"
            >
              {t("shop.instagram")}
            </a>
          )}
        </div>
      )}
    </>
  )
}
