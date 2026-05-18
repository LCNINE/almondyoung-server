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
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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

function maskNickname(nickname: string): string {
  if (!nickname) return "****"
  if (nickname.length <= 2) return nickname[0] + "**"
  return nickname.slice(0, nickname.length - 2) + "**"
}

function formatDate(dateStr: string): string {
  return formatDateUtil(dateStr, DATE_FORMATS.KO_DOT)
}

export function QnaCard({
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

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="py-6">
        <div className="space-y-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "w-full text-left",
                question.answer && "cursor-pointer"
              )}
            >
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={isAnswered ? "default" : "secondary"}
                  className={
                    isAnswered
                      ? "bg-gray-900 text-white hover:bg-gray-900"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-100"
                  }
                >
                  {isAnswered ? t("answered") : t("pendingAnswer")}
                </Badge>
                {question.isSecret && (
                  <Lock className="h-3.5 w-3.5 text-gray-400" />
                )}
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-gray-900">
                {question.title}
              </p>
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {maskNickname(question.nickname)}
              <span className="mx-1.5">|</span>
              {formatDate(question.createdAt)}
            </p>
            {isAuthor && (
              <div className="flex gap-2 text-xs text-gray-400">
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
        </div>
      </div>

      <CollapsibleContent>
        {question.answer && (
          <div className="bg-gray-10 px-5 py-6">
            <p className="mb-4 text-base font-bold text-gray-900">{t("answer")}</p>
            <p className="text-[14px] leading-relaxed whitespace-pre-line text-gray-700">
              {question.answer.content}
            </p>
            <p className="mt-4 text-xs text-gray-400">
              {formatDate(question.answer.createdAt)}
            </p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
