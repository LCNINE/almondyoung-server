"use client"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import ProductCard from "@/domains/products/components/product-card"
import { CustomerGroup } from "@/lib/types/dto/medusa"
import { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import { HttpTypes } from "@medusajs/types"
import chunk from "lodash/chunk"
import { ReactNode } from "react"
import { Header, MoreButton, Title } from "../../header"
import { ResponsiveTabList } from "../responsive-tab-list"
import { ProductSectionEmpty } from "./empty-state"
import { ProductSectionSkeleton } from "./skeleton"

interface TabItem {
  id: string
  name: string
  handle?: string
}

interface ProductSectionProps<T extends TabItem> {
  title: ReactNode
  tabs: readonly T[]
  activeTab: T
  products: HttpTypes.StoreProduct[]
  isPending?: boolean
  moreHref?: string
  onTabChange: (tab: T) => void
  customer: StoreCustomerWithGroups | null
  emptyTitle?: string
  emptyDescription?: string
  /** 모바일 캐러셀에서 보여줄 행 수 (기본값: 2) */
  mobileRows?: number
  /** 위시리스트에 담긴 상품 ID Set */
  wishlistIds?: Set<string>
}

export function ProductSection<T extends TabItem>({
  title,
  tabs,
  activeTab,
  products,
  isPending = false,
  moreHref,
  onTabChange,
  customer,
  emptyTitle,
  emptyDescription,
  mobileRows = 2,
  wishlistIds,
}: ProductSectionProps<T>) {
  const handleTabChange = (value: string) => {
    const nextTab = tabs.find((t) => t.id === value)
    if (nextTab) {
      onTabChange(nextTab)
    }
  }

  const renderProducts = () => {
    if (isPending) {
      return <ProductSectionSkeleton />
    }

    if (products.length === 0) {
      return (
        <ProductSectionEmpty
          title={emptyTitle}
          description={emptyDescription}
        />
      )
    }

    const renderProductCard = (p: HttpTypes.StoreProduct, index: number) => (
      <ProductCard
        product={p}
        isMembership={
          customer?.groups?.some(
            (group: CustomerGroup) =>
              group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
          ) ?? false
        }
        isMembershipOnly={p.metadata?.isMembershipOnly === true ? true : false}
        rank={index + 1}
        isWishlisted={wishlistIds?.has(p.id ?? "") ?? false}
      />
    )

    const chunkedProducts = chunk(products, mobileRows)

    return (
      <>
        {/* 모바일: 캐러셀 (2줄) */}
        <Carousel className="md:hidden" opts={{ align: "start" }}>
          <CarouselContent className="-ml-2">
            {chunkedProducts.map((chunk, chunkIndex) => (
              <CarouselItem key={chunkIndex} className="basis-[45%] pl-2">
                <div className="flex flex-col gap-4">
                  {chunk.map((p, index) => (
                    <div key={p.id}>
                      {renderProductCard(p, chunkIndex * mobileRows + index)}
                    </div>
                  ))}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        {/* 태블릿 이상 */}
        <ul className="hidden w-full gap-x-4 gap-y-6 md:grid md:grid-cols-4 lg:grid-cols-5">
          {products.map((p, index) => (
            <li key={p.id}>{renderProductCard(p, index)}</li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <div className="w-full">
      <Header className="mb-6">
        <Title className="md:flex-1 md:text-center">{title}</Title>
        {moreHref && <MoreButton href={moreHref} />}
      </Header>

      <Tabs defaultValue={activeTab.id} onValueChange={handleTabChange}>
        <ResponsiveTabList
          items={tabs}
          activeId={activeTab.id}
          onTabChange={handleTabChange}
        />
        <TabsContent value={activeTab.id}>{renderProducts()}</TabsContent>
      </Tabs>
    </div>
  )
}
