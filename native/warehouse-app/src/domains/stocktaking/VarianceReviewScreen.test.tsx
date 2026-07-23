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
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { VarianceReviewScreen } from './VarianceReviewScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Call = { path: string; method?: string; body?: unknown };

const VARIANCES = [
  {
    lineId: 'line-1',
    locationCode: 'A-01-02',
    skuName: '코튼셔츠',
    skuCode: 'CT-001',
    expectedQuantity: 6,
    countedQuantity: 5,
    variance: -1,
    discrepancyPercent: -16.7,
  },
];

const PREVIEW = {
  adjustmentsCreated: 1,
  eventsPosted: 0,
  message: '1개 조정이 미리보기로 계산되었습니다 (완료 시 적용).',
  preview: [
    {
      lineId: 'line-1',
      skuId: 'sku-1',
      locationId: 'l-1',
      countedQuantity: 5,
      currentOnHand: 6,
      delta: -1,
      adjustmentType: 'DECREASE',
    },
  ],
};

function detailWith(status: string) {
  return {
    id: 's-1',
    warehouseId: 'w-1',
    sessionName: '2026-07-23 실사',
    status,
    notes: null,
    createdAt: '2026-07-23T00:00:00Z',
    startedAt: '2026-07-23T01:00:00Z',
    completedAt: null,
    progress: { total: 3, counted: 3 },
    lines: [],
  };
}

function renderScreen(
  calls: Call[],
  opts: { status?: string; variances?: unknown[]; failGenerate?: boolean } = {}
) {
  const status = opts.status ?? 'in_progress';
  const variances = opts.variances ?? VARIANCES;
  const failGenerate = opts.failGenerate ?? false;
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path === '/stocktaking/sessions/s-1') return detailWith(status);
      if (o.path === '/stocktaking/sessions/s-1/variances') return variances;
      if (o.path === '/stocktaking/sessions/s-1/generate-adjustments') {
        if (failGenerate) throw new Error('요청 실패 → 500');
        return PREVIEW;
      }
      return {};
    }) as unknown as ApiClient['request'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <VarianceReviewScreen sessionId="s-1" />,
  });
  const list = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking',
    component: () => <div>세션목록</div>,
  });
  const count = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking/$sessionId',
    component: () => <div>카운트화면</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, list, count]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

describe('VarianceReviewScreen', () => {
  it('차이 목록을 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.getByText('A-01-02')).toBeInTheDocument();
    expect(screen.getByTestId('variance-line-1')).toHaveTextContent('-1');
  });

  it('미리보기 전에는 완료 버튼이 비활성이다', async () => {
    renderScreen([]);
    expect(await screen.findByRole('button', { name: /실사 완료/ })).toBeDisabled();
  });

  it('미리보기를 받으면 완료가 열리고 delta 를 보여준다', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: '조정 미리보기' }));

    expect(await screen.findByTestId('preview-line-1')).toHaveTextContent('-1');
    expect(screen.getByText(/현재 6/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeEnabled();
  });

  it('미리보기가 실패하면 완료 버튼은 계속 비활성이고 오류가 보인다', async () => {
    renderScreen([], { failGenerate: true });
    await userEvent.click(await screen.findByRole('button', { name: '조정 미리보기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.'
    );
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeDisabled();
  });

  it('완료는 확인 다이얼로그를 거쳐 complete 를 부른다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: '조정 미리보기' }));
    await userEvent.click(await screen.findByRole('button', { name: /실사 완료/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('되돌릴 수 없어요');
    await userEvent.click(screen.getByRole('button', { name: '완료' }));

    expect(calls.some((c) => c.path === '/stocktaking/sessions/s-1/complete')).toBe(true);
    expect(await screen.findByText('세션목록')).toBeInTheDocument();
  });

  it('차이가 0건이면 미리보기 없이 완료할 수 있다', async () => {
    renderScreen([], { variances: [] });
    expect(await screen.findByText(/차이가 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeEnabled();
  });

  it('완료된 세션은 읽기 전용이다', async () => {
    renderScreen([], { status: 'completed' });
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '조정 미리보기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /실사 완료/ })).not.toBeInTheDocument();
  });
});
