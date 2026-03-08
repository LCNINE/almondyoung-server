"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useDraggableScroll } from "@/hooks/ui/use-draggable-scroll"
import { ProductCardProps } from "@/lib/types/ui/product"
import { AnimatePresence, motion } from "framer-motion"
import { Package } from "lucide-react"
import { chunk } from "lodash"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ProductGrid } from "../../../../../components/products/product-grid"
import { useCategoryTabs } from "../../../hooks/use-category-tabs"
import { getCategoryBestProducts } from "../../actions/get-category-products"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"
import { CategoryTabs } from "./category-tabs"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { useUser } from "@/contexts/user-context"

function CategoryBestSkeletonCard({ className }: { className?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className={`aspect-3/4 w-full ${className} bg-gray-200`} />
      <div className="flex flex-col gap-1 px-1">
        <Skeleton className="h-4 w-4/5 bg-gray-200" />
        <Skeleton className="h-4 w-3/5 bg-gray-200" />
        <Skeleton className="h-3 w-2/5 bg-gray-200" />
      </div>
    </div>
  )
}

function CategoryBestSkeletonGrid() {
  return (
    <>
      {/* mobile skeleton */}
      <div className="md:hidden">
        <div className="grid grid-cols-3 gap-x-3 gap-y-8 px-1">
          {Array.from({ length: 6 }).map((_, index) => (
            <CategoryBestSkeletonCard
              key={`category-best-skeleton-mobile-${index}`}
            />
          ))}
        </div>
      </div>

      {/* desktop skeleton */}
      <div className="hidden md:grid md:grid-cols-4 md:gap-x-3 md:gap-y-8 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, index) => (
          <CategoryBestSkeletonCard
            key={`category-best-skeleton-desktop-${index}`}
          />
        ))}
      </div>
    </>
  )
}

interface CategoryBestSectionProps {
  initialProducts: ProductCardProps[] | undefined
  regionId?: string
}

export function CategoryBestSection({
  initialProducts,
  regionId,
}: CategoryBestSectionProps) {
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const [isPending, startTransition] = useTransition()
  const { user } = useUser()
  const isLoggedIn = !!user

  // 고정된 카테고리 사용
  const bestCategories = FIXED_CATEGORIES
  const [products, setProducts] = useState<ProductCardProps[]>(
    initialProducts || []
  )
  const didInitialFetchRef = useRef(false)

  const { activeTab, setActiveTab, visitedTabs, markAsVisited } =
    useCategoryTabs(bestCategories[0]?.id || "")

  const chunkedProducts = useMemo(() => chunk(products, 6) || [], [products])

  useEffect(() => {
    if (!didInitialFetchRef.current) {
      didInitialFetchRef.current = true
      if (initialProducts && initialProducts.length > 0) {
        return
      }
    }

    startTransition(async () => {
      const nextProducts = await getCategoryBestProducts(activeTab, regionId)

      setProducts(nextProducts)
    })
  }, [activeTab, regionId])

  const { props: dragHandlers } = useDraggableScroll()
  const isVisitedTab = visitedTabs.has(activeTab)
  const showSkeleton = isPending && !visitedTabs.has(activeTab)

  // 현재 활성화된 카테고리 정보 찾기 (더보기 링크용)
  const activeCategory = bestCategories.find((cat) => cat.id === activeTab)

  return (
    <div className="w-full">
      <SectionHeader className="justify-between md:justify-center!">
        <SectionHeader.Title>
          카테고리 <span className="text-yellow-30">베스트</span>
        </SectionHeader.Title>
        <SectionHeader.More
          href={`/${countryCode}/category/${
            activeCategory?.handle || activeTab
          }`}
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
                {showSkeleton ? (
                  <CategoryBestSkeletonGrid />
                ) : products.length === 0 ? (
                  <>
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
                  </>
                ) : (
                  <>
                    {/* mobile layout */}
                    <div className="md:hidden">
                      <ProductCarousel
                        className="md:hidden"
                        opts={{ align: "start" }}
                      >
                        <ProductCarousel.List className="-ml-3">
                          {chunkedProducts.map((group, groupIndex) => (
                            <ProductCarousel.Item
                              key={groupIndex}
                              className="basis-[92%] pl-3"
                            >
                              <div className="grid grid-cols-3 gap-x-3 gap-y-8">
                                {group.map((product, itemIndex) => {
                                  const rank = groupIndex * 6 + itemIndex + 1
                                  const isSoldOut =
                                    product.manageInventory &&
                                    product.available <= 0
                                  return (
                                    <Link
                                      key={product.id}
                                      href={`/${countryCode}/products/${product.handle}`}
                                      className="block"
                                    >
                                      <ProductCard>
                                        <ProductCard.Thumbnail
                                          className="drop-shadow-[0_2px_2px_rgba(0,0,0,0.1)]"
                                          src={product.imageSrc}
                                          alt={product.title}
                                          isSoldOut={isSoldOut}
                                          rank={
                                            <ProductCard.Rank rank={rank} />
                                          }
                                          action={
                                            !isSoldOut ? (
                                              <ProductCard.QuickActions
                                                productId={product.id}
                                                productHandle={product.handle}
                                                variantId={
                                                  product.optionMeta
                                                    ?.defaultVariantId
                                                }
                                                isSingleOption={
                                                  product.optionMeta
                                                    ?.isSingle ?? false
                                                }
                                                isLoggedIn={isLoggedIn}
                                                countryCode={countryCode}
                                              />
                                            ) : undefined
                                          }
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
                        showQuickActions
                        thumbnailClassName="drop-shadow-[0_2px_2px_rgba(0,0,0,0.1)]"
                        countryCode={countryCode}
                        isLoggedIn={isLoggedIn}
                      />
                    </div>
                  </>
                )}
              </TabsContent>
            </motion.div>
          </AnimatePresence>
        </Tabs>
      </div>
    </div>
  )
}
