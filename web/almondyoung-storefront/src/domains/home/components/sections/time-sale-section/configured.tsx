"use client"

import { PromotionTracker } from "@/components/analytics/promotion-tracker"
import sanitizeHtml from "sanitize-html"
import type {
  TimeSaleSettings,
  SaleSurface,
} from "@packages/domain-types/time-sale"
import {
  SaleRenderer,
  type SalePagerItem,
  type SaleProduct,
  type SaleTab,
} from "@packages/time-sale-ui"
import type { HttpTypes } from "@medusajs/types"
import { ProductQuickActions } from "@/domains/products/components/product-quick-actions"
import { Quantity } from "@/domains/products/components/product-card/quantity"

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
        pager={pager}
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
              productPrice={product.price ?? 0}
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
