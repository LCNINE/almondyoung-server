'use client';

import { oauthClientApi } from '@/lib/api/domains/oauth-clients';
import { useQuery } from '@tanstack/react-query';
import { oauthClientsQueryKeys } from './query-keys';

export const useOAuthClients = () => {
  return useQuery({
    queryKey: oauthClientsQueryKeys.list(),
    queryFn: () => oauthClientApi.list(),
  });
};
