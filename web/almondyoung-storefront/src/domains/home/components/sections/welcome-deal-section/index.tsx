"use client"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import ProductCard from "@/domains/products/components/product-card"
import RankBadge from "@/domains/products/components/rank-badge"
import { CustomerGroup } from "@/lib/types/dto/medusa"
import { StoreCustomerWithGroups } from "@/lib/types/ui/medusa"
import { HttpTypes } from "@medusajs/types"
import { Header, MoreButton, Title } from "../../header"
import { ProductSectionEmpty } from "../../shared/product-section/empty-state"

interface WelcomeDealSectionProps {
  products: HttpTypes.StoreProduct[]
  customer: StoreCustomerWithGroups | null
  moreHref?: string
  wishlistIds?: Set<string>
}

export function WelcomeDealSection({
  products,
  customer,
  moreHref,
  wishlistIds,
}: WelcomeDealSectionProps) {
  const isMembership =
    customer?.groups?.some(
      (group: CustomerGroup) =>
        group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  return (
    <div className="w-full">
      <Header className="mb-6">
        <Title className="md:flex-1">
          웰컴딜 전체 제품 <span className="text-yellow-30">100원</span>
        </Title>
        {moreHref && <MoreButton href={moreHref} showOnDesktop={true} />}
      </Header>

      {products.length === 0 ? (
        <ProductSectionEmpty
          title="웰컴딜 상품이 없습니다"
          description="현재 진행 중인 웰컴딜 상품이 없습니다."
        />
      ) : (
        <Carousel opts={{ align: "start" }} className="group/carousel">
          <CarouselContent className="-ml-2 md:-ml-4">
            {products.map((p, index) => (
              <CarouselItem
                key={p.id}
                className="basis-[38%] pl-2 md:basis-[23%] md:pl-4 lg:basis-[18%]"
              >
                <ProductCard
                  product={p}
                  isMembership={isMembership}
                  isMembershipOnly={p.metadata?.isMembershipOnly === true}
                  overlay={<RankBadge rank={index + 1} variant="bottom-left" />}
                  isWishlisted={wishlistIds?.has(p.id ?? "") ?? false}
                />
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-2 hidden size-10 bg-white/90 opacity-0 shadow-md transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 md:inline-flex" />
          <CarouselNext className="right-2 hidden size-10 bg-white/90 opacity-0 shadow-md transition-opacity group-hover/carousel:opacity-100 disabled:opacity-0 md:inline-flex" />
        </Carousel>
      )}
    </div>
  )
}
