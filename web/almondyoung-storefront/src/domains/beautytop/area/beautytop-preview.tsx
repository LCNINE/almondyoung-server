"use client"

import { Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { AreaView } from "./area-view"
import { ShopTeaser } from "./shop-teaser"
import { UnlockDrawer } from "./unlock-drawer"

const CHIPS = ["rank", "peers", "prices"] as const

/** What visitors without membership see: the whole neighbourhood, and a question mark where their shop's answer is. */
export function BeautyTopPreview({ signedIn, loginHref }: { signedIn: boolean; loginHref: string }) {
  const t = useTranslations("beautytop.unlock")
  const [mine, setMine] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="mt-6 pb-24">
        <AreaView
          mineLabel={mine}
          shopSlot={(filters) => (
            <ShopTeaser
              key={`${filters.sido}:${filters.gugun}`}
              area={filters}
              signedIn={signedIn}
              loginHref={loginHref}
              onPick={(shop) => setMine(shop?.name ?? null)}
            />
          )}
        />
        <section className="mt-8 flex flex-col gap-2">
          <h2 className="text-lg font-bold">{t("everyoneTitle")}</h2>
          <p className="text-muted-foreground text-sm leading-[19px] break-keep">{t("everyoneBody")}</p>
        </section>
      </div>
      <div className="border-border bg-background sticky bottom-0 z-10 -mx-4 border-t px-4 pt-3 pb-4">
        <ul className="text-muted-foreground mb-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[13px]">
          {CHIPS.map((key) => (
            <li key={key} className="flex items-center gap-1">
              <Check aria-hidden="true" className="text-primary h-3.5 w-3.5" />
              {t(`chips.${key}`)}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-primary hover:bg-primary/90 h-[52px] w-full rounded-xl text-base font-bold text-white transition-colors duration-150"
        >
          {t("cta")}
        </button>
      </div>
      <UnlockDrawer open={open} onOpenChange={setOpen} signedIn={signedIn} loginHref={loginHref} />
    </>
  )
}
