'use client';

import { QuestionCategory, CATEGORY_LABELS } from '@/lib/types/dto/qna';

type QnaCategoryCellProps = {
  value: string | null | undefined;
};

export function QnaCategoryCell({ value }: QnaCategoryCellProps) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  const label = CATEGORY_LABELS[value as QuestionCategory];
  return <span>{label ?? value}</span>;
}
