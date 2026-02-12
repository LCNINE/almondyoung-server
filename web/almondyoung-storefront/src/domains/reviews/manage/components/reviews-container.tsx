"use client"

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@components/common/ui/tabs"
import { PageTitle } from "@/components/shared/page-title"
import { MypageReviewsSkeleton } from "@/components/skeletons/page-skeletons"
import { useReviewActions } from "../hooks/use-review-actions"
import { WritableReviewsSection } from "./writable-reviews-section"
import { WrittenReviewsSection } from "./written-reviews-section"
import { REVIEW_TAB_VALUES } from "../utils/constants"
import type { WritableReview, WrittenReview } from "../types"
import { useEffect, useState } from "react"
import { getOrders } from "@lib/api/medusa/orders"

/**
 * 리뷰 관리 컨테이너 컴포넌트
 * 작성 가능/작성 완료 리뷰를 탭으로 구분하여 표시
 */
export const ReviewsContainer = () => {
  const [writableReviews, setWritableReviews] = useState<WritableReview[]>([])
  const [writtenReviews, setWrittenReviews] = useState<WrittenReview[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const {
    editingReviewId,
    isReviewBeingEdited,
    handleCreateReview,
    handleUpdateReview,
    handleDeleteReview,
    startEditing,
    cancelEditing,
  } = useReviewActions()

  useEffect(() => {
    const fetchReviewableOrders = async () => {
      try {
        const ordersData = await getOrders({ limit: 50 })

        // 배송 완료된 주문에서 리뷰 작성 가능한 상품 추출
        const writable: WritableReview[] = []

        ordersData?.orders?.forEach((order) => {
          if (
            order.fulfillment_status === "fulfilled" ||
            order.fulfillment_status === "shipped"
          ) {
            order.items?.forEach((item, index) => {
              writable.push({
                id: `${order.id}-${index}`,
                orderId: order.id,
                productId: item.variant?.product_id || item.product_id || "",
                productName:
                  item.title || item.variant?.product?.title || "상품",
                productImage:
                  item.thumbnail ||
                  item.variant?.product?.thumbnail ||
                  "https://placehold.co/80x80",
                orderDate: new Date(order.created_at).toLocaleDateString(),
                variantTitle: item.variant?.title,
              })
            })
          }
        })

        setWritableReviews(writable)

        // TODO: 작성된 리뷰는 UGC 서비스에서 조회
        // 현재는 사용자별 리뷰 조회 API가 없으므로 빈 배열
        setWrittenReviews([])
      } catch (error) {
        console.error("리뷰 가능 주문 조회 실패:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchReviewableOrders()
  }, [])

  if (isLoading) {
    return <MypageReviewsSkeleton />
  }

  return (
    <main className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>리뷰</PageTitle>

      <Tabs defaultValue={REVIEW_TAB_VALUES.WRITABLE} className="w-ful4 mt-3">
        {/* 탭 헤더 */}
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-lg bg-transparent p-1">
          <TabsTrigger
            value={REVIEW_TAB_VALUES.WRITABLE}
            className="rounded-md px-4 py-2.5 text-[15px] font-bold transition-all focus-visible:ring-0 focus-visible:outline-none data-[state=active]:bg-[#f29219] data-[state=active]:text-[#FFFFFF] data-[state=active]:shadow-sm data-[state=inactive]:bg-[#FFFFFF] data-[state=inactive]:text-[#666666]"
          >
            작성 가능한 리뷰 ({writableReviews.length})
          </TabsTrigger>
          <TabsTrigger
            value={REVIEW_TAB_VALUES.WRITTEN}
            className="rounded-md px-4 py-2.5 text-[15px] font-bold transition-all focus-visible:ring-0 focus-visible:outline-none data-[state=active]:bg-[#f29219] data-[state=active]:text-[#FFFFFF] data-[state=active]:shadow-sm data-[state=inactive]:bg-[#FFFFFF] data-[state=inactive]:text-[#666666]"
          >
            내가 작성한 리뷰 ({writtenReviews.length})
          </TabsTrigger>
        </TabsList>

        {/* 작성 가능한 리뷰 탭 */}
        <TabsContent value={REVIEW_TAB_VALUES.WRITABLE} className="mt-4">
          <WritableReviewsSection
            reviews={writableReviews}
            editingReviewId={editingReviewId}
            isReviewBeingEdited={isReviewBeingEdited}
            onStartEditing={startEditing}
            onSave={handleCreateReview}
            onCancel={cancelEditing}
          />
        </TabsContent>

        {/* 작성된 리뷰 탭 */}
        <TabsContent value={REVIEW_TAB_VALUES.WRITTEN} className="mt-4">
          <WrittenReviewsSection
            reviews={writtenReviews}
            onUpdate={handleUpdateReview}
            onDelete={handleDeleteReview}
          />
        </TabsContent>
      </Tabs>
    </main>
  )
}
