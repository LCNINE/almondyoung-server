import { notFound } from "next/navigation"
import { CategoryPageClient } from "../components/category-page-client"
import { getCategoryTree } from "@lib/api/medusa/categories"
import { getProductList } from "@lib/api/medusa/products"
import { getRegion } from "@lib/api/medusa/regions"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"
import type { StoreProductCategoryTree } from "@lib/types/medusa-category"

interface CategoryPageContainerProps {
  params: Promise<{
    countryCode: string
    segments: string[]
  }>
}

export async function CategoryPageContainer({
  params,
}: CategoryPageContainerProps) {
  const { segments, countryCode } = await params
  const pathSegments = (segments || []).filter(Boolean)
  if (pathSegments.length === 0) {
    return notFound()
  }

  const region = await getRegion(countryCode)

  const allCategories = await getCategoryTree()
  const categoryPath = findCategoryPathBySegments(allCategories, pathSegments)
  const categoryData = categoryPath?.[categoryPath.length - 1] ?? null
  if (!categoryData || !categoryPath) {
    return notFound()
  }

  const categoryBanners = getCategoryBanners(categoryData)

  // 3. UI에 필요한 메타데이터 구성 (필요시 categoryData 기반으로 생성)
  const categoryInfo = {
    title: categoryData.name,
    description: categoryData.description ?? "",
    banners: categoryBanners.length > 0 ? categoryBanners : undefined,
  }

  // 4. 카테고리별 상품 목록 로드
  console.log(`🚀 [CategoryPageContainer] 상품 목록 로드 시작:`, {
    categoryId: categoryData.id,
    categoryName: categoryData.name,
    regionId: countryCode.toUpperCase(),
    regionName: region?.name,
  })

  let initialProducts: any[] = []
  let initialTotal = 0
  const categoryIds = collectCategoryIds(categoryData)

  try {
    const productsResult = await getProductList({
      page: 1,
      limit: 20,
      categoryId: categoryIds,
      region_id: region?.id,
      includeFullVariants: true,
    })
    initialProducts = mapStoreProductsToCardProps(productsResult.products)
    initialTotal = productsResult.count
  } catch (error) {
    console.error("❌ [CategoryPageContainer] 상품 목록 로드 실패:", error)
    // 에러 발생 시 빈 배열로 계속 진행
  }

  return (
    <CategoryPageClient
      pathSegments={pathSegments}
      categoryInfo={categoryInfo}
      categoryData={categoryData}
      initialProducts={initialProducts}
      initialTotal={initialTotal}
      countryCode={countryCode}
      categoryIds={categoryIds}
      regionId={region?.id}
      allCategories={allCategories}
      categoryPath={categoryPath}
    />
  )
}

const isCategorySegmentMatch = (
  category: StoreProductCategoryTree,
  segment: string
) => {
  return category.handle === segment || category.id === segment
}

const findCategoryPathBySegments = (
  roots: StoreProductCategoryTree[],
  segments: string[]
): StoreProductCategoryTree[] | null => {
  if (segments.length === 0) return null

  const path: StoreProductCategoryTree[] = []
  let level = roots

  for (const segment of segments) {
    const matched = level.find((category) =>
      isCategorySegmentMatch(category, segment)
    )
    if (!matched) {
      return null
    }

    path.push(matched)
    level = matched.category_children || []
  }

  return path
}

const getCategoryBanners = (category: StoreProductCategoryTree) => {
  const metadata = category.metadata as
    | { banner_images?: unknown; banners?: unknown }
    | null
    | undefined

  if (Array.isArray(metadata?.banners)) {
    const banners = metadata.banners
      .map((banner, index) => {
        if (!banner || typeof banner !== "object") {
          return null
        }

        const src =
          "src" in banner && typeof banner.src === "string"
            ? banner.src
            : null
        const alt =
          "alt" in banner && typeof banner.alt === "string"
            ? banner.alt
            : category.name

        if (!src) {
          return null
        }

        return { id: `banner-${index + 1}`, image: { src, alt } }
      })
      .filter((banner): banner is { id: string; image: { src: string; alt: string } } => Boolean(banner))

    if (banners.length > 0) {
      return banners
    }
  }

  if (Array.isArray(metadata?.banner_images)) {
    const banners = metadata.banner_images
      .map((src, index) => {
        if (typeof src !== "string") {
          return null
        }

        return {
          id: `banner-${index + 1}`,
          image: { src, alt: category.name },
        }
      })
      .filter((banner): banner is { id: string; image: { src: string; alt: string } } => Boolean(banner))

    if (banners.length > 0) {
      return banners
    }
  }

  return []
}

const collectCategoryIds = (category: StoreProductCategoryTree) => {
  const ids: string[] = []

  const walk = (node: StoreProductCategoryTree) => {
    ids.push(node.id)
    node.category_children?.forEach((child) => walk(child))
  }

  walk(category)

  return ids
}
