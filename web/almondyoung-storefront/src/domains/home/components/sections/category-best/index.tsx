"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useDraggableScroll } from "@/hooks/ui/use-draggable-scroll"
import testImg from "@assets/images/test.png"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { AnimatePresence, motion } from "framer-motion"
import { chunk } from "lodash"
import { ProductGrid } from "../../../../../components/products/product-grid"
import { useCategoryBest } from "../../../hooks/use-category-best"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"
import { CategoryTabs } from "./category-tabs"
import type { ProductList } from "@/lib/types/ui/product"

interface CategoryBestSectionProps {
  initialCategories: CategoryTreeNodeDto[]
  initialProducts: ProductList["products"] | null
}

export function CategoryBestSection({
  initialCategories,
  initialProducts,
}: CategoryBestSectionProps) {
  const bestCategories = initialCategories.slice(0, 7)

  const { activeTab, setActiveTab, visitedTabs, markAsVisited } =
    useCategoryBest(bestCategories[0]?.slug || "")
  const { props: dragHandlers } = useDraggableScroll()

  // TODO: 추후 실제 API 데이터로 교체
  const mockProductData = {
    brand: "아리메스",
    title: "아리메스 리뉴얼 블랙 영양제 블랙 10ml",
    price: 27000,
    originalPrice: 70000,
    discount: 78,
    rating: 4.9,
    reviewCount: 401,
    imageSrc: testImg.src,
  }

  const products = Array.from({ length: 12 }, (_, index) => ({
    ...mockProductData,
    id: String(index + 1),
  }))

  const isVisitedTab = visitedTabs.has(activeTab)

  const chunkedProducts = chunk(products, 6)

  return (
    <div className="w-full">
      <SectionHeader className="justify-between md:justify-center!">
        <SectionHeader.Title>
          카테고리 <span className="text-yellow-30">베스트</span>
        </SectionHeader.Title>
        <SectionHeader.More href={`/category/${activeTab}`} />
      </SectionHeader>

      <div className="flex w-full flex-col gap-1.5">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <CategoryTabs
            categories={bestCategories}
            activeTab={activeTab}
            dragHandlers={dragHandlers}
            layoutId="category-best-active-pill"
          />

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={
                isVisitedTab ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }
              }
              animate={{ opacity: 1, y: 0 }}
              exit={isVisitedTab ? { opacity: 0 } : { opacity: 0, y: -10 }}
              transition={{
                duration: isVisitedTab ? 0 : 0.2,
              }}
              onAnimationComplete={() => markAsVisited(activeTab)}
              className="min-h-96"
            >
              <TabsContent value={activeTab} className="mt-6">
                {/* modile */}
                <div className="md:hidden">
                  <ProductCarousel className="md:hidden">
                    <ProductCarousel.List>
                      {chunkedProducts.map((group, groupIndex) => (
                        <ProductCarousel.Item key={groupIndex}>
                          <div className="grid grid-cols-3 gap-x-3 gap-y-8 px-1">
                            {group.map((product, itemIndex) => {
                              const rank = groupIndex * 6 + itemIndex + 1
                              return (
                                <ProductCard key={product.id}>
                                  <ProductCard.Thumbnail
                                    src={product.imageSrc}
                                    alt={product.title}
                                    rank={<ProductCard.Rank rank={rank} />}
                                    className="rounded-tl-sm rounded-tr-xl rounded-br-xl rounded-bl-md"
                                  />
                                  <ProductCard.Info {...product} />
                                </ProductCard>
                              )
                            })}
                          </div>
                        </ProductCarousel.Item>
                      ))}
                    </ProductCarousel.List>

                    <ProductCarousel.Indicator itemsPerGroup={1} />
                  </ProductCarousel>
                </div>

                {/* desktop */}
                <div className="hidden md:block">
                  <ProductGrid
                    products={products.slice(0, 10)}
                    showRank={true}
                    roundedClassName="rounded-sm md:rounded-md"
                  />
                </div>
              </TabsContent>
            </motion.div>
          </AnimatePresence>
        </Tabs>
      </div>
    </div>
  )
}
