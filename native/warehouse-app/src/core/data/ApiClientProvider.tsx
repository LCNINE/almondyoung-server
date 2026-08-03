import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createApiClient, type ApiClient } from './httpClient';
import { useSession } from '../../app/session-context';
import { apiBaseUrl, apiAuthMode } from '../../app/config';

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  client?: ApiClient;
  children: ReactNode;
}) {
  const session = useSession();
  const value = useMemo(
    () =>
      client ??
      createApiClient({
        baseUrl: apiBaseUrl,
        getToken: () => session.getAccessToken(),
        authMode: apiAuthMode,
      }),
    [client, session]
  );
  return (
    <ApiClientContext.Provider value={value}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): ApiClient {
  const c = useContext(ApiClientContext);
  if (!c) throw new Error('useApiClient must be used within an ApiClientProvider');
  return c;
}
