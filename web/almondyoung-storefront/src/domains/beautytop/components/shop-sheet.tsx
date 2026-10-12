"use client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { LoadingSkeleton } from "./parts"
import { cn } from "@/lib/utils"
import { Heart } from "lucide-react"
import { useTranslations } from "next-intl"
import type {
  BeautyTopBriefing,
  BeautyTopShop,
  BeautyTopTarget,
} from "../types"
import { useBeautyTop } from "../use-beautytop"
import { useNumberFormats } from "../use-number-formats"
import { useWatchlist } from "../use-watchlist"
import { ShopDataOverview } from "../growth/shop-data-overview"

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
  const watchlist = useWatchlist()
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
        <SheetDescription className="sr-only">{t("error")}</SheetDescription>
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
        <SheetDescription className="sr-only">
          {t("shop.loading")}
        </SheetDescription>
        <LoadingSkeleton className="h-7 w-1/2" />
        <LoadingSkeleton className="h-4 w-3/4" />
        <LoadingSkeleton className="h-24 w-full" />
      </div>
    )
  }

  const data = shop.data
  const saved = watchlist.has(target)
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

      <button
        type="button"
        aria-pressed={saved}
        disabled={!saved && watchlist.full}
        onClick={() =>
          saved
            ? watchlist.remove(target)
            : watchlist.add({
                ...target,
                name: data.name,
                category: data.category,
              })
        }
        className="bg-secondary text-foreground mt-4 flex h-10 items-center gap-1 rounded-lg px-4 text-[15px] font-medium disabled:opacity-60"
      >
        <Heart
          aria-hidden
          className={cn("h-4 w-4", saved && "fill-foreground")}
        />
        {saved
          ? t("watch.saved")
          : watchlist.full
            ? t("watch.full")
            : t("watch.save")}
      </button>

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

      <div className="mt-5">
        <ShopDataOverview shop={data} headingId="bt-detail-data-overview" />
      </div>

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
