"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ReviewImageModal } from "@/components/reviews/ui/review-image-modal"
import { ChevronDown, Lock } from "lucide-react"

import type { Question } from "@/lib/types/ui/ugc"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { useTranslations } from "next-intl"
import Image from "next/image"

type Props = {
  question: Question
  isExpanded: boolean
  onToggle: () => void
  isDeleting?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}.${month}.${day}`
}

const CATEGORY_I18N_KEY: Record<string, string> = {
  product: "categoryProduct",
  delivery: "categoryShipping",
  order: "categoryOrder",
  exchange: "categoryExchange",
  account: "categoryAccount",
  etc: "categoryEtc",
}

export function MyInquiryCard({
  question,
  isExpanded,
  onToggle,
  isDeleting,
  onEdit,
  onDelete,
}: Props) {
  const t = useTranslations("mypage.inquiry")
  const isAnswered = question.status === "answered"
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const categoryKey = question.category
    ? CATEGORY_I18N_KEY[question.category]
    : undefined
  const categoryLabel = categoryKey ? t(categoryKey) : t("categoryDefault")

  const handleImageClick = (index: number) => {
    setSelectedImageIndex(index)
    setImageModalOpen(true)
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="py-5">
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full cursor-pointer text-left">
            <div className="flex items-center gap-2">
              <Badge
                variant={isAnswered ? "default" : "secondary"}
                className={
                  isAnswered
                    ? "bg-gray-900 text-white hover:bg-gray-900"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-100"
                }
              >
                {isAnswered ? t("statusAnswered") : t("statusPending")}
              </Badge>
              <span className="text-xs text-gray-400">{categoryLabel}</span>
              {question.isSecret && (
                <Lock className="h-3.5 w-3.5 text-gray-400" />
              )}
              <ChevronDown
                className={cn(
                  "ml-auto h-4 w-4 text-gray-400 transition-transform",
                  isExpanded && "rotate-180"
                )}
              />
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-gray-900">
              {question.title}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {formatDate(question.createdAt)}
            </p>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-4 border-t border-gray-100 pt-4">
            {/* 질문 내용 */}
            <div className="pb-4">
              <p className="text-sm leading-relaxed whitespace-pre-line text-gray-700">
                {question.content}
              </p>

              {/* 첨부 이미지 */}
              {question.mediaFileIds && question.mediaFileIds.length > 0 && (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {question.mediaFileIds.map((fileId, index) => (
                      <button
                        key={fileId}
                        type="button"
                        className="relative h-20 w-20 cursor-pointer overflow-hidden rounded-lg border border-gray-200 transition-opacity hover:opacity-80"
                        onClick={() => handleImageClick(index)}
                      >
                        <Image
                          src={getThumbnailUrl(fileId)}
                          alt={t("attachmentAlt")}
                          fill
                          className="object-cover"
                        />
                      </button>
                    ))}
                  </div>
                  <ReviewImageModal
                    images={question.mediaFileIds}
                    startIndex={selectedImageIndex}
                    open={imageModalOpen}
                    onOpenChange={setImageModalOpen}
                  />
                </>
              )}
            </div>

            {/* 답변 */}
            {question.answer && (
              <div className="mt-4 border-l-2 border-gray-900 pl-4">
                <p className="mb-2 text-sm font-semibold text-gray-900">
                  {t("answerSection")}
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-line text-gray-700">
                  {question.answer.content}
                </p>
                <p className="mt-3 text-xs text-gray-400">
                  {formatDate(question.answer.createdAt)}
                </p>
              </div>
            )}

            {/* 수정/삭제 버튼 (답변 전에만 가능) */}
            {!isAnswered && (
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  className="cursor-pointer text-xs text-gray-400 underline hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isDeleting}
                  onClick={onEdit}
                >
                  {t("edit")}
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer text-xs text-gray-400 underline hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isDeleting}
                    >
                      {isDeleting ? t("deleting") : t("delete")}
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("deleteDialogTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("deleteDialogDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={onDelete}>
                        {t("confirmDelete")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
