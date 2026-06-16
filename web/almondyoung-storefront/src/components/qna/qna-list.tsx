"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
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
    // productId 는 pimMasterId(= 문의에 저장되는 값). 상품명도 함께 넘겨
    // CS 페이지가 handle 로 재조회(매칭 실패 가능)하지 않도록 한다.
    const params = new URLSearchParams({ tab: "inquiry", productId })
    if (productName) params.set("productName", productName)
    router.push(`/${countryCode}/cs?${params.toString()}`)
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
    <section>
      <Separator className="mb-6" />

      <h4 className="mb-2 text-base font-bold">{t("title")}</h4>

      <p className="text-sm leading-relaxed text-gray-500">
        {t("intro")}{" "}
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

      {/* 툴바 */}
      <div className="mt-4 flex flex-col gap-0 md:flex-row md:items-center md:gap-4">
        {/* Q&A 작성 버튼 */}
        <Button
          variant="default"
          className="w-full cursor-pointer rounded-sm bg-[rgb(51,51,51)] text-sm text-white hover:bg-[rgb(51,51,51)] md:w-auto md:shrink-0"
          onClick={handleWriteQnaClick}
        >
          {t("writeQna")}
        </Button>

        {/* 필터 영역 */}
        <div className="flex flex-col md:ml-auto md:flex-row md:items-center md:gap-5">
          {/* 내 Q&A만 보기 토글 */}
          <div className="flex items-center justify-between border-b border-gray-100 py-3 md:border-0 md:py-0 md:gap-2">
            <span className="text-sm text-gray-700">{t("viewMine")}</span>
            <Switch
              checked={mineOnly}
              onCheckedChange={() => handleMyQnaToggle()}
            />
          </div>

          {/* 비밀글 제외 + 답변 상태 */}
          <div className="flex items-center justify-between border-b border-gray-100 py-3 md:border-0 md:py-0 md:gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
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
                <SelectTrigger className="h-8 w-32 cursor-pointer rounded-sm text-sm">
                  <SelectValue placeholder={t("statusPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("statusAll")}</SelectItem>
                  <SelectItem value="answered">{t("statusAnswered")}</SelectItem>
                  <SelectItem value="unanswered">{t("statusUnanswered")}</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div aria-hidden className="border-input h-8 w-32 rounded-sm border bg-white" />
            )}
          </div>
        </div>
      </div>

      {/* Q&A 목록 — 첫 로드만 스켈레톤, 이후 필터/페이지 변경은 dim 처리로 시프트 방지 */}
      {!hasLoaded ? (
        <ProductQnaSkeleton />
      ) : (
        <div
          className={`transition-opacity duration-150 ${
            isLoading ? "pointer-events-none opacity-50" : "opacity-100"
          }`}
          aria-busy={isLoading}
        >
          {/* 데스크탑 헤더 (모바일에서는 QNA_ROW_COLS가 hidden md:grid라 자동 숨김) */}
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
