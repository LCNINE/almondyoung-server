import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProductsSorted } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { getIsMembershipOnly } from "@/lib/utils/product-card"
import ProductCard from "@/domains/products/components/product-card"
import RankBadge from "@/domains/products/components/rank-badge"
import { getWishlist } from "@lib/api/users/wishlist"
import { ArrowRight } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { Title } from "../../components/header"
import { HomeSection } from "../../components/shared/home-section"

const HANDLE = "9xpr2r"
const SECTION_LIMIT = 10

export async function OverseasShowcaseWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const [region, category, customer, t] = await Promise.all([
    getRegion(countryCode),
    getCategoryByHandle([HANDLE]),
    retrieveCustomer(),
    getTranslations("home.showcase"),
  ])

  if (!category) return null

  const {
    response: { products },
  } = await listProductsSorted({
    categoryId: collectCategoryIds(category),
    sortBy: "sales_count",
    order: "desc",
    limit: SECTION_LIMIT,
    regionId: region?.id,
  })

  if (products.length === 0) return null

  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  const isMembership =
    customer?.groups?.some(
      (group) => group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  const [head, ...tail] = t("overseas").split(" ")

  return (
    <HomeSection background="muted" className="border-t-0">
      <Carousel opts={{ align: "start" }} className="group/carousel w-full">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <Title>
              {head} <span className="text-yellow-30">{tail.join(" ")}</span>
            </Title>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("overseasDescription")}
            </p>
          </div>
          <LocalizedClientLink
            href={`/category/${HANDLE}`}
            className="text-primary inline-flex items-center gap-1 text-sm font-semibold"
          >
            {t("viewAll")} <ArrowRight className="h-4 w-4" />
          </LocalizedClientLink>
        </div>
        <CarouselContent className="-ml-2 py-2 sm:-ml-4">
          {products.map((product, index) => (
            <CarouselItem
              key={product.id}
              className="basis-[45%] pl-2 sm:basis-[38%] sm:pl-4 lg:basis-[31%]"
            >
              <div className="sm:rounded-2xl sm:bg-white sm:p-5 sm:pb-6 sm:shadow-sm">
                <ProductCard
                  product={product}
                  isMembership={isMembership}
                  isMembershipOnly={getIsMembershipOnly(product)}
                  isWishlisted={wishlistIds.has(product.id ?? "")}
                  overlay={<RankBadge rank={index + 1} />}
                />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-2 hidden size-10 bg-white/90 opacity-0 shadow-md transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 md:inline-flex" />
        <CarouselNext className="right-2 hidden size-10 bg-white/90 opacity-0 shadow-md transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 md:inline-flex" />
      </Carousel>
    </HomeSection>
  )
}
