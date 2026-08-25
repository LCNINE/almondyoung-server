'use client';

import { useQuery } from '@tanstack/react-query';
import { KeywordStatisticsQuery, searchAdminApi } from '@/lib/api/domains/search';
import { searchQueryKeys } from './query-keys';

export const useKeywordStatistics = (query: KeywordStatisticsQuery) => {
  return useQuery({
    queryKey: searchQueryKeys.keywordStatistics(query),
    queryFn: () => searchAdminApi.getKeywordStatistics(query),
  });
};
