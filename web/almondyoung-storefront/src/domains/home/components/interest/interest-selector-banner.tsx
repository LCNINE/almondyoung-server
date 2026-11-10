"use client"

import { Button } from "@/components/ui/button"
import {
  dismissInterestBanner7Days,
  updateInterestCategories,
} from "@/domains/home/interest-categories-actions"
import ProductCard from "@/domains/products/components/product-card"
import { MAX_INTEREST_CATEGORIES } from "@/lib/constants/categories"
import type { CustomerGroup } from "@/lib/types/dto/medusa"
import type { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import { getIsMembershipOnly } from "@/lib/utils/product-card"
import type { HttpTypes } from "@medusajs/types"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { ArrowLeftRight, X } from "lucide-react"
import { HomeRail } from "../shared/home-rail"
import { InterestKeyChips } from "./interest-key-chips"
import { mergeBestProducts } from "./merge-best-products"

const PREVIEW_LIMIT = 15
const STAGGER_MS = 50
const STAGGER_MAX = 5
const REVEAL =
  "animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-[350ms] ease-[cubic-bezier(0,0,.2,1)] motion-reduce:animate-none"

interface InterestSelectorBannerProps {
  initialKeys: string[]
  bestByKey: Record<string, HttpTypes.StoreProduct[]>
  customer: StoreCustomerWithGroups | null
  wishlistIds: string[]
}

export function InterestSelectorBanner({
  initialKeys,
  bestByKey,
  customer,
  wishlistIds,
}: InterestSelectorBannerProps) {
  const t = useTranslations("home.interestBanner")
  const tCat = useTranslations("categories")
  const [selected, setSelected] = useState<string[]>(initialKeys)
  // 한 번 고르면 칩을 접고 바꾸기를 누를 때만 다시 펼친다
  const [isPicking, setIsPicking] = useState(initialKeys.length === 0)
  const [, startSave] = useTransition()
  const [isDismissing, startDismiss] = useTransition()

  const isMembership =
    customer?.groups?.some(
      (group: CustomerGroup) =>
        group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false
  const wishlisted = new Set(wishlistIds)

  const handleChange = (next: string[]) => {
    setSelected(next)

    startSave(async () => {
      try {
        await updateInterestCategories(next)
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("saveFail"))
      }
    })
  }

  const handleDismiss = () => {
    startDismiss(async () => {
      try {
        await dismissInterestBanner7Days()
      } catch {
        toast.error(t("dismissFail"))
      }
    })
  }

  const selectedNames = selected
    .map((key) => tCat(key as "lash-perm"))
    .join(" · ")
  const products = mergeBestProducts(
    selected.map((key) => bestByKey[key] ?? []),
    PREVIEW_LIMIT
  )

  return (
    <section aria-labelledby="interest-selector-title">
      <div className="relative mb-5 flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
        <div className="w-full md:w-auto">
          <h2
            id="interest-selector-title"
            className="pr-9 text-[20px] leading-[1.3] font-bold break-keep text-black md:pr-0 md:text-[26px] md:leading-[1.11]"
          >
            {t("title")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm break-keep">
            {t("description", { max: MAX_INTEREST_CATEGORIES })}
          </p>
        </div>

        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={handleDismiss}
          disabled={isDismissing}
          aria-label={t("dismiss")}
          className="text-muted-foreground hover:text-foreground absolute -top-1 -right-2 size-9 p-0 md:static md:size-auto md:shrink-0 md:text-[13px] md:font-normal md:underline md:underline-offset-4"
        >
          <X className="size-5 md:hidden" strokeWidth={1.8} aria-hidden />
          <span className="hidden md:inline">{t("dismiss")}</span>
        </Button>
      </div>

      {isPicking ? (
        <>
          <InterestKeyChips
            variant="card"
            selectedKeys={selected}
            onChange={handleChange}
          />

          <Button
            type="button"
            onClick={() => setIsPicking(false)}
            disabled={selected.length === 0}
            className="mt-4 h-12 w-full rounded-xl text-[15px] font-bold disabled:bg-gray-100 disabled:text-gray-400 disabled:opacity-100 md:w-auto md:px-6"
          >
            {selected.length === 0
              ? t("selectPrompt")
              : t("showBest", { count: selected.length })}
          </Button>
        </>
      ) : (
        <div
          key={selected.join(",")}
          className="animate-in fade-in fill-mode-both duration-[250ms] motion-reduce:animate-none"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-bold break-keep text-black">
              {selectedNames}{" "}
              <span className="text-mint">{t("previewSuffix")}</span>
            </h3>
            <button
              type="button"
              onClick={() => setIsPicking(true)}
              className="border-border inline-flex h-8 shrink-0 items-center gap-1 rounded-full border bg-white px-3 text-[13px] font-bold text-gray-700 transition-colors hover:border-gray-400"
            >
              <ArrowLeftRight
                className="size-3.5"
                strokeWidth={2.2}
                aria-hidden
              />
              {t("change")}
            </button>
          </div>

          <HomeRail>
            {products.map((product, index) => (
              <div
                key={product.id}
                className={REVEAL}
                style={{
                  animationDelay: `${Math.min(index, STAGGER_MAX) * STAGGER_MS}ms`,
                }}
              >
                <ProductCard
                  product={product}
                  isMembership={isMembership}
                  isMembershipOnly={getIsMembershipOnly(product)}
                  isWishlisted={wishlisted.has(product.id ?? "")}
                  enablePhotoSwipe={false}
                />
              </div>
            ))}
          </HomeRail>
        </div>
      )}
    </section>
  )
}
