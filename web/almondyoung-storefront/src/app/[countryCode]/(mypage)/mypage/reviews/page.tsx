import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import { ReviewsContainer } from "domains/reviews/manage/components/reviews-container"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "리뷰",
  description: "내 리뷰를 확인하고 관리하세요",
}

export default function MyReviewsPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "리뷰 목록",
      }}
    >
      <MypageLayout>
        <ReviewsContainer />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
