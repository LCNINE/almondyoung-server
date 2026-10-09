"use client"

import { useState } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"
import { TimeSaleDeadline } from "@/components/shared/time-sale-deadline"
import type { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import type { TimeSaleTab } from "@/lib/utils/time-sale-tabs"
import { ProductSection } from "../../shared/product-section"
import { HomeSection } from "../../shared/home-section"

interface TimeSaleSectionProps {
  endsAt: string
  /** 상품 id → 그 상품이 든 세일 중 가장 이른 종료. 없으면 `endsAt`. */
  productEndsAt: Record<string, string>
  products: HttpTypes.StoreProduct[]
  tabs: TimeSaleTab[]
  customer: StoreCustomerWithGroups | null
  wishlistIds?: Set<string>
  background?: "white" | "muted"
}

const toTabItem = (tab: TimeSaleTab) => ({ ...tab, id: tab.key })

const FALLBACK_TAB = {
  id: "all",
  key: "all",
  name: "",
  handle: "",
  productIds: [],
}

export function TimeSaleSection({
  endsAt,
  productEndsAt,
  products,
  tabs,
  customer,
  wishlistIds,
  background = "muted",
}: TimeSaleSectionProps) {
  const t = useTranslations("home.timeSale")
  const items = tabs.map(toTabItem)
  // 탭은 id 만 들고 매 렌더에서 다시 찾는다 — 세일 갱신으로 탭 목록이 바뀌면 붙잡아 둔 탭 객체는
  // 옛 productIds 를 가리켜 목록이 빈다.
  const [activeId, setActiveId] = useState<string | undefined>(items[0]?.id)
  const activeTab = items.find((item) => item.id === activeId) ?? items[0]

  const visible = activeTab
    ? products.filter((product) => activeTab.productIds.includes(product.id))
    : products

  // 운영자가 지은 세일 이름은 내부용이라 고객에게 내보내지 않는다 — 세일이 여럿이어도 제목은 "타임세일".
  const heading = (
    <span className="text-[#191f28]">
      {`${t("titleFirst")}${t("titleSecond")}`}
    </span>
  )

  return (
    <HomeSection background={background} className="[&_img]:p-0!">
      <ProductSection
        title={
          <>
            {heading}
            <TimeSaleDeadline endsAt={endsAt} className="mt-2" />
          </>
        }
        titleClassName="md:text-left [&>span]:block"
        tabs={items.length > 0 ? items : [FALLBACK_TAB]}
        activeTab={activeTab ?? FALLBACK_TAB}
        hideTabs={items.length === 0}
        products={visible}
        onTabChange={(tab) => setActiveId(tab.id)}
        customer={customer}
        wishlistIds={wishlistIds}
        moreHref="/time-sale"
        // 데스크톱은 두 줄까지만. lg 는 5열이라 10개가 두 줄이고, md 는 4열이라 그 구간에서만
        // 9번째부터 감춰 두 줄을 맞춘다. 넘치는 상품은 "더보기" 로 전용 페이지에서 본다.
        gridClassName="md:max-lg:[&>li:nth-child(n+9)]:hidden"
        emptyTitle={t("emptyTitle")}
        renderOverlay={(product) => (
          <TimeSaleCountdown
            endsAt={productEndsAt[product.id] ?? endsAt}
            compact
            clockOnly
            className="absolute inset-x-0 bottom-0 z-10 bg-black/55 py-1 text-center text-[13px] font-semibold text-white tabular-nums"
          />
        )}
      />
    </HomeSection>
  )
}
