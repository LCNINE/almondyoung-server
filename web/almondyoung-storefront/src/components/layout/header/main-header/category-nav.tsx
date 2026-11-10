import { CategoryDropdown } from "@/components/category/dropdown"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { INTEREST_CANDIDATE_CATEGORIES } from "@/lib/constants/categories"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { cn } from "@/lib/utils"
import { getTranslations } from "next-intl/server"
import Image from "next/image"
import { CATEGORY_ICON_URLS, MEMBERSHIP_HALL_HREF } from "../header-links"

const SIDE_LINK_CLASS_NAME =
  "flex h-10 items-center px-3 text-[15px] font-semibold transition-colors"

export async function CategoryNav({
  categories,
}: {
  categories: StoreProductCategoryTree[]
}) {
  const [t, tCategories] = await Promise.all([
    getTranslations("header"),
    getTranslations("categories"),
  ])

  return (
    <nav
      aria-label={t("categoryNav.ariaLabel")}
      className="hidden border-b border-gray-200 bg-white xl:block"
    >
      <div className="container mx-auto flex h-[52px] max-w-[1280px] items-stretch gap-1 px-[32px]">
        <div className="flex">
          <CategoryDropdown categories={categories} variant="allCategories" />
        </div>
        <span aria-hidden className="mx-3 h-[18px] w-px self-center bg-gray-200" />

        <ul className="scrollbar-hide flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {INTEREST_CANDIDATE_CATEGORIES.map((category) => {
            const iconUrl = CATEGORY_ICON_URLS[category.key]

            return (
              <li key={category.key} className="shrink-0">
                <LocalizedClientLink
                  href={`/category/${category.handle}`}
                  className="hover:bg-muted hover:text-mint-deep flex h-10 items-center gap-1.5 rounded-[10px] px-2 text-[15px] font-semibold whitespace-nowrap transition-colors"
                >
                  {iconUrl && (
                    <Image
                      src={iconUrl}
                      alt=""
                      width={22}
                      height={22}
                      className="h-[22px] w-[22px] object-contain"
                    />
                  )}
                  {tCategories(category.key)}
                </LocalizedClientLink>
              </li>
            )
          })}
        </ul>

        <div className="flex shrink-0 items-center gap-0.5">
          <LocalizedClientLink
            href="/shop-trade"
            className={cn(SIDE_LINK_CLASS_NAME, "hover:text-mint-deep")}
          >
            {t("categoryDropdown.shopTrade")}
          </LocalizedClientLink>
          <LocalizedClientLink
            href={`/category/${BRAND_CATEGORY_HANDLE}`}
            className={cn(SIDE_LINK_CLASS_NAME, "hover:text-mint-deep")}
          >
            {t("categoryDropdown.brandHall")}
          </LocalizedClientLink>
          <LocalizedClientLink
            href={MEMBERSHIP_HALL_HREF}
            className={cn(SIDE_LINK_CLASS_NAME, "text-purple-deep")}
          >
            {t("categoryNav.membershipHall")}
          </LocalizedClientLink>
        </div>
      </div>
    </nav>
  )
}
