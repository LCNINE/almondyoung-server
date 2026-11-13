import { describe, expect, it, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { createSession, type Session } from '../../core/auth/session';
import type { WorkerIdentity } from '../../core/auth/oidc';
import type { ApiClient } from '../../core/data/httpClient';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import {
  TestWorkProvider,
  createTestWorkRuntime,
} from '../../domains/inbound/__fixtures__/workRuntime';
import { SessionProvider } from '../session-context';
import { useWorkerIdentity } from '../useWorkerIdentity';
import { WarehouseProvider } from '../warehouse-context';
import { SettingsRoute } from './SettingsRoute';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'android' }));

function makeSession(identity: () => Promise<WorkerIdentity>) {
  const signOut = vi.fn(async () => {});
  const session: Session = {
    bootstrap: async () => {},
    isAuthenticated: () => true,
    getAccessToken: async () => 'tok',
    login: async () => {},
    logout: async () => {},
    signOut,
    identity,
    subscribe: () => () => {},
  };
  return { session, signOut };
}

function HeaderProbe() {
  const worker = useWorkerIdentity();
  return (
    <p data-testid="header">
      {worker.status === 'ready' ? worker.identity.name : worker.status}
    </p>
  );
}

function renderSettings(
  session: Session,
  api: ApiClient,
  options: { getScope?: () => Promise<string>; header?: boolean } = {}
) {
  const { getScope, header = false } = options;
  const base = createTestWorkRuntime(api);
  const runtime = getScope ? { ...base, getScope } : base;
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => null,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/settings',
        component: SettingsRoute,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/settings'] }),
  });
  render(
    <SessionProvider session={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <WarehouseProvider prefs={createMemoryPrefs()}>
          <TestWorkProvider runtime={runtime}>
            {header && <HeaderProbe />}
            <RouterProvider router={router} />
          </TestWorkProvider>
        </WarehouseProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return runtime;
}

const warehousesOnly: ApiClient = {
  request: async <T,>() => [] as T,
};

async function leaveUncertainWork(
  runtime: ReturnType<typeof createTestWorkRuntime>
) {
  await runtime.store.begin({
    id: 'op-1',
    scope: 'fixture',
    resource: '/inventory/stocks/adjust:sku-1',
    method: 'POST',
    path: '/inventory/stocks/adjust',
    bodyJson: '{}',
    createdAt: Date.now(),
  });
  await runtime.store.finish('op-1', 'uncertain');
  await runtime.runner.restore();
}

describe('SettingsRoute account', () => {
  it('shows the signed-in worker', async () => {
    const { session } = makeSession(async () => ({
      id: 'u1',
      name: '김작업',
      loginId: 'worker01',
    }));
    renderSettings(session, warehousesOnly);

    expect(await screen.findByText('김작업')).toBeInTheDocument();
    expect(screen.getByText('(worker01)')).toBeInTheDocument();
  });

  it('offers a retry when the worker cannot be read', async () => {
    const identity = vi
      .fn<() => Promise<WorkerIdentity>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'u1', name: '김작업' });
    const { session } = makeSession(identity);
    renderSettings(session, warehousesOnly);

    fireEvent.click(await screen.findByRole('button', { name: '다시 확인' }));
    expect(await screen.findByText('김작업')).toBeInTheDocument();
  });

  it('signs out right away when nothing is waiting', async () => {
    const { session, signOut } = makeSession(async () => ({
      id: 'u1',
      name: '김작업',
    }));
    renderSettings(session, warehousesOnly);
    await waitFor(() =>
      expect(
        screen.queryByText(
          '저장된 작업을 확인하고 있어요. 잠시만 기다려 주세요.'
        )
      ).toBeNull()
    );

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it('warns before signing out with unconfirmed work and lets the worker check it first', async () => {
    let confirm = false;
    const api: ApiClient = {
      request: async <T,>(o: { path: string }) => {
        if (o.path === '/inventory/stocks/adjust' && confirm)
          return { ok: true } as T;
        if (o.path === '/inventory/stocks/adjust')
          throw new TypeError('Failed to fetch');
        return [] as T;
      },
    };
    const { session, signOut } = makeSession(async () => ({
      id: 'u1',
      name: '김작업',
    }));
    const runtime = renderSettings(session, api);
    await leaveUncertainWork(runtime);

    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(
      await screen.findByText(/처리 결과를 확인하지 못한 작업이 1건 있어요/)
    ).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeDisabled();

    confirm = true;
    fireEvent.click(
      within(screen.getByRole('alert')).getByRole('button', {
        name: '처리 내역 확인',
      })
    );
    expect(
      await screen.findByText(
        '남은 작업을 모두 확인했어요. 이제 로그아웃할 수 있어요.'
      )
    ).toBeInTheDocument();
    expect(await runtime.store.get('op-1')).toMatchObject({
      status: 'confirmed',
    });

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it('can still sign out when the work cannot be checked', async () => {
    const { session, signOut } = makeSession(async () => ({
      id: 'u1',
      name: '김작업',
    }));
    const runtime = renderSettings(session, warehousesOnly);
    await leaveUncertainWork(runtime);

    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    fireEvent.click(
      await screen.findByRole('button', { name: '그래도 로그아웃' })
    );
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(await runtime.store.get('op-1')).toMatchObject({
      status: 'uncertain',
    });
  });

  it('warns when the saved work on this device could not be loaded yet', async () => {
    const { session, signOut } = makeSession(async () => ({
      id: 'u1',
      name: '김작업',
    }));
    renderSettings(session, warehousesOnly, {
      getScope: () => Promise.reject(new Error('down')),
    });
    await screen.findByText(
      '작업 저장소나 서버 연결을 확인하지 못했어요. 연결을 확인해 주세요.'
    );

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    expect(
      await screen.findByText(/이 기기에 남은 작업을 아직 확인하지 못했어요/)
    ).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '그래도 로그아웃' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it('a successful retry also fills the name shown elsewhere', async () => {
    const fetchIdentity = vi
      .fn<(token: string) => Promise<WorkerIdentity>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'u1', name: '김작업' });
    const session = createSession({
      manager: {
        getAccessToken: async () => 'tok',
        getIdToken: async () => undefined,
        set: async () => {},
        clear: async () => {},
      },
      runLogin: async () => {},
      fetchIdentity,
    });
    await session.login();
    renderSettings(session, warehousesOnly, { header: true });

    await waitFor(() =>
      expect(screen.getByTestId('header')).toHaveTextContent('failed')
    );
    fireEvent.click(await screen.findByRole('button', { name: '다시 확인' }));

    await waitFor(() =>
      expect(screen.getByTestId('header')).toHaveTextContent('김작업')
    );
    expect(fetchIdentity).toHaveBeenCalledTimes(2);
  });
});
