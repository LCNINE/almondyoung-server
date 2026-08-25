import { KeywordStatisticsQuery } from '@/lib/api/domains/search';

export const searchQueryKeys = {
  all: ['search'] as const,
  keywordStatistics: (query: KeywordStatisticsQuery) =>
    [...searchQueryKeys.all, 'keyword-statistics', query] as const,
};
