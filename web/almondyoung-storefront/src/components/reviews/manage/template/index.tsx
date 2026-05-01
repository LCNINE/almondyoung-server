import { Suspense } from "react"
import { PageTitle } from "@/components/shared/page-title"
import { MypageReviewsSkeleton } from "@/components/skeletons/page-skeletons"
import { ReviewsTabs } from "../components/reviews-tabs"
import { WritableReviewsWrapper } from "./writable-reviews-wrapper"
import { WrittenReviewsWrapper } from "./written-reviews-wrapper"
import { ErrorBoundary } from "@/components/shared/error-boundary"

type Props = {
  params: { countryCode: string }
  searchParams: { period?: string; type?: string; page?: string }
}

export const ReviewsTemplate = async ({ params, searchParams }: Props) => {
  return (
    <main className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>리뷰</PageTitle>
      <ReviewsTabs
        writableContent={
          <ErrorBoundary
            fallback={
              <p className="py-10 text-center text-sm text-gray-500">
                리뷰를 불러오는 중 오류가 발생했습니다.
              </p>
            }
          >
            <Suspense fallback={<MypageReviewsSkeleton />}>
              <WritableReviewsWrapper
                params={params}
                searchParams={searchParams}
              />
            </Suspense>
          </ErrorBoundary>
        }
        writtenContent={
          <ErrorBoundary
            fallback={
              <p className="py-10 text-center text-sm text-gray-500">
                리뷰를 불러오는 중 오류가 발생했습니다.
              </p>
            }
          >
            <Suspense fallback={<MypageReviewsSkeleton />}>
              <WrittenReviewsWrapper
                params={params}
                searchParams={searchParams}
              />
            </Suspense>
          </ErrorBoundary>
        }
      />
    </main>
  )
}
