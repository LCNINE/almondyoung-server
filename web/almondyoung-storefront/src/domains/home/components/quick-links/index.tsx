import { CategoryDropdown } from "@/components/category/dropdown"
import { CategoryThumbnail } from "@/domains/category/components/category-thumbnail"
import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { listCategories } from "@/lib/api/medusa/categories"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { getInterestCategoryKeys } from "@/lib/data/cookies"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"
import { getTranslations } from "next-intl/server"
import Image from "next/image"

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

export async function HomeQuickLinks() {
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

  return (
    <section className="w-full border-b border-gray-100 bg-[#fbfaf8]">
      <div className="container mx-auto max-w-[1360px] px-3.5 py-4 md:px-[40px] md:py-5">
        <div className="relative">
          <nav
            aria-label="추천 바로가기"
            className="scrollbar-hide grid auto-cols-[76px] grid-flow-col gap-3 overflow-x-auto px-0.5 pb-1 md:auto-cols-auto md:grid-flow-row md:grid-cols-6 md:gap-x-5 md:gap-y-5 md:overflow-visible md:pb-0 xl:grid-cols-[repeat(13,minmax(0,1fr))]"
          >
            <div className="hidden w-full max-w-[78px] justify-self-center md:block">
              <CategoryDropdown
                categories={dropdownCategories}
                variant="quickLink"
              />
            </div>

            {externalLinks.map((link) => (
              <ExternalQuickLink
                key={`${link.label}-${link.href}`}
                link={link}
              />
            ))}

            {categoryLinks.map((link) => (
              <CategoryThumbnail
                key={`${link.label}-${link.href}`}
                name={link.label}
                href={link.href}
                imageUrl={link.imageUrl}
                sizes="(min-width: 768px) 78px, 68px"
                className="w-full max-w-[78px] justify-self-center rounded-lg px-0.5 py-1 transition-opacity hover:opacity-90"
              />
            ))}
          </nav>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 flex h-[92px] w-14 items-center justify-end bg-gradient-to-l from-[#fbfaf8] via-[#fbfaf8]/90 to-transparent md:hidden"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-500 shadow-sm">
              <ChevronRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function ExternalQuickLink({ link }: { link: QuickLink }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noreferrer"
      className="flex min-w-0 flex-col items-center gap-2 rounded-lg px-0.5 py-1 transition-opacity hover:opacity-90 md:w-full md:max-w-[78px] md:justify-self-center"
    >
      <span
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-lg border border-gray-100 shadow-sm",
          link.imageWrapClassName ?? "bg-gray-100"
        )}
      >
        <Image
          src={link.imageUrl}
          alt={link.label}
          fill
          sizes="(min-width: 768px) 78px, 68px"
          className={cn("object-cover", link.imageClassName)}
        />
      </span>
      <span className="line-clamp-2 min-h-[2.4em] text-center text-[12px] leading-tight font-semibold text-gray-700 md:text-[13px]">
        {(link.displayLabel ?? link.label).split("\n").map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>
    </a>
  )
}
