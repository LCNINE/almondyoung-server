import { useState } from "react"

import type { ReviewInfo } from "../types"

/**
 * 리뷰 관련 액션을 관리하는 Hook
 * 단일 책임: 리뷰 CRUD 작업만 담당
 */
export function useReviewActions() {
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)

  /** 리뷰 작성 중인지 확인하는 조건 */
  const isReviewBeingEdited = (reviewId: string) => editingReviewId === reviewId

  /** 리뷰 '신규' 작성 핸들러 */
  const handleCreateReview = async (reviewId: string, data: ReviewInfo) => {
    console.log("신규 리뷰 저장 API 호출:", reviewId, data)

    // (예시) await fetchf('/api/my/reviews', { method: 'POST', body: ... });

    // 성공 시 폼 닫기
    setEditingReviewId(null)
    // (실제 앱에서는 SWR/TanStack Query의 mutate를 호출하여
    //  '작성 가능한 리뷰' 목록에서 이 항목을 제거하고
    //  '내가 작성한 리뷰' 목록을 갱신해야 합니다.)
  }

  /** 리뷰 '수정' 핸들러 */
  const handleUpdateReview = async (reviewId: string, data: ReviewInfo) => {
    console.log("기존 리뷰 수정 API 호출:", reviewId, data)
    // (예시) await fetchf(`/api/my/reviews/${reviewId}`, { method: 'PUT', ... });
  }

  /** 리뷰 '삭제' 핸들러 */
  const handleDeleteReview = async (reviewId: string) => {
    const shouldDelete = confirm("리뷰를 삭제하시겠습니까?")
    if (shouldDelete) {
      console.log("기존 리뷰 삭제 API 호출:", reviewId)
      // (예시) await fetchf(`/api/my/reviews/${reviewId}`, { method: 'DELETE' });
    }
  }

  /** 리뷰 작성 시작 */
  const startEditing = (reviewId: string) => {
    setEditingReviewId(reviewId)
  }

  /** 리뷰 작성 취소 */
  const cancelEditing = () => {
    setEditingReviewId(null)
  }

  return {
    editingReviewId,
    isReviewBeingEdited,
    handleCreateReview,
    handleUpdateReview,
    handleDeleteReview,
    startEditing,
    cancelEditing,
  }
}
