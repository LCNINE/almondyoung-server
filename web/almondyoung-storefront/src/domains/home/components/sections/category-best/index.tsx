"use client"

import { Tabs, TabsContent } from "@/components/ui/tabs"
import { CategoryTreeNodeDto } from "@lib/api/pim"
import { AnimatePresence, motion } from "framer-motion"
import testImg from "@assets/images/test.png"
import { useCategoryBest } from "../../../hooks/use-category-best"
import { SectionHeader } from "./section-header"
import { CategoryTabs } from "./category-tabs"
import { ProductCarousel } from "./product-carousel"
import { ProductGrid } from "./product-grid"

interface CategoryBestSectionProps {
  initialCategories: CategoryTreeNodeDto[]
}

export function CategoryBestSection({
  initialCategories,
}: CategoryBestSectionProps) {
  const bestCategories = initialCategories.slice(0, 7)

  const { activeTab, setActiveTab, carousel, dragHandlers } = useCategoryBest(
    bestCategories[0]?.name || ""
  )

  // TODO: 추후 실제 API 데이터로 교체
  const products = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

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

  return (
    <div className="w-full">
      <SectionHeader />

      <div className="mt-4 flex w-full flex-col gap-1.5">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <CategoryTabs
            categories={bestCategories}
            activeTab={activeTab}
            dragHandlers={dragHandlers}
          />

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="min-h-96"
            >
              <TabsContent value={activeTab} className="mt-6">
                <ProductCarousel
                  products={products}
                  carousel={carousel}
                  mockProductData={mockProductData}
                />

                <ProductGrid
                  products={products}
                  mockProductData={mockProductData}
                />
              </TabsContent>
            </motion.div>
          </AnimatePresence>
        </Tabs>
      </div>
    </div>
  )
}
