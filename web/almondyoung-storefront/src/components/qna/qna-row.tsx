"use client"

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
import { Lock } from "lucide-react"
import { useTranslations } from "next-intl"

import type { Question } from "@/lib/types/ui/ugc"
import { cn } from "@/lib/utils"
import { DATE_FORMATS, formatDate as formatDateUtil } from "@/lib/utils/format-date"

type Props = {
  question: Question
  isExpanded: boolean
  onToggle: () => void
  isAuthor?: boolean
  isDeleting?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

const COLS =
  "grid grid-cols-[110px_1fr_140px_120px] items-center gap-3 px-2 py-4"

function maskNickname(nickname: string): string {
  if (!nickname) return "****"
  if (nickname.length <= 2) return nickname[0] + "**"
  return nickname.slice(0, nickname.length - 2) + "**"
}

function formatDate(dateStr: string): string {
  return `${formatDateUtil(dateStr, DATE_FORMATS.KO_DOT)}.`
}

export function QnaRow({
  question,
  isExpanded,
  onToggle,
  isAuthor,
  isDeleting,
  onEdit,
  onDelete,
}: Props) {
  const t = useTranslations("productDetail.qna")
  const isAnswered = question.status === "answered"
  const isSecretMasked = question.isSecret && !isAuthor
  const displayTitle = isSecretMasked ? t("secretPlaceholder") : question.title
  const canExpand = !!question.answer || !isSecretMasked

  return (
    <div className="border-b border-gray-100">
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        className={cn(
          COLS,
          "w-full text-left",
          canExpand && "cursor-pointer hover:bg-gray-50"
        )}
      >
        <span
          className={cn(
            "text-sm",
            isAnswered ? "text-gray-900" : "text-gray-400"
          )}
        >
          {isAnswered ? t("answered") : t("unanswered")}
        </span>

        <span className="flex items-center gap-1.5 truncate text-sm text-gray-900">
          <span className="truncate">{displayTitle}</span>
          {question.isSecret && (
            <Lock className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          )}
        </span>

        <span className="text-right text-sm text-gray-500">
          {maskNickname(question.nickname)}
        </span>

        <span className="text-right text-sm text-gray-500">
          {formatDate(question.createdAt)}
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-4 bg-gray-50 px-6 py-6">
          {!isSecretMasked && (
            <div>
              <p className="mb-2 text-xs font-bold text-gray-500">Q</p>
              <p className="text-[14px] leading-relaxed whitespace-pre-line text-gray-800">
                {question.content}
              </p>
            </div>
          )}

          {question.answer && (
            <div>
              <p className="mb-2 text-xs font-bold text-gray-500">A</p>
              <p className="text-[14px] leading-relaxed whitespace-pre-line text-gray-700">
                {question.answer.content}
              </p>
              <p className="mt-3 text-xs text-gray-400">
                {formatDate(question.answer.createdAt)}
              </p>
            </div>
          )}

          {isAuthor && (
            <div className="flex justify-end gap-3 text-xs text-gray-400">
              {!isAnswered && (
                <button
                  type="button"
                  className="cursor-pointer underline hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isDeleting}
                  onClick={onEdit}
                >
                  {t("edit")}
                </button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="cursor-pointer underline hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isDeleting}
                  >
                    {isDeleting ? t("deleting") : t("delete")}
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("deleteDialogDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete}>
                      {t("delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const QNA_ROW_COLS = COLS
