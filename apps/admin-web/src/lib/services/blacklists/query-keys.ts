// Blacklists 쿼리 키

import { BlacklistListQuery } from '@/lib/api/domains/blacklists';

export const blacklistQueryKeys = {
  all: ['blacklists'] as const,
  list: (query?: BlacklistListQuery) => ['blacklists', 'list', query] as const,
  byUserId: (userId: string) => ['blacklists', 'user', userId] as const,
};
