"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ProductQnaSkeleton } from "@/components/skeletons/product-detail-skeletons"
import { deleteQuestion, getQuestionsByProductId } from "@/lib/api/ugc/qna"
import type { Question } from "@/lib/types/ui/ugc"
import { useUser } from "@/contexts/user-context"
import { siteConfig } from "@/lib/config/site"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useState, useTransition } from "react"
import { toast } from "sonner"
import { QnaCard } from "./qna-card"
import { QnaInquiryDialog } from "./qna-inquiry-dialog"

type Props = {
  productId: string
  productName: string
  productThumbnail: string | null
  totalQuestions: number
  initialQuestions: Question[]
}

const ITEMS_PER_PAGE = 10

export function QnaList({
  productId,
  productName,
  productThumbnail,
  totalQuestions,
  initialQuestions,
}: Props) {
  const { user } = useUser()
  const router = useRouter()
  const { countryCode } = useParams()

  const [questions, setQuestions] =
    useState<Question[]>(initialQuestions)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(totalQuestions)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isInquiryOpen, setIsInquiryOpen] = useState(false)
  const [editQuestion, setEditQuestion] = useState<
    Question | undefined
  >(undefined)
  const [isDeleting, startDeleteTransition] = useTransition()

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const fetchQuestions = useCallback(
    async (page: number) => {
      setIsLoading(true)
      try {
        const result = await getQuestionsByProductId({
          productId,
          sort: "latest",
          page,
          limit: ITEMS_PER_PAGE,
        })
        const filtered = (result.data ?? []).filter(
          (q) => q.status === "active" || q.status === "answered"
        )
        setQuestions(filtered)
        setTotal(result.total ?? 0)
      } catch (error) {
        console.error("Q&A 로드 실패:", error)
        setQuestions([])
      } finally {
        setIsLoading(false)
      }
    },
    [productId]
  )

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
        toast.success("문의가 삭제되었습니다.")
        fetchQuestions(currentPage)
      } catch (error) {
        console.error("문의 삭제 실패:", error)
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("문의 삭제에 실패했습니다. 다시 시도해주세요.")
      }
    })
  }

  const handleInquiryOpenChange = (open: boolean) => {
    setIsInquiryOpen(open)
    if (!open) {
      setEditQuestion(undefined)
    }
  }

  return (
    <section className="space-y-0">
      {/* 상품 문의 / 배송·반품·교환 문의 버튼 */}
      <div className="flex gap-3 px-0 py-4">
        <Button
          variant="outline"
          className="h-[42px] flex-1 cursor-pointer rounded-lg text-[15px] font-medium"
          onClick={() => {
            if (!user) {
              const path = getPathWithoutCountry(countryCode as string)
              router.push(
                `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
              )
              return
            }
            setIsInquiryOpen(true)
          }}
        >
          상품 문의
        </Button>
        <Button
          variant="outline"
          className="h-[42px] flex-1 cursor-pointer rounded-lg text-[15px] font-medium"
        >
          배송·반품·교환 문의
        </Button>
      </div>

      {/* 안내 문구 */}
      <div className="py-3 text-center">
        <p className="text-sm text-gray-500">
          배송·반품·교환 문의와 답변은 1:1 문의에서 확인해 보세요{" "}
          <span className="text-gray-400">&gt;</span>
        </p>
      </div>

      {/* Q&A 목록 */}
      {isLoading ? (
        <ProductQnaSkeleton />
      ) : questions.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <p>아직 등록된 Q&A가 없습니다.</p>
          <p className="mt-2 text-sm">
            궁금한 점이 있으시면 언제든 문의해주세요!
          </p>
        </div>
      ) : (
        <div>
          <ul>
            {questions.map((question, index) => (
              <li key={question.id}>
                <QnaCard
                  question={question}
                  isExpanded={expandedId === question.id}
                  onToggle={() => handleToggle(question.id)}
                  isAuthor={user?.id === question.userId}
                  isDeleting={isDeleting}
                  onEdit={() => handleEdit(question)}
                  onDelete={() => handleDelete(question.id)}
                />
                {index < questions.length - 1 && <Separator />}
              </li>
            ))}
          </ul>

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
