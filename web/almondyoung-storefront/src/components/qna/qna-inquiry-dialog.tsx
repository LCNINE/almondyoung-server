"use client"

import { useEffect, useState, useTransition } from "react"
import Image from "next/image"
import { ChevronRight, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

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
  const t = useTranslations("productDetail.qna.dialog")
  const isEditMode = !!editQuestion

  const [content, setContent] = useState("")
  const [isSecret, setIsSecret] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (open && editQuestion) {
      setContent(editQuestion.content)
      setIsSecret(editQuestion.isSecret)
    }
  }, [open, editQuestion])

  const isBusy = isPending

  const handleSubmit = () => {
    if (!content.trim() || isBusy) return

    startTransition(async () => {
      try {
        if (isEditMode) {
          await updateQuestion(editQuestion.id, {
            title: content.slice(0, 50),
            content,
            isSecret,
          })
        } else {
          await createQuestion({
            productId,
            nickname: user?.nickname ?? "",
            title: content.slice(0, 50),
            content,
            isSecret,
          })
        }
        setContent("")
        setIsSecret(true)
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
            : t("unknownError")

        const fallbackMessage = isEditMode
          ? t("editFail")
          : t("createFail")

        toast.error(message?.trim() ? message : fallbackMessage)
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
      <DialogContent className="z-9999 max-h-[90vh] gap-0 overflow-y-auto p-6 sm:max-w-[480px]">
        <DialogHeader className="mb-5">
          <DialogTitle className="text-lg font-bold">
            {isEditMode ? t("editTitle") : t("createTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* 상품 정보 */}
        <div className="flex items-center gap-3 mb-4">
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
          className="flex items-center justify-between w-full px-4 py-3 mb-4 rounded-lg"
          asChild
        >
          <LocalizedClientLink href={`/cs?tab=inquiry&productId=${productId}`}>
            <span className="text-[13px] text-gray-600">
              {t("csNotice")}
            </span>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </LocalizedClientLink>
        </Button>

        {/* 문의 입력 */}
        <div className="relative mb-4">
          <Textarea
            placeholder={t("placeholder")}
            value={content}
            onChange={(e) => {
              if (e.target.value.length <= MAX_LENGTH) {
                setContent(e.target.value)
              }
            }}
            className="min-h-[180px] resize-none rounded-lg border-gray-200 text-[14px] placeholder:text-gray-400"
            disabled={isBusy}
          />
          <span className="absolute text-xs text-gray-400 right-3 bottom-3">
            {content.length}
            <span className="mx-0.5">|</span>
            {MAX_LENGTH}
          </span>
        </div>

        {/* 비밀글 체크박스 */}
        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <Checkbox
            checked={isSecret}
            onCheckedChange={(checked) => setIsSecret(checked === true)}
            disabled={isBusy}
          />
          <Lock className="w-4 h-4 text-gray-500" />
          <span className="text-[14px] text-gray-700">{t("secretLabel")}</span>
        </label>

        {/* 안내 문구 */}
        <ul className="mb-6 text-[12px] leading-relaxed text-gray-500">
          <li className="flex gap-1">
            <span className="shrink-0">•</span>
            <span>{t("guide1")}</span>
          </li>
          <li className="flex gap-1">
            <span className="shrink-0">•</span>
            <span>{t("guide2")}</span>
          </li>
        </ul>

        {/* 등록 버튼 */}
        <Button
          className="h-[52px] w-full rounded-lg text-[16px] font-medium"
          disabled={!content.trim() || isBusy}
          onClick={handleSubmit}
        >
          {isBusy
            ? isEditMode
              ? t("editing")
              : t("submitting")
            : isEditMode
              ? t("editButton")
              : t("submitButton")}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
