"use client"

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@components/common/ui/tabs"
import { PageTitle } from "@components/common/page-title"
import { useReviewActions } from "../hooks/use-review-actions"
import { WritableReviewsSection } from "./writable-reviews-section"
import { WrittenReviewsSection } from "./written-reviews-section"
import { writableReviewsData, writtenReviewsData } from "../utils/mock-data"
import { REVIEW_TAB_VALUES } from "../utils/constants"

/**
 * 리뷰 관리 컨테이너 컴포넌트
 * 작성 가능/작성 완료 리뷰를 탭으로 구분하여 표시
 */
export const ReviewsContainer = () => {
  const {
    editingReviewId,
    isReviewBeingEdited,
    handleCreateReview,
    handleUpdateReview,
    handleDeleteReview,
    startEditing,
    cancelEditing,
  } = useReviewActions()

  return (
    <main className="min-h-screen bg-white py-4 md:px-6">
      <PageTitle>리뷰</PageTitle>

      <Tabs defaultValue={REVIEW_TAB_VALUES.WRITABLE} className="w-ful4 mt-3">
        {/* 탭 헤더 */}
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-lg bg-transparent p-1">
          <TabsTrigger
            value={REVIEW_TAB_VALUES.WRITABLE}
            className="rounded-md px-4 py-2.5 text-[15px] font-bold transition-all focus-visible:ring-0 focus-visible:outline-none data-[state=active]:bg-[#f29219] data-[state=active]:text-[#FFFFFF] data-[state=active]:shadow-sm data-[state=inactive]:bg-[#FFFFFF] data-[state=inactive]:text-[#666666]"
          >
            작성 가능한 리뷰
          </TabsTrigger>
          <TabsTrigger
            value={REVIEW_TAB_VALUES.WRITTEN}
            className="rounded-md px-4 py-2.5 text-[15px] font-bold transition-all focus-visible:ring-0 focus-visible:outline-none data-[state=active]:bg-[#f29219] data-[state=active]:text-[#FFFFFF] data-[state=active]:shadow-sm data-[state=inactive]:bg-[#FFFFFF] data-[state=inactive]:text-[#666666]"
          >
            내가 작성한 리뷰
          </TabsTrigger>
        </TabsList>

        {/* 작성 가능한 리뷰 탭 */}
        <TabsContent value={REVIEW_TAB_VALUES.WRITABLE} className="mt-4">
          <WritableReviewsSection
            reviews={writableReviewsData}
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
            reviews={writtenReviewsData}
            onUpdate={handleUpdateReview}
            onDelete={handleDeleteReview}
          />
        </TabsContent>
      </Tabs>
    </main>
  )
}
