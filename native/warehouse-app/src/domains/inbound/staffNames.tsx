import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiAuthMode, oidcConfig } from '../../app/config';
import { useIsAuthenticated, useSession } from '../../app/session-context';
import { useWorkerIdentity } from '../../app/useWorkerIdentity';
import { createApiClient, type ApiClient } from '../../core/data/httpClient';

export const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000010';
export const STAFF_NAMES_BATCH = 100;
export const UNKNOWN_WORKER = '—';

const STAFF_NAMES_KEY = 'staff-names';

const StaffNamesClientContext = createContext<ApiClient | null>(null);

export function StaffNamesClientProvider({
  client,
  children,
}: {
  client: ApiClient;
  children: ReactNode;
}) {
  return (
    <StaffNamesClientContext.Provider value={client}>
      {children}
    </StaffNamesClientContext.Provider>
  );
}

function useStaffNamesClient(): ApiClient {
  const injected = useContext(StaffNamesClientContext);
  const session = useSession();

  return useMemo(
    () =>
      injected ??
      createApiClient({
        baseUrl: oidcConfig.issuer.replace(/\/$/, ''),
        getToken: () => session.getAccessToken(),
        authMode: apiAuthMode,
        reportReach: false,
      }),
    [injected, session]
  );
}

export function staffNameBatches(ids: readonly string[]): string[][] {
  const batches: string[][] = [];

  for (let i = 0; i < ids.length; i += STAFF_NAMES_BATCH) {
    batches.push(ids.slice(i, i + STAFF_NAMES_BATCH));
  }

  return batches;
}

function isStaffName(row: unknown): row is { id: string; name: string } {
  return (
    !!row &&
    typeof row === 'object' &&
    'id' in row &&
    'name' in row &&
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    row.name.length > 0
  );
}

function readNames(value: unknown): [string, string][] {
  if (!value || typeof value !== 'object' || !('data' in value)) return [];

  const rows = value.data;

  if (!Array.isArray(rows)) return [];

  return rows
    .filter(isStaffName)
    .map((row): [string, string] => [row.id, row.name]);
}

function useForgetOtherSessionsNames(workerId: string | null) {
  const session = useSession();
  const qc = useQueryClient();

  useEffect(() => {
    const forget = (keep: string | null) => {
      const others = {
        queryKey: [STAFF_NAMES_KEY],
        predicate: (q: { queryKey: readonly unknown[] }) =>
          q.queryKey[1] !== keep,
      };
      void qc.cancelQueries(others);
      qc.removeQueries(others);
    };
    let authed = session.isAuthenticated();

    forget(workerId);

    return session.subscribe(() => {
      const next = session.isAuthenticated();

      if (next === authed) return;

      authed = next;
      forget(null);
    });
  }, [session, qc, workerId]);
}

export function useStaffNames(
  actorIds: ReadonlyArray<string | null | undefined>
): (actorId: string | null | undefined) => string {
  const client = useStaffNamesClient();
  const authenticated = useIsAuthenticated();
  const worker = useWorkerIdentity();
  const workerId = worker.status === 'ready' ? worker.identity.id : null;
  const ids = [
    ...new Set(
      actorIds.filter((id): id is string => !!id && id !== SYSTEM_ACTOR_ID)
    ),
  ].sort();

  useForgetOtherSessionsNames(workerId);

  const query = useQuery({
    queryKey: [STAFF_NAMES_KEY, workerId, ids],
    enabled: authenticated && workerId !== null && ids.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const results = await Promise.allSettled(
        staffNameBatches(ids).map((batch) =>
          client.request<unknown>({
            path: `/admin/staff/names?ids=${batch.map(encodeURIComponent).join(',')}`,
          })
        )
      );

      return new Map(
        results.flatMap((result) =>
          result.status === 'fulfilled' ? readNames(result.value) : []
        )
      );
    },
  });
  const names = authenticated && workerId !== null ? query.data : undefined;

  return (actorId) => {
    if (!actorId) return UNKNOWN_WORKER;

    if (actorId === SYSTEM_ACTOR_ID) return '자동';

    return names?.get(actorId) ?? UNKNOWN_WORKER;
  };
}
