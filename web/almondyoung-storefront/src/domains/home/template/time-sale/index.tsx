import { getTimeSalePresentation } from "@/lib/api/medusa/time-sale"
import { getRegion } from "@/lib/api/medusa/regions"
import { ConfiguredTimeSale } from "../../components/sections/time-sale-section/configured"
import {
  buildPager,
  morePageSize,
  pageCount,
  pageIds,
  parsePage,
} from "@/lib/utils/time-sale-pagination"
import type {
  SaleSurface,
  SalePlatform,
} from "@packages/domain-types/time-sale"
import { buildSaleProducts } from "./sale-products"
import { fetchProductsByIds } from "./fetch-products"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getWishlist } from "@/lib/api/users/wishlist"
import {
  mainProductIds,
  matchesSalePartition,
  saleSectionPeriods,
} from "./section-plan"

// 홈/더보기의 타임세일 서버 컴포넌트:
// 세일 목록 → 세일별 상품 id 결정 → 상품 한 번에 조회 → 진열순위 첫 세일 하나만 섹션 렌더.
// 더보기(surface="more")는 ?page=N 으로 한 페이지 분량(열 x 행)만 조회한다.
export async function TimeSaleWrapper({
  countryCode,
  surface = "main",
  page: rawPage,
  partitionId = "home-sale",
  saleId,
  pagePlatform = "pc",
}: {
  countryCode: string
  background?: "white" | "muted"
  surface?: SaleSurface
  page?: string
  partitionId?: string
  saleId?: string
  pagePlatform?: SalePlatform
}) {
  // 1) 세일·설정 조회. 이 면(surface)이 꺼져 있거나 보여줄 세일이 없으면 렌더하지 않는다.
  const { timeSales, settings } = await getTimeSalePresentation()
  if (!settings.environment[surface]) return null
  const sales = timeSales.filter(
    (sale) =>
      sale.endsAt &&
      sale.productIds.length > 0 &&
      (!saleId || sale.saleId === saleId) &&
      (surface !== "main" ||
        matchesSalePartition(
          settings.sales[sale.saleId]?.partitionId,
          partitionId
        ))
  )
  if (sales.length === 0) return null

  // 2) 세일마다 이 화면에 올릴 상품 id 와 페이지 링크를 정한다.
  const pageSize =
    surface === "more" ? morePageSize(settings, pagePlatform) : null
  const plans = sales.map((sale) => {
    if (!pageSize) {
      const ids =
        surface === "more"
          ? sale.productIds
          : mainProductIds(sale.productIds, settings.environment.moreMode)

      return { sale, ids, pager: undefined }
    }

    const pages = pageCount(sale.productIds.length, pageSize)
    const page = parsePage(rawPage, pages)
    const hrefFor = (n: number) =>
      `/${countryCode}/time-sale?sale=${encodeURIComponent(sale.saleId)}&platform=${pagePlatform}&page=${n}`

    return {
      sale,
      ids: pageIds(sale.productIds, page, pageSize),
      pager: buildPager(
        page,
        pages,
        hrefFor,
        settings.styles.more[pagePlatform].components.find(
          (c) => c.type === "grid" || c.type === "carousel"
        )?.options.pageWindow
      ),
    }
  })

  // 3) 세일이 여럿이어도 상품 조회는 한 번(id 중복 제거).
  // 세일마다 부르면 Medusa 왕복이 세일 수만큼 붙는다.
  const region = await getRegion(countryCode)
  const allIds = Array.from(new Set(plans.flatMap((plan) => plan.ids)))
  const products = await fetchProductsByIds(allIds, region?.id)
  if (products.length === 0 && !pageSize) return null

  const customer = await retrieveCustomer()
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const isMember =
    customer?.groups?.some(
      (group) => group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  // 4) 섹션은 하나다. 진열순위(API 정렬) 앞에서부터 이 사용자에게 보일 게 있는 첫 세일만 그린다.
  // 페이지 안 상품이 전부 은닉돼도 페이지 링크가 있으면 남겨 다른 페이지로 갈 수 있게 한다.
  for (const { sale, ids, pager } of plans) {
    const saleProducts = buildSaleProducts({
      sale,
      ids,
      products,
      countryCode,
      isMember,
      wishlistIds: wishlist.map((item) => item.productId),
    })
    if (saleProducts.length === 0 && !pager) continue

    return (
      <ConfiguredTimeSale
        settings={settings}
        surface={surface}
        saleId={sale.saleId}
        title={sale.title}
        startsAt={sale.startsAt ?? new Date().toISOString()}
        endsAt={sale.endsAt!}
        countryCode={countryCode}
        products={saleProducts}
        sectionPeriods={saleSectionPeriods(sale)}
        pager={pager}
      />
    )
  }

  return null
}
