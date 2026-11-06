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
      <div className="mb-5 flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
        <div>
          <h2
            id="interest-selector-title"
            className="text-foreground text-xl font-bold tracking-[-0.03em] break-keep md:text-[22px]"
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
          className="text-muted-foreground hover:text-foreground h-auto shrink-0 p-0 text-[13px] font-normal underline underline-offset-4"
        >
          {t("dismiss")}
        </Button>
      </div>

      <InterestKeyChips
        variant="card"
        selectedKeys={selected}
        onChange={handleChange}
      />

      <div
        key={selected.join(",")}
        className="animate-in fade-in fill-mode-both mt-10 duration-[250ms] motion-reduce:animate-none"
      >
        {selected.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-[14px] border border-dashed bg-white p-7 text-center text-sm">
            {t("selectPrompt")}
          </p>
        ) : (
          <>
            <h3 className="text-ink mb-5 text-base font-bold break-keep">
              <span className="text-mint-deep">{selectedNames}</span>{" "}
              {t("previewSuffix")}
            </h3>

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
          </>
        )}
      </div>
    </section>
  )
}
