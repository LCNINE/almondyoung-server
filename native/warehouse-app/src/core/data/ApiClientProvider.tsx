import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createApiClient, type ApiClient } from './httpClient';
import { useIsAuthenticated, useSession } from '../../app/session-context';
import { apiBaseUrl, apiAuthMode } from '../../app/config';

import { useQueryClient } from '@tanstack/react-query';
import { createOperationRunner } from '../operations/operationRunner';
import { createOperationStore } from '../operations/operationStore';
import { OperationContext } from '../operations/OperationContext';
import { WorkBoundary } from '../operations/WorkBoundary';
import { invalidateInventory } from './invalidateInventory';

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  client?: ApiClient;
  children: ReactNode;
}) {
  const session = useSession();
  const authenticated = useIsAuthenticated();
  const qc = useQueryClient();
  const runtime = useMemo(() => {
    if (client) return null;
    const raw = createApiClient({
      baseUrl: apiBaseUrl,
      getToken: () => session.getAccessToken(),
      authMode: apiAuthMode,
    });
    let boundScope: string | undefined;
    let identity: { token: string; scope: string } | undefined;
    const scopeForToken = async (token: string) => {
      if (identity?.token === token) return identity.scope;
      const contextApi = createApiClient({
        baseUrl: apiBaseUrl,
        getToken: async () => token,
        authMode: apiAuthMode,
      });
      const context = await contextApi.request<{
        actorId: string;
        operationContractVersion: number;
      }>({ path: '/inventory/work-context' });
      if (context.operationContractVersion !== 2 || !context.actorId)
        throw new Error('앱과 서버 업데이트를 확인해 주세요.');
      identity = {
        token,
        scope: JSON.stringify([apiBaseUrl, context.actorId]),
      };
      return identity.scope;
    };
    const getScope = async () => {
      if (!session.isAuthenticated()) throw new Error('로그인이 필요해요.');
      const scope = await scopeForToken(await session.getAccessToken());
      if (boundScope && boundScope !== scope)
        throw new Error('로그인을 다시 확인해 주세요.');
      boundScope = scope;
      return scope;
    };
    const store = createOperationStore();
    const runner = createOperationRunner({
      api: raw,
      store,
      getScope,
      assertPrincipal: async (token, scope) => {
        if (
          !session.isAuthenticated() ||
          (await scopeForToken(token)) !== scope
        )
          throw new Error('로그인을 다시 확인해 주세요.');
      },
      onConfirmed: () => invalidateInventory(qc),
    });
    return { runner, store, getScope };
  }, [client, session, qc, authenticated]);
  return (
    <ApiClientContext.Provider value={client ?? runtime!.runner}>
      <OperationContext.Provider value={runtime}>
        <WorkBoundary>{children}</WorkBoundary>
      </OperationContext.Provider>
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): ApiClient {
  const c = useContext(ApiClientContext);
  if (!c)
    throw new Error('useApiClient must be used within an ApiClientProvider');
  return c;
}
