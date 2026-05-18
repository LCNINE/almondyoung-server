import { Suspense } from "react"
import { getTranslations } from "next-intl/server"
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
  const t = await getTranslations("mypage.reviews")
  return (
    <main className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>{t("pageTitle")}</PageTitle>
      <ReviewsTabs
        writableContent={
          <ErrorBoundary
            fallback={
              <p className="py-10 text-center text-sm text-gray-500">
                {t("loadError")}
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
                {t("loadError")}
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
