import { CategoryDropdown } from "@/components/category/dropdown"
import { CategoryThumbnail } from "@/domains/category/components/category-thumbnail"
import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { listCategories } from "@/lib/api/medusa/categories"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { getInterestCategoryKeys } from "@/lib/data/cookies"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { cn } from "@/lib/utils"
import { getTranslations } from "next-intl/server"
import Image from "next/image"
import {
  MobileQuickLinks,
  type MobileQuickLinkItem,
} from "./mobile-quick-links"

const DABEAU_IMAGE_URL =
  "https://almondyoung-public.s3.ap-northeast-2.amazonaws.com/storefront/quick-links/dabeau-2.png"
const ALMOND_YOUNG_PLAY_IMAGE_URL =
  "https://almondyoung-public.s3.ap-northeast-2.amazonaws.com/storefront/quick-links/amdp-logo-white.png"

type QuickLink = {
  label: string
  displayLabel?: string
  href: string
  imageUrl: string
  external?: boolean
  imageClassName?: string
  imageWrapClassName?: string
}

type CategoryQuickLink = {
  label: string
  href: string
  imageUrl: string | null
}

export async function HomeQuickLinks({
  variant = "home",
}: {
  variant?: "home" | "desktopHeader"
}) {
  const tCategories = await getTranslations("categories")
  const interestKeys = await getInterestCategoryKeys()
  const interestKeySet = new Set(interestKeys)
  let dropdownCategories: StoreProductCategoryTree[] = []

  try {
    dropdownCategories = await listCategories({ parent_category_id: "null" })
  } catch (error) {
    console.error("[HomeQuickLinks] Failed to load dropdown categories:", error)
  }

  const orderedInterest = interestKeys
    .map((key) => FIXED_CATEGORIES.find((category) => category.key === key))
    .filter((category): category is (typeof FIXED_CATEGORIES)[number] =>
      Boolean(category)
    )

  const orderedCategories = [
    ...orderedInterest,
    ...FIXED_CATEGORIES.filter((category) => !interestKeySet.has(category.key)),
  ]

  const externalLinks: QuickLink[] = [
    {
      label: "아몬드영 플레이",
      displayLabel: "아몬드영\n플레이",
      href: "https://www.almondyoungplay.com/",
      imageUrl: ALMOND_YOUNG_PLAY_IMAGE_URL,
      external: true,
      imageClassName: "object-contain p-2.5",
      imageWrapClassName: "bg-[#4f4a44]",
    },
    {
      label: "다뷰",
      href: "https://dabeau.kr",
      imageUrl: DABEAU_IMAGE_URL,
      external: true,
      imageClassName: "object-contain p-2.5",
      imageWrapClassName: "bg-white",
    },
  ]

  const categoryLinks: CategoryQuickLink[] = orderedCategories.map(
    (category) => {
      const categoryForThumbnail = {
        id: category.id,
        name: category.name,
        handle: category.handle,
      } as StoreProductCategoryTree

      return {
        label: tCategories(category.key),
        href: `/category/${category.handle}`,
        imageUrl: getCategoryThumbnail(categoryForThumbnail),
      }
    }
  )
  const isDesktopHeader = variant === "desktopHeader"
  const mobileItems: MobileQuickLinkItem[] = [
    ...externalLinks,
    ...categoryLinks.map((link) => ({
      ...link,
      external: false,
    })),
  ]

  return (
    <section
      className={cn(
        "w-full border-b",
        isDesktopHeader
          ? "border-header-border bg-header-background"
          : "border-gray-100 bg-white md:bg-[#fbfaf8]"
      )}
    >
      <div
        className={cn(
          "container mx-auto max-w-[1360px]",
          isDesktopHeader
            ? "px-[40px] py-1.5"
            : "px-3.5 py-4 md:px-[40px] md:py-5"
        )}
      >
        <div className="relative">
          {!isDesktopHeader && <MobileQuickLinks items={mobileItems} />}

          <nav
            aria-label="추천 바로가기"
            className={cn(
              "scrollbar-hide overflow-x-auto px-0.5",
              isDesktopHeader
                ? "grid auto-cols-max grid-flow-col items-center gap-5 overflow-visible pb-0"
                : "hidden md:grid md:auto-cols-auto md:grid-flow-row md:grid-cols-6 md:grid-rows-none md:gap-x-5 md:gap-y-5 md:overflow-visible md:pb-0 xl:grid-cols-[repeat(13,minmax(0,1fr))]"
            )}
          >
            {!isDesktopHeader && (
              <div className="hidden w-full max-w-[78px] justify-self-center md:block">
                <CategoryDropdown
                  categories={dropdownCategories}
                  variant="quickLink"
                />
              </div>
            )}

            {externalLinks.map((link) => (
              <ExternalQuickLink
                key={`${link.label}-${link.href}`}
                link={link}
                compact={isDesktopHeader}
              />
            ))}

            {categoryLinks.map((link) => (
              <CategoryThumbnail
                key={`${link.label}-${link.href}`}
                name={link.label}
                href={link.href}
                imageUrl={link.imageUrl}
                sizes={
                  isDesktopHeader ? "24px" : "(min-width: 768px) 78px, 54px"
                }
                className={cn(
                  "justify-self-center rounded-lg px-0.5 py-1 transition-opacity hover:opacity-90",
                  isDesktopHeader
                    ? "w-auto min-w-max flex-row gap-1.5 text-xs [&>div]:h-5 [&>div]:w-5 [&>span]:min-h-0 [&>span]:text-[12px] [&>span]:font-medium [&>span]:text-white/85 hover:[&>span]:text-white"
                    : "w-full max-w-[54px] md:max-w-[78px]"
                )}
              />
            ))}
          </nav>
        </div>
      </div>
    </section>
  )
}

function ExternalQuickLink({
  link,
  compact = false,
}: {
  link: QuickLink
  compact?: boolean
}) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex min-w-0 items-center rounded-lg px-0.5 py-1 transition-opacity hover:opacity-90",
        compact
          ? "w-auto flex-row gap-1.5 text-xs text-white/85 hover:text-white"
          : "w-full max-w-[54px] flex-col gap-2 justify-self-center md:max-w-[78px]"
      )}
    >
      <span
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-lg border border-gray-100 shadow-sm",
          compact && "h-5 w-5 rounded-none border-0 shadow-none",
          link.imageWrapClassName ?? "bg-gray-100"
        )}
      >
        <Image
          src={link.imageUrl}
          alt={link.label}
          fill
          sizes={compact ? "24px" : "(min-width: 768px) 78px, 54px"}
          className={cn(
            "object-cover",
            link.imageClassName,
            compact && "object-contain p-0"
          )}
        />
      </span>
      <span
        className={cn(
          "line-clamp-2 text-center leading-tight font-semibold text-gray-700",
          compact
            ? "min-h-0 text-[12px] font-medium text-current"
            : "min-h-[2.4em] text-[12px] md:text-[13px]"
        )}
      >
        {(link.displayLabel ?? link.label).split("\n").map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>
    </a>
  )
}
