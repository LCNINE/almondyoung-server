import { logoContestApi } from '@/lib/api/domains/logo-contest';
import { AdminLogoContestEntryListQuery } from '@/lib/types/dto/logo-contest';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { logoContestQueryKeys } from './query-keys';

export const useLogoContestEntries = (query: AdminLogoContestEntryListQuery) => {
  return useQuery({
    queryKey: logoContestQueryKeys.entries(query),
    queryFn: () => logoContestApi.getEntries(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useLogoContestStatus = () => {
  return useQuery({
    queryKey: logoContestQueryKeys.contestStatus(),
    queryFn: () => logoContestApi.getContestStatus(),
    staleTime: 5 * 60 * 1000,
  });
};
