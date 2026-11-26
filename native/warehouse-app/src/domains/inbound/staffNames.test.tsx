import { act } from 'react';
import { expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import {
  STAFF_NAMES_BATCH,
  StaffNamesClientProvider,
  SYSTEM_ACTOR_ID,
  UNKNOWN_WORKER,
  staffNameBatches,
  useStaffNames,
} from './staffNames';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
  identity: async () => ({ id: 'worker-a', name: '작업자A' }),
};

const uuid = (n: number) =>
  `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

function wrapper(client: ApiClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider session={session}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <StaffNamesClientProvider client={client}>
            {children}
          </StaffNamesClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
  };
}

it('나눠 부르는 묶음은 100개를 넘지 않는다', () => {
  const ids = Array.from({ length: 250 }, (_, i) => uuid(i));

  expect(staffNameBatches(ids).map((batch) => batch.length)).toEqual([
    STAFF_NAMES_BATCH,
    STAFF_NAMES_BATCH,
    50,
  ]);
});

it('보이는 작업자 id 를 중복 없이 정렬해 100개씩 묶어 부르고, 시스템 id 는 부르지 않는다', async () => {
  const paths: string[] = [];
  const ids = Array.from({ length: 150 }, (_, i) => uuid(149 - i));
  const client: ApiClient = {
    request: (async (opts: { path: string }) => {
      paths.push(opts.path);

      return { success: true, data: [{ id: uuid(7), name: '김입고' }] };
    }) as ApiClient['request'],
  };

  const { result } = renderHook(
    () => useStaffNames([...ids, ids[0], SYSTEM_ACTOR_ID, null]),
    { wrapper: wrapper(client) }
  );

  await waitFor(() => expect(result.current(uuid(7))).toBe('김입고'));
  expect(paths).toHaveLength(2);
  expect(paths[0]).toBe(
    `/admin/staff/names?ids=${Array.from({ length: 100 }, (_, i) => uuid(i)).join(',')}`
  );
  expect(paths[1].split('=')[1].split(',')).toHaveLength(50);
  expect(result.current(SYSTEM_ACTOR_ID)).toBe('자동');
  expect(result.current(null)).toBe(UNKNOWN_WORKER);
  expect(result.current(uuid(8))).toBe(UNKNOWN_WORKER);
});

it('한 묶음이 실패해도 나머지 묶음의 이름은 보인다', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => uuid(i));
  const client: ApiClient = {
    request: (async (opts: { path: string }) => {
      if (opts.path.includes(uuid(100))) throw new Error('down');

      return { success: true, data: [{ id: uuid(3), name: '박적치' }] };
    }) as ApiClient['request'],
  };

  const { result } = renderHook(() => useStaffNames(ids), {
    wrapper: wrapper(client),
  });

  await waitFor(() => expect(result.current(uuid(3))).toBe('박적치'));
  expect(result.current(uuid(100))).toBe(UNKNOWN_WORKER);
});

it('부를 작업자가 없으면 요청하지 않는다', async () => {
  const paths: string[] = [];
  const client: ApiClient = {
    request: (async (opts: { path: string }) => {
      paths.push(opts.path);

      return { data: [] };
    }) as ApiClient['request'],
  };

  const { result } = renderHook(
    () => useStaffNames([SYSTEM_ACTOR_ID, null, undefined]),
    { wrapper: wrapper(client) }
  );

  expect(result.current(SYSTEM_ACTOR_ID)).toBe('자동');
  expect(paths).toEqual([]);
});

it('다른 작업자로 바꿔 로그인하면 앞 작업자가 받은 이름을 보이지 않고 새 작업자의 권한으로 다시 묻는다', async () => {
  const listeners = new Set<() => void>();
  let authed = true;
  let worker = { id: 'worker-a', name: '작업자A' };
  const switching: Session = {
    bootstrap: async () => {},
    isAuthenticated: () => authed,
    getAccessToken: async () => `tok-${worker.id}`,
    login: async () => {},
    logout: async () => {},
    subscribe: (fn) => {
      listeners.add(fn);

      return () => listeners.delete(fn);
    },
    identity: async () => worker,
  };
  const emit = () => listeners.forEach((fn) => fn());
  const asked: string[] = [];
  const client: ApiClient = {
    request: (async () => {
      asked.push(worker.id);

      if (worker.id === 'worker-b')
        throw new ApiError('GET → 403', 403, 'FORBIDDEN');

      return { success: true, data: [{ id: uuid(1), name: '김입고' }] };
    }) as ApiClient['request'],
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider session={switching}>
        <QueryClientProvider client={queryClient}>
          <StaffNamesClientProvider client={client}>
            {children}
          </StaffNamesClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
  }

  const { result } = renderHook(() => useStaffNames([uuid(1)]), {
    wrapper: Wrapper,
  });

  await waitFor(() => expect(result.current(uuid(1))).toBe('김입고'));

  act(() => {
    authed = false;
    emit();
  });
  act(() => {
    worker = { id: 'worker-b', name: '작업자B' };
    authed = true;
    emit();
  });

  await waitFor(() => expect(asked).toEqual(['worker-a', 'worker-b']));
  expect(result.current(uuid(1))).toBe(UNKNOWN_WORKER);
  expect(
    queryClient
      .getQueryCache()
      .findAll({ queryKey: ['staff-names'] })
      .map((q) => q.queryKey[1])
  ).toEqual(['worker-b']);
});

function switchableSession() {
  const listeners = new Set<() => void>();
  let pending: ((worker: { id: string; name: string }) => void) | null = null;
  const state = {
    authed: true,
    worker: { id: 'worker-a', name: '작업자A' },
    delayIdentity: false,
  };
  const session: Session = {
    bootstrap: async () => {},
    isAuthenticated: () => state.authed,
    getAccessToken: async () => `tok-${state.worker.id}`,
    login: async () => {},
    logout: async () => {},
    subscribe: (fn) => {
      listeners.add(fn);

      return () => listeners.delete(fn);
    },
    identity: () =>
      state.delayIdentity
        ? new Promise((resolve) => {
            pending = resolve;
          })
        : Promise.resolve(state.worker),
  };

  return {
    state,
    session,
    emit: () => listeners.forEach((fn) => fn()),
    resolveIdentity: () => {
      state.delayIdentity = false;
      pending?.(state.worker);
    },
  };
}

function mountSwitching(
  switching: ReturnType<typeof switchableSession>,
  asked: string[]
) {
  const client: ApiClient = {
    request: (async () => {
      const token = await switching.session.getAccessToken();

      asked.push(token);

      if (token === 'tok-worker-b')
        throw new ApiError('GET → 403', 403, 'FORBIDDEN');

      return { success: true, data: [{ id: uuid(1), name: '김입고' }] };
    }) as ApiClient['request'],
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider session={switching.session}>
        <QueryClientProvider client={queryClient}>
          <StaffNamesClientProvider client={client}>
            {children}
          </StaffNamesClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
  }

  return {
    queryClient,
    ...renderHook(() => useStaffNames([uuid(1)]), { wrapper: Wrapper }),
  };
}

const workersInCache = (queryClient: QueryClient) =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: ['staff-names'] })
    .map((q) => q.queryKey[1]);

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it('한 번에 로그아웃과 로그인을 하고 새 작업자 확인이 늦으면 앞 작업자 이름으로 묻지 않고 빈 표시로 기다린다', async () => {
  const switching = switchableSession();
  const asked: string[] = [];
  const { result, queryClient } = mountSwitching(switching, asked);

  await waitFor(() => expect(result.current(uuid(1))).toBe('김입고'));

  act(() => {
    switching.state.delayIdentity = true;
    switching.state.authed = false;
    switching.emit();
    switching.state.worker = { id: 'worker-b', name: '작업자B' };
    switching.state.authed = true;
    switching.emit();
  });

  expect(result.current(uuid(1))).toBe(UNKNOWN_WORKER);
  await act(settle);
  expect(asked).toEqual(['tok-worker-a']);
  expect(result.current(uuid(1))).toBe(UNKNOWN_WORKER);

  await act(async () => switching.resolveIdentity());

  await waitFor(() => expect(asked).toEqual(['tok-worker-a', 'tok-worker-b']));
  expect(result.current(uuid(1))).toBe(UNKNOWN_WORKER);
  expect(workersInCache(queryClient)).toEqual(['worker-b']);
});

it('로그인이 유지된 채 계정이 바뀌고 새 작업자 확인이 남아 있으면 앞 작업자 이름을 돌려주지 않는다', async () => {
  const switching = switchableSession();
  const asked: string[] = [];
  const { result } = mountSwitching(switching, asked);

  await waitFor(() => expect(result.current(uuid(1))).toBe('김입고'));

  act(() => {
    switching.state.delayIdentity = true;
    switching.state.worker = { id: 'worker-b', name: '작업자B' };
    switching.emit();
  });

  expect(result.current(uuid(1))).toBe(UNKNOWN_WORKER);
  await act(settle);
  expect(asked).toEqual(['tok-worker-a']);
  expect(result.current(uuid(1))).toBe(UNKNOWN_WORKER);
});
