"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { Separator } from "@/components/ui/separator"
import { deleteQuestion, getMyQuestions } from "@/lib/api/ugc/qna"
import type { Question } from "@/lib/types/ui/ugc"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useState, useTransition } from "react"
import { toast } from "sonner"
import { MyInquiryCard } from "./my-inquiry-card"
import { EditInquiryDialog } from "./edit-inquiry-dialog"

type Props = {
  initialQuestions: Question[]
  initialTotal: number
  initialPage: number
  limit: number
}

export function MyInquiriesList({
  initialQuestions,
  initialTotal,
  initialPage,
  limit,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [questions, setQuestions] = useState<Question[]>(initialQuestions)
  const [total, setTotal] = useState(initialTotal)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isDeleting, startDeleteTransition] = useTransition()
  const [isLoading, setIsLoading] = useState(false)
  const [editQuestion, setEditQuestion] = useState<Question | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)

  const totalPages = Math.ceil(total / limit)

  const fetchQuestions = useCallback(
    async (page: number) => {
      setIsLoading(true)
      try {
        const result = await getMyQuestions({
          sort: "latest",
          page,
          limit,
        })
        setQuestions(result.data ?? [])
        setTotal(result.total ?? 0)
      } catch (error) {
        console.error("문의 목록 로드 실패:", error)
        toast.error("문의 목록을 불러오는데 실패했습니다.")
      } finally {
        setIsLoading(false)
      }
    },
    [limit]
  )

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    setExpandedId(null)

    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    router.push(`?${params.toString()}`, { scroll: false })

    fetchQuestions(page)
  }

  const handleToggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const handleEdit = (question: Question) => {
    setEditQuestion(question)
    setIsEditOpen(true)
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

  if (questions.length === 0 && !isLoading) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-500">등록한 문의가 없습니다.</p>
        <p className="mt-2 text-sm text-gray-400">
          상품 상세 페이지에서 궁금한 점을 문의해보세요.
        </p>
      </div>
    )
  }

  return (
    <div className={isLoading ? "opacity-50" : ""}>
      <p className="mb-4 text-sm text-gray-500">
        총 <span className="font-medium text-gray-900">{total}</span>건
      </p>

      <ul>
        {questions.map((question, index) => (
          <li key={question.id}>
            <MyInquiryCard
              question={question}
              isExpanded={expandedId === question.id}
              onToggle={() => handleToggle(question.id)}
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

      <EditInquiryDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        question={editQuestion}
        onSuccess={() => fetchQuestions(currentPage)}
      />
    </div>
  )
}
