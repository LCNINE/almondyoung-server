import type { Question } from "@/lib/types/ui/ugc"

export function visibleQuestions(questions: Question[] | undefined): Question[] {
  return (questions ?? []).filter(
    (q) => q.status === "active" || q.status === "answered"
  )
}

export const QNA_ITEMS_PER_PAGE = 10
