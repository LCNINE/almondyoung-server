import { KeywordDetailQuery, KeywordStatisticsQuery, ZeroHitKeywordsQuery } from '@/lib/api/domains/search';

export const searchQueryKeys = {
  all: ['search'] as const,
  keywordStatistics: (query: KeywordStatisticsQuery) =>
    [...searchQueryKeys.all, 'keyword-statistics', query] as const,
  zeroHitKeywords: (query: ZeroHitKeywordsQuery) =>
    [...searchQueryKeys.all, 'zero-hit-keywords', query] as const,
  zeroHitKeywordsAll: () => [...searchQueryKeys.all, 'zero-hit-keywords'] as const,
  keywordDetail: (query: KeywordDetailQuery) => [...searchQueryKeys.all, 'keyword-detail', query] as const,
  keywordDetailAll: () => [...searchQueryKeys.all, 'keyword-detail'] as const,
};
