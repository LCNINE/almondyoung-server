"use client"

import { useEffect, useState, useTransition, type MouseEvent } from "react"
import { useTranslations } from "next-intl"
import { PromotionTracker } from "@/components/analytics/promotion-tracker"
import sanitizeHtml from "sanitize-html"
import type {
  TimeSaleSettings,
  SaleSurface,
} from "@packages/domain-types/time-sale"
import {
  SaleRenderer,
  type SalePagerItem,
  type SalePeriodLike,
  type SaleProduct,
  type SaleTab,
} from "@packages/time-sale-ui"
import type { HttpTypes } from "@medusajs/types"
import { ProductQuickActions } from "@/domains/products/components/product-quick-actions"
import { Quantity } from "@/domains/products/components/product-card/quantity"
import { loadTimeSaleMore } from "@/domains/time-sale/actions/load-time-sale-more"
import type { TimeSaleAllProps } from "@/domains/time-sale/templates/time-sale-all-template"

// 진행 중 세일 전부를 섹션 하나로 그린다(세일 이름은 고객에게 내보내지 않는다).
export function ConfiguredTimeSale({
  settings,
  surface,
  startsAt,
  endsAt,
  products,
  countryCode,
  tabs,
  activeTabKey,
  productCount,
  pager,
  stockProducts,
  sectionPeriods,
}: {
  settings: TimeSaleSettings
  surface: SaleSurface
  startsAt: string
  endsAt: string
  products: SaleProduct[]
  countryCode: string
  tabs?: SaleTab[]
  activeTabKey?: string
  productCount?: number
  pager?: SalePagerItem[]
  /** 상품 id → 원본 상품. 가격 아래 재고 상태(일부 품절·N개 남음)를 상품 카드와 같은 컴포넌트로 그린다. */
  stockProducts?: Record<string, HttpTypes.StoreProduct>
  /** 진행 중 세일 전부의 기간. 한 페이지 상품만 그려도 섹션 타이머는 가장 먼저 끝나는 세일을 따른다. */
  sectionPeriods?: SalePeriodLike[]
}) {
  return (
    <PromotionTracker
      key={surface}
      promotion={{
        promotion_id: "time_sale",
        promotion_name: "타임세일",
        creative_slot: `time_sale_${surface}`,
        items: products.map((product) => ({
          item_id: product.id,
          item_name: product.name,
        })),
      }}
    >
      <SaleRenderer
        settings={settings}
        surface={surface}
        startsAt={startsAt}
        endsAt={endsAt}
        products={products}
        tabs={tabs}
        activeTabKey={activeTabKey}
        productCount={productCount}
        sanitizeHtml={sanitizeHtml}
        moreHref={`/${countryCode}/time-sale`}
        renderMorePopup={
          surface === "main"
            ? () => <TimeSaleMorePopup countryCode={countryCode} />
            : undefined
        }
        pager={pager}
        sectionPeriods={sectionPeriods}
        renderProductStatus={(product) => {
          const stock = stockProducts?.[product.id]
          return stock ? <Quantity product={stock} /> : null
        }}
        renderProductActions={(product) =>
          product.quickActions ? (
            <ProductQuickActions
              productId={product.id}
              productHandle={product.quickActions.handle}
              productTitle={product.name}
              productImage={product.image ?? undefined}
              // 멤버십 전용 특가는 판매가 자리에 정가를 두고 실제 결제가(회원 특가)는 membershipPrice 에 있다.
              productPrice={
                (product.membershipSale ? product.membershipPrice : null) ??
                product.price ??
                0
              }
              productCurrency={product.quickActions.currency}
              variantId={product.quickActions.variantId}
              isSingleOption={product.quickActions.isSingleOption}
              membersOnlyPurchase={product.quickActions.membersOnlyPurchase}
              isWelcomeMembership={product.quickActions.isWelcomeMembership}
              isWishlisted={product.quickActions.isWishlisted}
              countryCode={countryCode}
            />
          ) : null
        }
      />
    </PromotionTracker>
  )
}

// 더보기 팝업. 더보기 페이지와 같은 한 페이지를 받아 그리고, 안의 탭·페이지 링크는
// 페이지를 떠나지 않고 팝업 안에서 다시 받는다.
function TimeSaleMorePopup({ countryCode }: { countryCode: string }) {
  const t = useTranslations("home.timeSale")
  const [query, setQuery] = useState({ tab: "all", page: 1 })
  // undefined = 아직 받는 중, null = 보여줄 세일이 없음(끝났거나 더보기가 꺼짐).
  const [data, setData] = useState<TimeSaleAllProps | null | undefined>(
    undefined
  )
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    // 탭·페이지를 빨리 바꾸면 늦게 끝난 옛 요청이 최신 결과를 덮지 않게 버린다.
    let stale = false
    startTransition(async () => {
      const next = await loadTimeSaleMore(countryCode, query.tab, query.page)
      if (!stale) setData(next)
    })
    return () => {
      stale = true
    }
  }, [countryCode, query])

  const stayInPopup = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return

    const href = event.target.closest("a")?.getAttribute("href")
    if (!href) return

    const url = new URL(href, window.location.origin)
    if (!url.pathname.endsWith("/time-sale")) return

    event.preventDefault()
    event.currentTarget.closest('[role="dialog"]')?.scrollTo({ top: 0 })
    setQuery({
      tab: url.searchParams.get("tab") ?? "all",
      page: Number(url.searchParams.get("page") ?? "1"),
    })
  }

  if (data === undefined)
    return <p className="py-24 text-center">{t("loading")}</p>
  if (data === null)
    return <p className="py-24 text-center">{t("noSaleTitle")}</p>

  return (
    <div
      onClickCapture={stayInPopup}
      className={pending ? "opacity-60" : undefined}
    >
      <ConfiguredTimeSale {...data} surface="more" />
    </div>
  )
}
