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

import type { Question } from "@/lib/types/ui/ugc"
import { cn } from "@/lib/utils"

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
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}.${month}.${day}`
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
              <Badge
                variant={isAnswered ? "default" : "secondary"}
                className={
                  isAnswered
                    ? "bg-gray-900 text-white hover:bg-gray-900"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-100"
                }
              >
                {isAnswered ? "답변완료" : "답변대기"}
              </Badge>
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
                    수정
                  </button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer underline hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isDeleting}
                    >
                      {isDeleting ? "삭제 중..." : "삭제"}
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>문의 삭제</AlertDialogTitle>
                      <AlertDialogDescription>
                        이 문의를 삭제하시겠습니까? 삭제된 문의는 복구할 수
                        없습니다.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction onClick={onDelete}>
                        삭제
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
            <p className="mb-4 text-base font-bold text-gray-900">답변</p>
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
