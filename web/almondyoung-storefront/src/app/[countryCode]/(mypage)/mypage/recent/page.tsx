"use client"
import { useEffect, useState, useCallback } from "react"
import { ProductRowCard } from "@components/product-row-card/product-row-card"
import { PageTitle } from "@components/common/page-title"
import MypageLayout from "@components/layout/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { useUser } from "contexts/user-context"
import {
  getRecentViewsWithProducts,
  RecentViewItemWithProduct,
} from "@lib/services/users/recent-views-with-products"
import { removeFromRecentViewsService } from "@lib/services/users/recent-views"

export default function RecentPage() {
  const { user } = useUser()
  const [items, setItems] = useState<RecentViewItemWithProduct[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // 최근 본 상품 목록 조회
  const fetchRecentViews = useCallback(async () => {
    if (!user?.id) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      const recentItems = await getRecentViewsWithProducts(20)
      setItems(recentItems)
    } catch (err) {
      console.error("최근 본 상품 조회 실패:", err)
      setError("최근 본 상품을 불러오는데 실패했습니다.")
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    fetchRecentViews()
  }, [fetchRecentViews])

  // 최근 본 상품 삭제
  const handleRemove = async (recentViewId: string) => {
    try {
      setRemovingId(recentViewId)
      await removeFromRecentViewsService(recentViewId)
      // 삭제 성공 시 목록에서 제거
      setItems((prev) => prev.filter((item) => item.id !== recentViewId))
    } catch (err) {
      console.error("최근 본 상품 삭제 실패:", err)
      alert("삭제에 실패했습니다. 다시 시도해주세요.")
    } finally {
      setRemovingId(null)
    }
  }

  // 장바구니 담기
  const handleAddToCart = (item: RecentViewItemWithProduct) => {
    console.log("장바구니에 추가:", item)
    // TODO: 장바구니 추가 기능 구현
  }

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "최근 본 상품",
      }}
    >
      <MypageLayout>
        <div className="bg-background w-full">
          <div className="bg-white md:px-6">
            <PageTitle>최근 본 상품</PageTitle>

            {/* 로딩 상태 */}
            {isLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="text-gray-500">로딩 중...</div>
              </div>
            )}

            {/* 에러 상태 */}
            {!isLoading && error && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="text-red-500">{error}</div>
                <button
                  onClick={fetchRecentViews}
                  className="mt-4 text-sm text-blue-500 underline"
                >
                  다시 시도
                </button>
              </div>
            )}

            {/* 로그인 필요 */}
            {!isLoading && !error && !user && (
              <div className="flex items-center justify-center py-20">
                <div className="text-gray-500">로그인이 필요합니다.</div>
              </div>
            )}

            {/* 빈 상태 */}
            {!isLoading && !error && user && items.length === 0 && (
              <div className="flex items-center justify-center py-20">
                <div className="text-gray-500">최근 본 상품이 없습니다.</div>
              </div>
            )}

            {/* 상품 목록 */}
            {!isLoading &&
              !error &&
              items.map((item) => (
                <ProductRowCard
                  key={item.id}
                  item={item}
                  onRemove={handleRemove}
                  onAddToCart={handleAddToCart}
                  isLoading={removingId === item.id}
                />
              ))}
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
