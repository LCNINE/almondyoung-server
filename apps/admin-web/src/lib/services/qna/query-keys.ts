import { QnaListQuery } from '@/lib/types/dto/qna';

export const qnaQueryKeys = {
  all: ['qna'] as const,
  list: (query: QnaListQuery) => [...qnaQueryKeys.all, 'list', query] as const,
  question: (id: string) => [...qnaQueryKeys.all, 'question', id] as const,
} as const;
