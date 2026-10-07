import { getTimeSalePresentation } from "@/lib/api/medusa/time-sale"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { PRODUCT_LIST_FIELDS_WITH_CATEGORIES } from "@lib/data/product-fields"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { ConfiguredTimeSale } from "../../components/sections/time-sale-section/configured"
import { getProductPrice } from "@/lib/utils/get-product-price"
import type { SaleSurface } from "@packages/domain-types/time-sale"

/** 세일 상품은 수십 개 규모라 한 번에 받는다. 넘치면 캐러셀이 잘라 보여준다. */
const MAX_PRODUCTS = 100

/** 홈에는 세일마다 데스크톱 두 줄(lg 5열)만 내보낸다. 나머지는 "더보기" 로 전용 페이지에서 본다. */


export async function TimeSaleWrapper({
  countryCode,
  surface = "main",
}: {
  countryCode: string
  background?: "white" | "muted"
  surface?: SaleSurface
}) {
  const { timeSales, settings } = await getTimeSalePresentation()
  if (!settings.environment[surface]) return null
  const sales = timeSales.filter(
    (sale) => sale.endsAt && sale.productIds.length > 0
  )
  if (sales.length === 0) return null

  const region = await getRegion(countryCode)

  // 세일이 여럿이어도 상품 조회는 한 번이다 — 세일마다 부르면 홈 렌더에 Medusa 왕복이 세일 수만큼
  // 붙는데, 세일은 상품이 겹치는 일도 있어 같은 상품을 두 번 받게 된다.
  const allProductIds = Array.from(
    new Set(sales.flatMap((sale) => sale.productIds))
  ).slice(0, MAX_PRODUCTS)

  const {
    response: { products: fetched },
  } = await listProducts({
    queryParams: {
      id: allProductIds,
      limit: MAX_PRODUCTS,
      // 탭을 상품의 카테고리에서 역산하므로 기본 필드에 카테고리를 얹는다.
      fields: PRODUCT_LIST_FIELDS_WITH_CATEGORIES,
    },
    regionId: region?.id,
  })

  const products = fetched
  if (products.length === 0) return null
  const availableIds = new Set(filterSoldOut(products).map((p) => p.id))

  // `/store/time-sale` 이 판매순 → 리뷰순 → 최신순으로 준 순서를 지킨다. `listProducts` 는 id
  // 필터라 그 순서를 보존하지 않으므로 여기서 되돌린다.
  const byId = new Map(products.map((product) => [product.id, product]))
  const sections = sales.map((sale) => ({
    sale,
    products: sale.productIds
      .map((id) => byId.get(id))
      .filter((product): product is (typeof products)[number] =>
        Boolean(product)
      ),
  }))

  const toSaleProduct = (product: (typeof products)[number]) => {
    const { cheapestPrice } = getProductPrice({ product })
    return {
      id: product.id,
      name: product.title,
      image: product.thumbnail,
      href: `/${countryCode}/products/${product.handle}`,
      price: cheapestPrice?.calculated_price_number ?? null,
      originalPrice: cheapestPrice?.original_price_number ?? null,
      soldOut: !availableIds.has(product.id),
    }
  }

  return (
    <>
      {sections
        .filter((section) => section.products.length > 0)
        .map(({ sale, products }) => (
          <ConfiguredTimeSale
            key={sale.priceListIds[0]}
            settings={settings}
            surface={surface}
            saleId={sale.priceListIds[0]}
            title={sale.title}
            startsAt={sale.startsAt ?? new Date().toISOString()}
            endsAt={sale.endsAt!}
            countryCode={countryCode}
            products={products.map(toSaleProduct)}
          />
        ))}
    </>
  )
}
