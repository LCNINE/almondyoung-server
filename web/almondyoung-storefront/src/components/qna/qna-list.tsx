"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProductQnaSkeleton } from "@/components/skeletons/product-detail-skeletons"
import { deleteQuestion, getQuestionsByProductId } from "@/lib/api/ugc/qna"
import type { Question } from "@/lib/types/ui/ugc"
import type { QnaAnswerStatusFilter } from "@/lib/types/common/filter"
import { useUser } from "@/contexts/user-context"
import { siteConfig } from "@/lib/config/site"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { QnaInquiryDialog } from "./qna-inquiry-dialog"
import { QNA_ROW_COLS, QnaRow } from "./qna-row"
import { Separator } from "../ui/separator"

type Props = {
  productId: string
  productName: string
  productThumbnail: string | null
}

type AnswerStatusSelectValue = "all" | QnaAnswerStatusFilter

const ITEMS_PER_PAGE = 10

export function QnaList({ productId, productName, productThumbnail }: Props) {
  const { user } = useUser()
  const router = useRouter()
  const { countryCode } = useParams()
  const t = useTranslations("productDetail.qna")

  const [questions, setQuestions] = useState<Question[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isInquiryOpen, setIsInquiryOpen] = useState(false)
  const [editQuestion, setEditQuestion] = useState<Question | undefined>(
    undefined
  )
  const [isDeleting, startDeleteTransition] = useTransition()

  const [excludeSecret, setExcludeSecret] = useState(false)
  const [mineOnly, setMineOnly] = useState(false)
  const [statusFilter, setStatusFilter] =
    useState<AnswerStatusSelectValue>("all")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const fetchQuestions = useCallback(
    async (page: number) => {
      setIsLoading(true)
      try {
        const result = await getQuestionsByProductId({
          productId,
          sort: "latest",
          answerStatus: statusFilter === "all" ? undefined : statusFilter,
          excludeSecret: excludeSecret || undefined,
          mineOnly: mineOnly || undefined,
          page,
          limit: ITEMS_PER_PAGE,
        })
        const filtered = (result.data ?? []).filter(
          (q) => q.status === "active" || q.status === "answered"
        )
        setQuestions(filtered)
        setTotal(result.total ?? 0)
      } catch (error) {
        console.error(t("loadFail"), error)
        setQuestions([])
        setTotal(0)
      } finally {
        setIsLoading(false)
        setHasLoaded(true)
      }
    },
    [productId, statusFilter, excludeSecret, mineOnly, t]
  )

  // 필터 변경 시 1페이지로 리셋 후 재조회
  useEffect(() => {
    setCurrentPage(1)
    setExpandedId(null)
    fetchQuestions(1)
  }, [fetchQuestions])

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    setExpandedId(null)
    fetchQuestions(page)
  }

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const handleEdit = (question: Question) => {
    setEditQuestion(question)
    setIsInquiryOpen(true)
  }

  const handleDelete = (questionId: string) => {
    startDeleteTransition(async () => {
      try {
        await deleteQuestion(questionId)
        toast.success(t("deleteSuccess"))
        fetchQuestions(currentPage)
      } catch (error) {
        console.error("delete question failed", error)
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("deleteFail"))
      }
    })
  }

  const handleInquiryOpenChange = (open: boolean) => {
    setIsInquiryOpen(open)
    if (!open) {
      setEditQuestion(undefined)
    }
  }

  const redirectToLogin = () => {
    const path = getPathWithoutCountry(countryCode as string)
    router.push(
      `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
    )
  }

  const handleCsInquiryClick = () => {
    if (!user) {
      redirectToLogin()
      return
    }
    router.push(`/${countryCode}/cs?tab=inquiry&productId=${productId}`)
  }

  const handleMyQnaToggle = () => {
    if (!user) {
      redirectToLogin()
      return
    }
    setMineOnly((prev) => !prev)
  }

  const handleWriteQnaClick = () => {
    if (!user) {
      redirectToLogin()
      return
    }
    setIsInquiryOpen(true)
  }

  return (
    <section className="space-y-0">
      <Separator className="mb-7" />

      <h4 className="font-bold">{t("title")}</h4>

      <p className="text-gray-500">
        {t("intro")}
        <br />
        {t("csLinkPrefix")}
        <button
          type="button"
          onClick={handleCsInquiryClick}
          className="ml-1 cursor-pointer font-medium text-gray-700 underline underline-offset-2"
        >
          {t("csLink")}
        </button>
        {t("csLinkSuffix")}
      </p>

      {/* 툴바: 좌측 액션 버튼 / 우측 필터 */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex gap-3">
          <Button
            variant="default"
            className="cursor-pointer rounded-none bg-[rgb(51,51,51)] text-white hover:bg-[rgb(51,51,51)]"
            onClick={handleWriteQnaClick}
          >
            {t("writeQna")}
          </Button>
          <Button
            variant={mineOnly ? "default" : "outline"}
            className={
              mineOnly
                ? "cursor-pointer rounded-none bg-[rgb(51,51,51)] text-white hover:bg-[rgb(51,51,51)]"
                : "cursor-pointer rounded-none"
            }
            onClick={handleMyQnaToggle}
          >
            {mineOnly ? t("viewAll") : t("viewMine")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={excludeSecret}
              onCheckedChange={(checked) => setExcludeSecret(checked === true)}
            />
            {t("excludeSecret")}
          </label>

          {mounted ? (
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as AnswerStatusSelectValue)
              }
            >
              <SelectTrigger className="h-9 w-[140px] cursor-pointer rounded-none">
                <SelectValue placeholder={t("statusPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("statusAll")}</SelectItem>
                <SelectItem value="answered">{t("statusAnswered")}</SelectItem>
                <SelectItem value="unanswered">{t("statusUnanswered")}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div
              aria-hidden
              className="border-input h-9 w-[140px] rounded-none border bg-white"
            />
          )}
        </div>
      </div>

      {/* Q&A 목록 — 첫 로드만 스켈레톤, 이후 필터/페이지 변경은 dim 처리로 시프트 방지 */}
      {!hasLoaded ? (
        <ProductQnaSkeleton />
      ) : (
        <div
          className={`border-t border-gray-300 transition-opacity duration-150 ${
            isLoading ? "pointer-events-none opacity-50" : "opacity-100"
          }`}
          aria-busy={isLoading}
        >
          {/* 헤더 */}
          <div
            className={`${QNA_ROW_COLS} border-b border-gray-200 text-sm font-medium text-gray-700`}
          >
            <span>{t("headerStatus")}</span>
            <span className="text-center">{t("headerTitle")}</span>
            <span className="text-right">{t("headerAuthor")}</span>
            <span className="text-right">{t("headerDate")}</span>
          </div>

          {questions.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <p>{t("empty")}</p>
            </div>
          ) : (
            <ul>
              {questions.map((question) => (
                <li key={question.id}>
                  <QnaRow
                    question={question}
                    isExpanded={expandedId === question.id}
                    onToggle={() => handleToggle(question.id)}
                    isAuthor={user?.id === question.userId}
                    isDeleting={isDeleting}
                    onEdit={() => handleEdit(question)}
                    onDelete={() => handleDelete(question.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="py-6">
              <SharedPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </div>
          )}
        </div>
      )}

      <QnaInquiryDialog
        open={isInquiryOpen}
        onOpenChange={handleInquiryOpenChange}
        productId={productId}
        productName={productName}
        productThumbnail={productThumbnail}
        editQuestion={editQuestion}
        onSuccess={() => fetchQuestions(currentPage)}
      />
    </section>
  )
}
