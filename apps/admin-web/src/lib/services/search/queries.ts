'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeywordDetailQuery,
  KeywordStatisticsQuery,
  searchAdminApi,
  UpsertKeywordIssueInput,
  ZeroHitKeywordsQuery,
} from '@/lib/api/domains/search';
import { searchQueryKeys } from './query-keys';

export const useKeywordStatistics = (query: KeywordStatisticsQuery) => {
  return useQuery({
    queryKey: searchQueryKeys.keywordStatistics(query),
    queryFn: () => searchAdminApi.getKeywordStatistics(query),
  });
};

export const useZeroHitKeywords = (query: ZeroHitKeywordsQuery) => {
  return useQuery({
    queryKey: searchQueryKeys.zeroHitKeywords(query),
    queryFn: () => searchAdminApi.getZeroHitKeywords(query),
    // 페이지 이동 시 이전 페이지를 유지해 테이블이 깜빡이지 않게 한다
    placeholderData: (previous) => previous,
  });
};

export const useKeywordDetail = (query: KeywordDetailQuery, enabled: boolean) => {
  return useQuery({
    queryKey: searchQueryKeys.keywordDetail(query),
    queryFn: () => searchAdminApi.getKeywordDetail(query),
    enabled: enabled && query.keyword.trim().length > 0,
  });
};

export const useUpsertKeywordIssue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertKeywordIssueInput) => searchAdminApi.upsertKeywordIssue(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: searchQueryKeys.zeroHitKeywordsAll() });
      void queryClient.invalidateQueries({ queryKey: searchQueryKeys.keywordDetailAll() });
    },
  });
};
