import { fetchMe } from "@lib/api/users/me"
import { ProductDetail } from "@lib/types/ui/product"
import { UserDetail } from "types/global"
import ProductDetailPage from "domains/products/product-details/product-detail-page"
import { Suspense } from "react"
import { getWishlist, type WishlistItem } from "@lib/api/users/wishlist/server"
import { getProductDetailService } from "@lib/services/pim/products/getProductDetailService"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; countryCode: string }>
}) {
  const { id, countryCode } = await params
  let product: ProductDetail | null = null
  let error: string | null = null
  const user: UserDetail | null = await fetchMe().catch(() => null)
  const wishlist: WishlistItem[] = await getWishlist()

  try {
    // 실제 PIM API를 통해 상품 상세 정보 조회
    product = await getProductDetailService(id, {
      userId: user?.id,
      withStock: true,
    })
  } catch (err) {
    console.error("상품 상세 정보 로드 실패:", err)
    error =
      err instanceof Error ? err.message : "상품 정보를 불러올 수 없습니다."
  }

  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      <Suspense fallback={<div className="p-8">로딩 중…</div>}>
        <ProductDetailPage
          params={Promise.resolve({ id, countryCode })}
          product={product}
          error={error}
          user={user}
        />
      </Suspense>
    </div>
  )
}
