"use client"

import { useUser } from "contexts/user-context"
import HeroBannerSlider from "../components/banner/heroBannerSlider"
import { HomeLoggedIn } from "../home-loggedin"
import { HomeLogout } from "../home-logout"
import type { CategoryTreeNode } from "@lib/api/pim/pim-types"
import type { ProductCard } from "@lib/types/ui/product"

interface HomeTemplateProps {
  countryCode: string
  categories: CategoryTreeNode[]
  initialCategoryId: string | null
  initialCategoryProducts: ProductCard[]
}

export default function HomeTemplate({
  countryCode,
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
