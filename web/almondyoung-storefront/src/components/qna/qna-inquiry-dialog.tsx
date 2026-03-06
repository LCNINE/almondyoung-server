"use client"

import { useEffect, useState, useTransition } from "react"
import Image from "next/image"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useUser } from "@/contexts/user-context"
import { createQuestion, updateQuestion } from "@/lib/api/ugc/qna"
import type { Question } from "@/lib/types/ui/ugc"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Link from "next/link"
import { toast } from "sonner"

const MAX_LENGTH = 250

interface QnaInquiryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string
  productName: string
  productThumbnail: string | null
  onSuccess?: () => void
  editQuestion?: Question
}

export function QnaInquiryDialog({
  open,
  onOpenChange,
  productId,
  productName,
  productThumbnail,
  onSuccess,
  editQuestion,
}: QnaInquiryDialogProps) {
  const { user } = useUser()
  const isEditMode = !!editQuestion

  const [content, setContent] = useState("")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open && editQuestion) {
      setContent(editQuestion.content)
    }
  }, [open, editQuestion])

  const handleSubmit = () => {
    if (!content.trim() || isPending) return

    startTransition(async () => {
      try {
        if (isEditMode) {
          await updateQuestion(editQuestion.id, {
            title: content.slice(0, 50),
            content,
          })
        } else {
          await createQuestion({
            productId,
            nickname: user?.nickname ?? "",
            title: content.slice(0, 50),
            content,
          })
        }
        setContent("")
        onOpenChange(false)
        onSuccess?.()
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }

        const message =
          error instanceof Error
            ? error.message
            : "알 수 없는 오류가 발생했습니다."

        const fallbackMessage = isEditMode
          ? "문의 수정에 실패했습니다. 다시 시도해주세요."
          : "문의 등록에 실패했습니다. 다시 시도해주세요."

        toast.error(message?.trim() ? message : fallbackMessage)
      }
    })
  }

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setContent("")
    }
    onOpenChange(value)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-6 sm:max-w-[480px]">
        <DialogHeader className="mb-5">
          <DialogTitle className="text-lg font-bold">
            {isEditMode ? "문의 수정하기" : "상품 문의하기"}
          </DialogTitle>
        </DialogHeader>

        {/* 상품 정보 */}
        <div className="mb-4 flex items-center gap-3">
          {productThumbnail && (
            <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border border-gray-100">
              <Image
                src={getThumbnailUrl(productThumbnail)}
                alt={productName}
                fill
                className="object-cover"
              />
            </div>
          )}
          <p className="text-[14px] leading-snug font-medium text-gray-900">
            {productName}
          </p>
        </div>

        {/* 1:1 문의 안내 배너 */}
        <Button
          variant="link"
          className="mb-4 flex w-full items-center justify-between rounded-lg px-4 py-3"
          asChild
        >
          {/* todo: 1:1 문의 링크 추가 */}
          <Link href={`#`}>
            <span className="text-[13px] text-gray-600">
              배송·반품·교환 문의는 1:1 문의로 남겨주세요.
            </span>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </Link>
        </Button>

        {/* 문의 입력 */}
        <div className="relative mb-4">
          <Textarea
            placeholder={
              "성분, 사용법, 구성 등 상품에 대해\n문의할 내용을 입력해 주세요"
            }
            value={content}
            onChange={(e) => {
              if (e.target.value.length <= MAX_LENGTH) {
                setContent(e.target.value)
              }
            }}
            className="min-h-[180px] resize-none rounded-lg border-gray-200 text-[14px] placeholder:text-gray-400"
          />
          <span className="absolute right-3 bottom-3 text-xs text-gray-400">
            {content.length}
            <span className="mx-0.5">|</span>
            {MAX_LENGTH}
          </span>
        </div>

        {/* 안내 문구 */}
        <ul className="mb-6 text-[12px] leading-relaxed text-gray-500">
          <li className="flex gap-1">
            <span className="shrink-0">•</span>
            <span>
              문의하신 내용에 대한 답변은 마이페이지 &gt; 상품 Q&A에서도 확인할
              수 있습니다.
            </span>
          </li>
          <li className="flex gap-1">
            <span className="shrink-0">•</span>
            <span>
              재판매글, 상업성 홍보글, 미풍양속을 해치는 글 등 상품 Q&A의 취지에
              맞지 않은 글은 삭제될 수 있습니다.
            </span>
          </li>
        </ul>

        {/* 등록 버튼 */}
        <Button
          className="h-[52px] w-full rounded-lg text-[16px] font-medium"
          disabled={!content.trim() || isPending}
          onClick={handleSubmit}
        >
          {isPending
            ? isEditMode
              ? "수정 중..."
              : "등록 중..."
            : isEditMode
              ? "수정하기"
              : "등록하기"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
