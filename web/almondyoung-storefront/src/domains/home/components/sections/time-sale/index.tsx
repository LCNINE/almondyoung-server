"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useCategoryTabs } from "@/domains/home/hooks/use-category-tabs"
import { useDraggableScroll } from "@/hooks/ui/use-draggable-scroll"
import testImg from "@assets/images/test.png"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { AnimatePresence, motion } from "framer-motion"
import { ProductGrid } from "../../../../../components/products/product-grid"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"
import { CategoryTabs } from "../category-best/category-tabs"

interface TimeSaleSectionProps {
  initialCategories: CategoryTreeNodeDto[]
}

export function TimeSaleSection({ initialCategories }: TimeSaleSectionProps) {
  const bestCategories = initialCategories.slice(0, 7)

  const { activeTab, setActiveTab, visitedTabs, markAsVisited } =
    useCategoryTabs(bestCategories[0]?.slug || "")

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

  return (
    <div className="w-full">
      <SectionHeader className="justify-between md:justify-center!">
        <SectionHeader.Title>
          <span className="md:text-red-30 text-black">타임</span> 세일
        </SectionHeader.Title>
        <SectionHeader.More href={`/category/time-sale`} />
      </SectionHeader>

      <div className="flex w-full flex-col gap-1.5">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <CategoryTabs
            categories={bestCategories}
            activeTab={activeTab}
            dragHandlers={dragHandlers}
            layoutId="time-sale-active-pill"
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
              <TabsContent value={activeTab} className="">
                {/* modile */}
                <div className="md:hidden">
                  <ProductCarousel
                    opts={{ align: "start", containScroll: "trimSnaps" }}
                    className="md:hidden"
                  >
                    <ProductCarousel.List className="ml-0">
                      {products.map((product) => (
                        <ProductCarousel.Item
                          key={product.id}
                          className="basis-[42%] pl-0"
                        >
                          <ProductCard className="border-r-[0.5px] border-r-gray-100 pr-4 last:border-r-0">
                            <ProductCard.Thumbnail
                              src={product.imageSrc}
                              alt={product.title}
                              className="rounded-sm md:rounded-md"
                            />
                            <ProductCard.Info {...product} />
                          </ProductCard>
                        </ProductCarousel.Item>
                      ))}
                    </ProductCarousel.List>
                  </ProductCarousel>
                </div>

                {/* desktop */}
                <div className="hidden md:block">
                  <ProductGrid
                    products={products.slice(0, 5)}
                    showRank={false}
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
