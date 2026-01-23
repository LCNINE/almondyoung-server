"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useDraggableScroll } from "@/hooks/ui/use-draggable-scroll"
import { ProductCardProps } from "@/lib/types/ui/product"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { AnimatePresence, motion } from "framer-motion"
import { Package } from "lucide-react"
import { chunk } from "lodash"
import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ProductGrid } from "../../../../../components/products/product-grid"
import { useCategoryTabs } from "../../../hooks/use-category-tabs"
import { getCategoryBestProducts } from "../../actions/get-category-products"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"
import { CategoryTabs } from "./category-tabs"

interface CategoryBestSectionProps {
  initialCategories: CategoryTreeNodeDto[]
  initialProducts: ProductCardProps[] | undefined
}

export function CategoryBestSection({
  initialCategories,
  initialProducts,
}: CategoryBestSectionProps) {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const [isPending, startTransition] = useTransition()

  const bestCategories = initialCategories.slice(0, 7)
  const [products, setProducts] = useState<ProductCardProps[]>(
    initialProducts || []
  )

  const { activeTab, setActiveTab, visitedTabs, markAsVisited } =
    useCategoryTabs(bestCategories[0]?.id || "")

  const chunkedProducts = useMemo(() => chunk(products, 6) || [], [products])

  useEffect(() => {
    startTransition(async () => {
      const products = await getCategoryBestProducts(activeTab)
      setProducts(products)
    })
  }, [activeTab])

  const { props: dragHandlers } = useDraggableScroll()
  const isVisitedTab = visitedTabs.has(activeTab)

  // 현재 활성화된 카테고리 정보 찾기 (더보기 링크용)
  const activeCategory = bestCategories.find((cat) => cat.id === activeTab)

  return (
    <div className="w-full">
      <SectionHeader className="justify-between md:justify-center!">
        <SectionHeader.Title>
          카테고리 <span className="text-yellow-30">베스트</span>
        </SectionHeader.Title>
        <SectionHeader.More
          href={`/category/${activeCategory?.slug || activeTab}`}
        />
      </SectionHeader>

      <div className="flex w-full flex-col gap-1.5">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <CategoryTabs
            categories={bestCategories}
            activeTab={activeTab}
            dragHandlers={dragHandlers}
            layoutId="category-best-active-pill"
          />

          {products.length === 0 ? (
            <div className="min-h-96">
              <div
                className={
                  isPending ? "opacity-60 transition-opacity" : "opacity-100"
                }
              >
                <TabsContent value={activeTab} className="mt-6">
                  {/* mobile empty state */}
                  <div className="flex flex-col items-center justify-center px-4 py-16 md:hidden">
                    <div className="bg-gray-10 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                      <Package className="text-gray-40 h-8 w-8" />
                    </div>
                    <h3 className="text-gray-90 mb-2 text-base font-semibold">
                      상품이 없습니다
                    </h3>
                    <p className="text-gray-60 text-center text-sm">
                      이 카테고리에 등록된 상품이 없습니다.
                    </p>
                  </div>

                  {/* desktop empty state */}
                  <div className="hidden flex-col items-center justify-center px-6 py-24 md:flex">
                    <div className="bg-gray-10 mb-6 flex h-20 w-20 items-center justify-center rounded-full">
                      <Package className="text-gray-40 h-10 w-10" />
                    </div>
                    <h3 className="text-gray-90 mb-3 text-xl font-semibold">
                      상품이 없습니다
                    </h3>
                    <p className="text-gray-60 max-w-md text-center text-base">
                      이 카테고리에 등록된 상품이 없습니다.
                    </p>
                  </div>
                </TabsContent>
              </div>
            </div>
          ) : (
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
                <div
                  className={
                    isPending ? "opacity-60 transition-opacity" : "opacity-100"
                  }
                >
                  <TabsContent value={activeTab} className="mt-6">
                    {/* mobile layout */}
                    <div className="md:hidden">
                      <ProductCarousel className="md:hidden">
                        <ProductCarousel.List>
                          {chunkedProducts.map((group, groupIndex) => (
                            <ProductCarousel.Item key={groupIndex}>
                              <div className="grid grid-cols-3 gap-x-3 gap-y-8 px-1">
                                {group.map((product, itemIndex) => {
                                  const rank = groupIndex * 6 + itemIndex + 1
                                  return (
                                    <Link
                                      key={product.id}
                                      href={`/${countryCode}/products/${product.id}`}
                                      className="block"
                                    >
                                      <ProductCard>
                                        <ProductCard.Thumbnail
                                          src={product.imageSrc}
                                          alt={product.title}
                                          rank={
                                            <ProductCard.Rank rank={rank} />
                                          }
                                          className="rounded-tl-sm rounded-tr-xl rounded-br-xl rounded-bl-md"
                                        />
                                        <ProductCard.Info {...product} />
                                      </ProductCard>
                                    </Link>
                                  )
                                })}
                              </div>
                            </ProductCarousel.Item>
                          ))}
                        </ProductCarousel.List>
                        <ProductCarousel.Indicator itemsPerGroup={1} />
                      </ProductCarousel>
                    </div>

                    {/* desktop layout */}
                    <div className="hidden md:block">
                      <ProductGrid
                        products={products.slice(0, 10)}
                        showRank={true}
                        roundedClassName="rounded-sm md:rounded-md"
                        countryCode={countryCode}
                      />
                    </div>
                  </TabsContent>
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </Tabs>
      </div>
    </div>
  )
}
