"use client"

import { ProductCard } from "@/components/products/prodcut-card"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useCategoryTabs } from "@/domains/home/hooks/use-category-tabs"
import { useDraggableScroll } from "@/hooks/ui/use-draggable-scroll"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { AnimatePresence, motion } from "framer-motion"
import { ProductGrid } from "../../../../../components/products/product-grid"
import { SectionHeader } from "../../header/section-header"
import { ProductCarousel } from "../../shared/product-carousel"
import { CategoryTabs } from "../category-best/category-tabs"
import type { ProductCardProps } from "@/lib/types/ui/product"
import { getTimeSaleProducts } from "../../actions/get-category-products"
import { useEffect, useState, useTransition } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { useUser } from "@/contexts/user-context"

interface TimeSaleSectionProps {
  initialCategories: StoreProductCategoryTree[]
  initialProducts: ProductCardProps[]
  regionId?: string
}

export function TimeSaleSection({
  initialCategories,
  initialProducts,
  regionId,
}: TimeSaleSectionProps) {
  const bestCategories = initialCategories.slice(0, 7)
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"
  const { user } = useUser()
  const isLoggedIn = !!user

  const [products, setProducts] = useState<ProductCardProps[]>(
    initialProducts || []
  )
  const [, startTransition] = useTransition()

  const { activeTab, setActiveTab, visitedTabs, markAsVisited } =
    useCategoryTabs(bestCategories[0]?.id || "")

  const { props: dragHandlers } = useDraggableScroll()
  const activeCategoryId = activeTab

  useEffect(() => {
    if (!activeCategoryId) {
      setProducts([])
      return
    }

    startTransition(async () => {
      const nextProducts = await getTimeSaleProducts(activeCategoryId, regionId)
      setProducts(nextProducts)
    })
  }, [activeCategoryId, regionId])

  const isVisitedTab = visitedTabs.has(activeTab)

  return (
    <div className="w-full">
      <SectionHeader className="justify-between md:justify-center!">
        <SectionHeader.Title>
          <span className="md:text-red-30 text-black">타임</span> 세일
        </SectionHeader.Title>
        <SectionHeader.More href={`/${countryCode}/category/time-sale`} />
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
                          <Link
                            href={`/${countryCode}/products/${product.id}`}
                            className="block"
                          >
                            <ProductCard className="border-r-[0.5px] border-r-gray-100 pr-4 last:border-r-0">
                              <ProductCard.Thumbnail
                                src={product.imageSrc}
                                alt={product.title}
                                action={
                                  <ProductCard.QuickActions
                                    productId={product.id}
                                    variantId={
                                      product.optionMeta?.defaultVariantId
                                    }
                                    isSingleOption={
                                      product.optionMeta?.isSingle ?? false
                                    }
                                    isLoggedIn={isLoggedIn}
                                    countryCode={countryCode}
                                  />
                                }
                                className="rounded-sm md:rounded-md"
                              />
                              <ProductCard.Info {...product} />
                            </ProductCard>
                          </Link>
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
                    showQuickActions
                    thumbnailClassName="rounded-sm md:rounded-md"
                    countryCode={countryCode}
                    isLoggedIn={isLoggedIn}
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
