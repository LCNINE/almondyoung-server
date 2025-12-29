"use client"

import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import type { ProductCard } from "@lib/types/ui/product"
import HeroBannerSlider from "../components/banner/heroBannerSlider"
import { HomeLogout } from "../home-logout"

interface HomeTemplateProps {
  categories: CategoryTreeNodeDto[]
  initialCategoryId: string | null
  initialCategoryProducts: ProductCard[]
}

export default function HomeTemplate({
  categories,
  initialCategoryId,
  initialCategoryProducts,
}: HomeTemplateProps) {
  // const { user } = useUser()

  return (
    <>
      <HeroBannerSlider slides={[]} />

      <HomeLogout
        categories={categories}
        initialCategoryId={initialCategoryId}
        initialCategoryProducts={initialCategoryProducts}
      />
    </>
  )
}
