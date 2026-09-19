import { qnaApi } from '@/lib/api/domains/qna';
import { QnaListQuery } from '@/lib/types/dto/qna';
import {
  keepPreviousData,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { qnaQueryKeys } from './query-keys';

export const useQuestions = (query: QnaListQuery) => {
  return useQuery({
    queryKey: qnaQueryKeys.list(query),
    queryFn: () => qnaApi.getQuestions(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useQuestion = (id: string) => {
  return useSuspenseQuery({
    queryKey: qnaQueryKeys.question(id),
    queryFn: () => qnaApi.getQuestion(id),
    staleTime: 30 * 1000,
  });
};

export const useDailyQuestionCounts = (from: string, to: string) => {
  return useQuery({
    queryKey: [...qnaQueryKeys.all, 'daily', { from, to }] as const,
    queryFn: () => qnaApi.getDailyCounts(from, to),
    staleTime: 60 * 1000,
  });
};
