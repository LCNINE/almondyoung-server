import { it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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
  previewToken: 'reviewed-token',
  sessionRevision: 1,
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

function renderWithClient(client: ApiClient, existingQc?: QueryClient) {
  const qc =
    existingQc ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 10_000 } },
    });
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
  return {
    ...render(<RouterProvider router={router as never} />, { wrapper: wrap }),
    qc,
  };
}

it('REVIEW: invalidate accepted preview when count data changes', async () => {
  let qty = 5;
  const client: ApiClient = {
    request: (async (o: Call) => {
      if (o.path === '/stocktaking/sessions/s-1')
        return detailWith('in_progress');
      if (o.path === '/stocktaking/sessions/s-1/variances') {
        return [{ ...VARIANCES[0], countedQuantity: qty, variance: qty - 6 }];
      }
      if (o.path.endsWith('/generate-adjustments')) return PREVIEW;
      return {};
    }) as ApiClient['request'],
  };
  const { qc } = renderWithClient(client);
  await userEvent.click(
    await screen.findByRole('button', { name: '조정 미리보기' })
  );
  expect(await screen.findByTestId('preview-line-1')).toHaveTextContent('-1');
  qty = 9;
  await act(async () => {
    await qc.invalidateQueries({ queryKey: ['stocktaking-variances', 's-1'] });
  });
  await waitFor(() =>
    expect(screen.getByTestId('variance-line-1')).toHaveTextContent('+3')
  );
  expect(screen.getByRole('button', { name: /실사 완료/ })).toBeDisabled();
});
