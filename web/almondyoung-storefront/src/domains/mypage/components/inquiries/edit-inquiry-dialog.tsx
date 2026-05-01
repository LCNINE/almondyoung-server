"use client"

import { useEffect, useState, useTransition } from "react"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { updateQuestion } from "@/lib/api/ugc/qna"
import type { Question } from "@/lib/types/ui/ugc"
import { toast } from "sonner"

const MAX_LENGTH = 250

interface EditInquiryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  question: Question | null
  onSuccess?: () => void
}

export function EditInquiryDialog({
  open,
  onOpenChange,
  question,
  onSuccess,
}: EditInquiryDialogProps) {
  const [content, setContent] = useState("")
  const [isSecret, setIsSecret] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open && question) {
      setContent(question.content)
      setIsSecret(question.isSecret)
    }
  }, [open, question])

  const handleSubmit = () => {
    if (!content.trim() || isPending || !question) return

    startTransition(async () => {
      try {
        await updateQuestion(question.id, {
          title: content.slice(0, 50),
          content,
          isSecret,
        })
        toast.success("문의가 수정되었습니다.")
        onOpenChange(false)
        onSuccess?.()
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error("문의 수정에 실패했습니다. 다시 시도해주세요.")
      }
    })
  }

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setContent("")
      setIsSecret(true)
    }
    onOpenChange(value)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-6 sm:max-w-[480px]">
        <DialogHeader className="mb-5">
          <DialogTitle className="text-lg font-bold">문의 수정하기</DialogTitle>
        </DialogHeader>

        {/* 문의 입력 */}
        <div className="relative mb-4">
          <Textarea
            placeholder="문의 내용을 입력해 주세요"
            value={content}
            onChange={(e) => {
              if (e.target.value.length <= MAX_LENGTH) {
                setContent(e.target.value)
              }
            }}
            className="min-h-[180px] resize-none rounded-lg border-gray-200 text-[14px] placeholder:text-gray-400"
            disabled={isPending}
          />
          <span className="absolute right-3 bottom-3 text-xs text-gray-400">
            {content.length}
            <span className="mx-0.5">|</span>
            {MAX_LENGTH}
          </span>
        </div>

        {/* 비밀글 체크박스 */}
        <label className="mb-6 flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={isSecret}
            onCheckedChange={(checked) => setIsSecret(checked === true)}
            disabled={isPending}
          />
          <Lock className="h-4 w-4 text-gray-500" />
          <span className="text-[14px] text-gray-700">비밀글로 문의하기</span>
        </label>

        {/* 수정 버튼 */}
        <Button
          className="h-[52px] w-full rounded-lg text-[16px] font-medium"
          disabled={!content.trim() || isPending}
          onClick={handleSubmit}
        >
          {isPending ? "수정 중..." : "수정하기"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
