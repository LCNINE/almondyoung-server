import { AdminLogoContestEntryListQuery } from '@/lib/types/dto/logo-contest';

export const logoContestQueryKeys = {
  all: ['logo-contest'] as const,
  entries: (query: AdminLogoContestEntryListQuery) =>
    [...logoContestQueryKeys.all, 'entries', query] as const,
  contestStatus: () => [...logoContestQueryKeys.all, 'status'] as const,
} as const;
