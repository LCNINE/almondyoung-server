import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
  return renderWithClient(client);
}

/**
 * staleTime 을 프로덕션 queryClient(src/core/data/queryClient.ts, 10_000ms)와
 * 맞춘다 — 캐시 신선도 게이트(FIX 1)를 검증하려면 테스트의 staleTime 이 0(기본값)
 * 이면 안 된다. 0 이면 데이터가 도착하자마자 isStale 이 true 가 되어버려서
 * "신선한 성공" 과 "무효화된 stale" 을 구별할 수 없다.
 */
function renderWithClient(client: ApiClient, existingQc?: QueryClient) {
  const qc = existingQc ?? new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });
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
  return { ...render(<RouterProvider router={router as never} />, { wrapper: wrap }), qc };
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

  it('무효화된(stale) 차이 캐시는 재조회가 끝나기 전까지 완료를 열지 않는다', async () => {
    // 카운팅 화면에서 뭔가를 새로 세면 mutations.ts 가 stocktaking-variances 를
    // invalidate 한다(FIX 1의 절반). 이 테스트는 그 무효화 *이후* 화면의 반응만
    // 검증한다 — invalidate 는 여기서 직접 흉내 낸다. 재조회 응답을 일부러 계속
    // "차이 없음"으로 둬서, 응답의 rows.length 가 아니라 신선도(isStale/isFetching)
    // 자체가 게이트를 여닫는지를 rows.length 와 분리해서 확인한다.
    let varianceCalls = 0;
    let resolveRefetch: ((v: unknown[]) => void) | undefined;
    const client: ApiClient = {
      request: (async (o: Call) => {
        if (o.path === '/stocktaking/sessions/s-1') return detailWith('in_progress');
        if (o.path === '/stocktaking/sessions/s-1/variances') {
          varianceCalls += 1;
          if (varianceCalls === 1) return [];
          return new Promise<unknown[]>((resolve) => {
            resolveRefetch = resolve;
          });
        }
        return {};
      }) as unknown as ApiClient['request'],
    };
    const { qc } = renderWithClient(client);

    expect(await screen.findByText(/차이가 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeEnabled();

    // 다른 화면(SessionCountScreen)에서의 카운팅 뮤테이션이 캐시를 무효화했다고
    // 가정한다 — 쿼리가 여전히 마운트돼 있으므로 즉시 재조회가 걸린다.
    void qc.invalidateQueries({ queryKey: ['stocktaking-variances', 's-1'] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /실사 완료/ })).toBeDisabled();
    });

    resolveRefetch?.([]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /실사 완료/ })).toBeEnabled();
    });
  });

  it('언마운트 중 무효화되고 stale 윈도우 안에 재마운트해도, 재조회가 끝날 때까지 완료를 막는다', async () => {
    // isFetching 만으로는 못 잡는 경로다. 재마운트가 refetchOnMount 로 즉시 새
    // 요청을 걸면(기본값), 그 요청이 도는 동안엔 isFetching 만으로도 이미
    // 막혀서 isStale 절이 하는 일이 안 보인다 — 그래서 이 테스트는 refetchOnMount
    // 를 꺼서 "재조회가 아직 시작조차 안 한, 무효화만 된" 상태를 붙잡아 둔다.
    // 그 상태에서도(isFetching=false, isStale=true) 게이트가 닫혀 있어야
    // isStale 절이 실제로 뭔가를 막고 있다는 뜻이다. 재조회는 그 다음에 직접
    // 걸어서(화면이 다시 활성 옵저버를 갖게 됐을 때의 invalidate) "재조회가
    // 끝날 때까지" 도 같이 검증한다.
    let varianceCalls = 0;
    let resolveRefetch: ((v: unknown[]) => void) | undefined;
    const client: ApiClient = {
      request: (async (o: Call) => {
        if (o.path === '/stocktaking/sessions/s-1') return detailWith('in_progress');
        if (o.path === '/stocktaking/sessions/s-1/variances') {
          varianceCalls += 1;
          if (varianceCalls === 1) return [];
          return new Promise<unknown[]>((resolve) => {
            resolveRefetch = resolve;
          });
        }
        return {};
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 10_000, refetchOnMount: false } },
    });

    const first = renderWithClient(client, qc);
    expect(await screen.findByText(/차이가 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeEnabled();

    // 화면을 떠난다 — 이 시점엔 옵저버가 없다.
    first.unmount();

    // 다른 화면(SessionCountScreen)에서의 카운팅 뮤테이션이 캐시를 무효화한다.
    // 옵저버가 없으므로 즉시 재조회는 걸리지 않는다 — invalidated 표시만 남는다.
    void qc.invalidateQueries({ queryKey: ['stocktaking-variances', 's-1'] });

    // stale 윈도우 안에 같은 캐시로 다시 들어온다. refetchOnMount 를 꺼 뒀으니
    // 재조회는 아직 안 걸렸다 — rows 는 여전히 빈 배열(무효화 전 캐시)이다.
    renderWithClient(client, qc);
    await screen.findByRole('heading', { name: '차이 확인' });

    // rows 가 비어 있어도(무효화된 캐시라) "차이가 없어요" 배너 대신 빈 목록이
    // 보이고, 완료도 막혀 있어야 한다 — 재조회가 아직 시작도 안 했다(isFetching
    // 은 false). 이 단정을 막는 건 오직 isStale 뿐이다.
    expect(varianceCalls).toBe(1); // 재조회가 걸리지 않았음을 직접 확인한다.
    expect(screen.queryByText(/차이가 없어요/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeDisabled();

    // 이제 실제로 재조회를 건다(예: 화면이 다시 활성 옵저버를 가진 채 무효화되는
    // 경우) — 재조회가 끝나기 전까진 여전히 막혀 있어야 하고, 끝나면 열려야 한다.
    void qc.invalidateQueries({ queryKey: ['stocktaking-variances', 's-1'] });
    await waitFor(() => expect(varianceCalls).toBe(2));
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeDisabled();

    resolveRefetch?.([]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /실사 완료/ })).toBeEnabled();
    });
  });
});
