import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SessionListScreen } from './SessionListScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Call = { path: string; method?: string; body?: unknown };

const SESSIONS = [
  {
    id: 's-run',
    warehouseId: 'w-1',
    sessionName: '진행중 실사',
    status: 'in_progress',
    notes: null,
    createdAt: '2026-07-23T00:00:00Z',
    startedAt: '2026-07-23T01:00:00Z',
    completedAt: null,
  },
  {
    id: 's-draft',
    warehouseId: 'w-1',
    sessionName: '대기 실사',
    status: 'draft',
    notes: null,
    createdAt: '2026-07-22T00:00:00Z',
    startedAt: null,
    completedAt: null,
  },
];

function renderScreen(calls: Call[], withWarehouse = true) {
  const client: ApiClient = {
    request: (async (opts: Call) => {
      calls.push(opts);
      if (opts.path.startsWith('/stocktaking/sessions?')) return { data: SESSIONS, total: 2 };
      if (opts.path === '/stocktaking/sessions') return { ...SESSIONS[1], id: 's-new' };
      return {};
    }) as unknown as ApiClient['request'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs(
    withWarehouse ? { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }) } : {}
  );
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: SessionListScreen,
  });
  const detail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking/$sessionId',
    component: () => <div>카운트화면</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, detail]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

describe('SessionListScreen', () => {
  it('창고 미설정이면 창고 선택을 요구한다', async () => {
    renderScreen([], false);
    expect(await screen.findByText(/창고를 먼저 선택/)).toBeInTheDocument();
  });

  it('세션 목록을 상태와 함께 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText('진행중 실사')).toBeInTheDocument();
    expect(screen.getByText('대기 실사')).toBeInTheDocument();
    expect(screen.getAllByText('진행중').length).toBeGreaterThan(0);
  });

  it('진행중 세션을 탭하면 카운트 화면으로 간다', async () => {
    renderScreen([]);
    // in_progress 행에는 취소 버튼도 있고 그 접근성 이름도 "진행중 실사"로 시작하므로,
    // 세션명 텍스트의 최근접 button 조상을 눌러 행 버튼을 명확히 특정한다.
    const label = await screen.findByText('진행중 실사');
    const rowButton = label.closest('button');
    if (!rowButton) throw new Error('row button not found');
    await userEvent.click(rowButton);
    expect(await screen.findByText('카운트화면')).toBeInTheDocument();
  });

  it('대기 세션을 탭하면 start 후 카운트 화면으로 간다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: /대기 실사/ }));
    expect(await screen.findByText('카운트화면')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/stocktaking/sessions/s-draft/start')).toBe(true);
  });

  it('새 실사는 생성 → 시작 → 이동을 잇는다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);

    await userEvent.click(await screen.findByRole('button', { name: '+ 새 실사' }));
    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    expect(await screen.findByText('카운트화면')).toBeInTheDocument();
    const create = calls.find((c) => c.path === '/stocktaking/sessions' && c.method === 'POST');
    expect(create?.body).toMatchObject({ warehouseId: 'w-1' });
    expect(calls.some((c) => c.path === '/stocktaking/sessions/s-new/start')).toBe(true);
  });

  it('진행중 세션은 취소할 수 있다 (확인 후)', async () => {
    const calls: Call[] = [];
    renderScreen(calls);

    await userEvent.click(await screen.findByRole('button', { name: '진행중 실사 취소' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '실사 취소' }));

    expect(calls.some((c) => c.path === '/stocktaking/sessions/s-run/cancel')).toBe(true);
  });
});
