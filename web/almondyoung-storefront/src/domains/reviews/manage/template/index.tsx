import { Suspense } from "react"
import { PageTitle } from "@/components/shared/page-title"
import { MypageReviewsSkeleton } from "@/components/skeletons/page-skeletons"
import { ReviewsTabs } from "../components/reviews-tabs"
import { WritableReviewsWrapper } from "./writable-reviews-wrapper"
import { WrittenReviewsWrapper } from "./written-reviews-wrapper"

export const ReviewsTemplate = async () => {
  return (
    <main className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>리뷰</PageTitle>
      <ReviewsTabs
        writableContent={
          <Suspense fallback={<MypageReviewsSkeleton />}>
            <WritableReviewsWrapper />
          </Suspense>
        }
        writtenContent={
          <Suspense fallback={<MypageReviewsSkeleton />}>
            <WrittenReviewsWrapper />
          </Suspense>
        }
      />
    </main>
  )
}
