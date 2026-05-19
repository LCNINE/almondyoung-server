"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProductReviewSkeleton } from "@/components/skeletons/product-detail-skeletons"
import { getReviewsByProductId } from "@/lib/api/ugc"
import { ReviewSortOption } from "@/lib/types/common/filter"
import { ReviewDetail } from "@/lib/types/ui/ugc"
import { cn } from "@/lib/utils"
import { ImageIcon, MessageSquare } from "lucide-react"
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

const SORT_OPTIONS: { value: ReviewSortOption; labelKey: string }[] = [
  { value: "latest",      labelKey: "sortLatest" },
  { value: "oldest",      labelKey: "sortOldest" },
  { value: "rating_high", labelKey: "sortRatingHigh" },
  { value: "rating_low",  labelKey: "sortRatingLow" },
]

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
  const [sortOption, setSortOption] = useState<ReviewSortOption>("latest")
  const [photoOnly, setPhotoOnly] = useState(false)

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const fetchReviews = useCallback(
    async (page: number, sort: ReviewSortOption, photo: boolean) => {
      setIsLoading(true)
      try {
        const result = await getReviewsByProductId({
          productId,
          sort,
          type: photo ? "photo" : "all",
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
    fetchReviews(page, sortOption, photoOnly)
    document
      .getElementById("review")
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const handleSortChange = (next: ReviewSortOption) => {
    setSortOption(next)
    setCurrentPage(1)
    fetchReviews(1, next, photoOnly)
  }

  const handlePhotoOnlyChange = (checked: boolean) => {
    setPhotoOnly(checked)
    setCurrentPage(1)
    fetchReviews(1, sortOption, checked)
  }

  return (
    <section className="space-y-6">
      <ReviewSummary
        totalReviews={totalReviews}
        averageRating={averageRating}
        summaryTags={[]}
      />

      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="photo-only"
              checked={photoOnly}
              onCheckedChange={handlePhotoOnlyChange}
            />
            <label
              htmlFor="photo-only"
              className={cn(
                "cursor-pointer select-none text-sm transition-colors",
                photoOnly ? "font-medium text-primary" : "text-muted-foreground"
              )}
            >
              {t("filterPhotoOnly")}
            </label>
          </div>

          <Select
            value={sortOption}
            onValueChange={handleSortChange}
          >
            <SelectTrigger
              className="h-8 w-[120px] text-sm text-gray-600"
              aria-label={t("sortSelectAria")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(({ value, labelKey }) => (
                <SelectItem key={value} value={value}>
                  {t(labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <ProductReviewSkeleton />
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            {photoOnly ? (
              <ImageIcon className="h-10 w-10 opacity-25" />
            ) : (
              <MessageSquare className="h-10 w-10 opacity-25" />
            )}
            <p className="text-sm">
              {photoOnly ? t("emptyNoMatch") : t("emptyNoReviews")}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t.rich("totalCount", {
                count: total,
                strong: (chunks) => (
                  <span className="font-semibold text-foreground">{chunks}</span>
                ),
              })}
            </p>

            <ul className="divide-y divide-border">
              {reviews.map((review) => (
                <li key={review.id}>
                  <ReviewDetailCard countryCode={countryCode} review={review} />
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <SharedPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}
