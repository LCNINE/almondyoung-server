"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { ProductReviewSkeleton } from "@/components/skeletons/product-detail-skeletons"
import { getReviewsByProductId } from "@/lib/api/ugc"
import { ReviewRatingFilter, ReviewSortOption } from "@/lib/types/common/filter"
import { ReviewDetail } from "@/lib/types/ui/ugc"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { ReviewSummary } from "../summary/review-summary"
import { ReviewDetailCard } from "./review-detail-card"

type Props = {
  countryCode: string
  productId: string
  totalReviews: number
  averageRating: number
  initialReviews: ReviewDetail[]
}

const ITEMS_PER_PAGE = 10

export function ReviewDetailCardList({
  countryCode,
  productId,
  totalReviews,
  averageRating,
  initialReviews,
}: Props) {
  const t = useTranslations("productDetail.review")
  const [reviews, setReviews] = useState<ReviewDetail[]>(initialReviews)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(totalReviews)
  const [selectedFilter, setSelectedFilter] = useState<
    ReviewRatingFilter | "all"
  >("all")
  const [sortOption, setSortOption] = useState<ReviewSortOption>("latest")

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const fetchReviews = useCallback(
    async (
      page: number,
      sort: ReviewSortOption,
      filter: ReviewRatingFilter | "all"
    ) => {
      setIsLoading(true)
      try {
        const result = await getReviewsByProductId({
          productId,
          rating: filter === "all" ? undefined : filter,
          sort,
          page,
          limit: ITEMS_PER_PAGE,
        })

        const activeReviews = (result.data ?? []).filter(
          (review) => review.status === "active"
        )
        setReviews(activeReviews)
        setTotal(result.total ?? 0)
      } catch (error) {
        console.error(t("loadFail"), error)
        setReviews([])
      } finally {
        setIsLoading(false)
      }
    },
    [productId, t]
  )

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    fetchReviews(page, sortOption, selectedFilter)
    document
      .getElementById("review")
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const handleSortToggle = () => {
    const next: ReviewSortOption = sortOption === "latest" ? "oldest" : "latest"
    setSortOption(next)
    setCurrentPage(1)
    fetchReviews(1, next, selectedFilter)
  }

  return (
    <section className="space-y-6">
      <ReviewSummary
        totalReviews={totalReviews}
        averageRating={averageRating}
        summaryTags={[]}
      />

      {/* 리뷰 목록 */}
      {isLoading ? (
        <ProductReviewSkeleton />
      ) : reviews.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          {selectedFilter === "all"
            ? t("emptyNoReviews")
            : t("emptyNoMatch")}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {t.rich("totalCount", {
                count: total,
                strong: (chunks) => <span className="font-semibold">{chunks}</span>,
              })}
            </p>
            <button
              type="button"
              onClick={handleSortToggle}
              className="flex cursor-pointer items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
              aria-label={t("sortAria", {
                label: sortOption === "latest" ? t("sortLatest") : t("sortOldest"),
              })}
            >
              {sortOption === "latest" ? t("sortLatest") : t("sortOldest")}
              {sortOption === "latest" ? (
                <ArrowDown className="h-4 w-4" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>

          <ul className="divide-y divide-gray-200">
            {reviews.map((review) => (
              <li key={review.id}>
                <ReviewDetailCard countryCode={countryCode} review={review} />
              </li>
            ))}
          </ul>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <SharedPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </div>
      )}
    </section>
  )
}
