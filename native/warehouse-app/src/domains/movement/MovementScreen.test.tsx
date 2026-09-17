import {
  createTestWorkRuntime,
  TestWorkProvider,
} from '../inbound/__fixtures__/workRuntime';
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { MovementScreen } from './MovementScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const CONTENTS = {
  locationId: 'l-src',
  locationCode: 'A-01-02',
  warehouseId: 'w-1',
  items: [
    {
      skuId: 's1',
      skuCode: 'CT-001',
      skuName: '코튼셔츠',
      stockState: 'ON_HAND',
      quantity: 12,
      inboundPendingQty: 0,
      generallyMovableQty: 12,
    },
    {
      skuId: 's2',
      skuCode: 'DF-002',
      skuName: '불량품',
      stockState: 'DEFECTIVE',
      quantity: 2,
    },
  ],
};

function makeClient(
  calls: Array<{ path: string; method?: string; body?: unknown }>
): ApiClient {
  return {
    request: (async (opts: {
      path: string;
      method?: string;
      body?: unknown;
    }) => {
      calls.push({ path: opts.path, method: opts.method, body: opts.body });
      if (opts.path.startsWith('/locations/warehouses/')) {
        if (opts.path.includes('A-01')) {
          return {
            items: [
              {
                id: 'l-src',
                code: 'A-01-02',
                displayName: 'A-01-02',
                isActive: false,
                isSystem: false,
              },
            ],
            total: 1,
          };
        }
        if (opts.path.includes('B-05')) {
          return {
            items: [
              {
                id: 'l-dst',
                code: 'B-05-03',
                displayName: 'B-05-03',
                isActive: true,
                isSystem: false,
              },
            ],
            total: 1,
          };
        }
        return { items: [], total: 0 };
      }
      if (opts.path === '/inventory/stocks/location/l-src') return CONTENTS;
      if (opts.path === '/movement/move') return {};
      throw new Error(`GET ${opts.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
}

function renderScreen(
  client: ApiClient,
  withWarehouse = true,
  capability = true
) {
  const runtime = createTestWorkRuntime(client);
  runtime.getCapabilities = async () => ({
    inboundWorkflowConsistency: capability,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs(
    withWarehouse
      ? { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }) }
      : {}
  );
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <MovementScreen />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <TestWorkProvider runtime={runtime}>
          <ScanProvider>
            <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
          </ScanProvider>
        </TestWorkProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return {
    ...render(<RouterProvider router={router as never} />, { wrapper: wrap }),
    runtime,
  };
}

// 출발지 A-01-02 를 골라 내용물 모드로 진입시키는 공통 절차.
async function pickSource() {
  await userEvent.type(
    await screen.findByLabelText('출발 로케이션 검색'),
    'A-01'
  );
  await userEvent.click(await screen.findByRole('button', { name: /A-01-02/ }));
}

describe('MovementScreen', () => {
  it('창고 미설정이면 창고 선택을 안내한다', async () => {
    renderScreen(makeClient([]), false);
    expect(
      await screen.findByText('창고를 먼저 선택해 주세요.')
    ).toBeInTheDocument();
  });

  it('출발지를 고르면 ON_HAND 품목만 보여준다(불량품 제외)', async () => {
    renderScreen(makeClient([]));
    await pickSource();
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.queryByText('불량품')).not.toBeInTheDocument();
  });

  it('품목·대상지·수량을 갖추면 확인 후 이동을 보낸다', async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    renderScreen(makeClient(calls));
    await pickSource();

    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    // 대상지 선택
    await userEvent.type(
      await screen.findByLabelText('대상 로케이션 검색'),
      'B-05'
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /B-05-03/ })
    );
    // 이동 실행
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    const dialog = await screen.findByRole('dialog', { name: '재고 이동' });
    await userEvent.click(within(dialog).getByRole('button', { name: '이동' }));

    await waitFor(() =>
      expect(calls.some((c) => c.path === '/movement/move')).toBe(true)
    );
    const move = calls.find((c) => c.path === '/movement/move');
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/movement/move')).toBe(true)
    );
    expect(calls.find((c) => c.path === '/movement/move')?.method).toBe('POST');
    expect(move?.body).toMatchObject({
      warehouseId: 'w-1',
      lines: [
        {
          skuId: 's1',
          fromLocationId: 'l-src',
          toLocationId: 'l-dst',
          quantity: 12,
        },
      ],
    });
  });

  it('이동 성공 후 시트를 닫고 재오픈 시 직전 대상지 칩을 보여준다', async () => {
    renderScreen(makeClient([]));
    await pickSource();

    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    await userEvent.type(
      await screen.findByLabelText('대상 로케이션 검색'),
      'B-05'
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /B-05-03/ })
    );
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    const dialog = await screen.findByRole('dialog', { name: '재고 이동' });
    await userEvent.click(within(dialog).getByRole('button', { name: '이동' }));

    // 시트가 닫힌다(품목 이동 다이얼로그 사라짐).
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: '품목 이동' })
      ).not.toBeInTheDocument()
    );
    // 재오픈 → 직전 대상지 칩.
    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    expect(
      await screen.findByRole('button', { name: '직전 대상지 B-05-03 사용' })
    ).toBeInTheDocument();
  });

  it('대상 로케이션 목록에서 출발지는 제외된다', async () => {
    renderScreen(makeClient([]));
    await pickSource();
    await userEvent.click(await screen.findByRole('button', { name: '이동' }));

    // 대상지 검색에 출발지 코드를 넣어도(같은 l-src) 목록에서 걸러진다.
    await userEvent.type(
      await screen.findByLabelText('대상 로케이션 검색'),
      'A-01'
    );
    await waitFor(() => {
      const sheet = screen.getByRole('dialog', { name: '품목 이동' });
      expect(
        within(sheet).queryByRole('button', { name: /A-01-02/ })
      ).not.toBeInTheDocument();
    });
  });

  it('구형 서버가 돌려준 비활성·속성 누락 목적지는 클릭과 완전일치 자동선택에서 제외한다', async () => {
    const base = makeClient([]);
    const client: ApiClient = {
      request: async (request) => {
        if (
          request.path.startsWith('/locations/warehouses/') &&
          request.path.includes('LEGACY')
        ) {
          return {
            items: [
              {
                id: 'l-inactive',
                code: 'LEGACY-INACTIVE',
                displayName: 'LEGACY-INACTIVE',
                isActive: false,
                isSystem: false,
              },
              { id: 'l-missing', code: 'LEGACY', displayName: 'LEGACY' },
              {
                id: 'l-system',
                code: 'LEGACY-SYSTEM',
                displayName: 'LEGACY-SYSTEM',
                isActive: true,
                isSystem: true,
              },
            ],
            total: 3,
          } as never;
        }
        return base.request(request);
      },
    };
    renderScreen(client);
    await pickSource();
    await userEvent.click(screen.getByRole('button', { name: '이동' }));
    await userEvent.type(screen.getByLabelText('대상 로케이션 검색'), 'LEGACY');

    expect(
      await screen.findByRole('button', { name: 'LEGACY-SYSTEM' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'LEGACY-INACTIVE' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'LEGACY' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이동하기' })).toBeDisabled();
  });

  it('비활성 목적지 확정 거절 뒤 목적지만 지우고 이동 입력을 보존한다', async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    const base = makeClient(calls);
    const client: ApiClient = {
      request: async (request) => {
        if (request.path === '/movement/move') {
          calls.push(request);
          throw new ConflictError(
            'inactive destination',
            'MOVEMENT_DESTINATION_INACTIVE'
          );
        }
        return base.request(request);
      },
    };
    renderScreen(client);
    await pickSource();
    await userEvent.click(screen.getByRole('button', { name: '이동' }));
    await userEvent.type(screen.getByLabelText('대상 로케이션 검색'), 'B-05');
    await userEvent.click(
      await screen.findByRole('button', { name: 'B-05-03' })
    );
    await userEvent.clear(screen.getByLabelText('이동 수량 직접 입력 (낱개)'));
    await userEvent.type(
      screen.getByLabelText('이동 수량 직접 입력 (낱개)'),
      '5'
    );
    await userEvent.click(screen.getByRole('button', { name: '기타' }));
    await userEvent.type(screen.getByLabelText('사유 직접 입력'), '진열 변경');
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '재고 이동' })).getByRole(
        'button',
        { name: '이동' }
      )
    );

    expect(
      await screen.findByText(
        '사용 중지된 위치예요. 다른 도착 위치를 선택해 주세요.'
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText('대상 로케이션 검색')).toBeInTheDocument();
    expect(screen.getByLabelText('이동 수량 직접 입력 (낱개)')).toHaveValue(
      '5'
    );
    expect(screen.getByLabelText('사유 직접 입력')).toHaveValue('진열 변경');
    const sheet = screen.getByRole('dialog', { name: '품목 이동' });
    expect(within(sheet).getByText('코튼셔츠')).toBeInTheDocument();
    expect(within(sheet).getByText(/출발 A-01-02/)).toBeInTheDocument();
  });

  it('결과를 확인하지 못한 이동 요청은 목적지와 입력을 그대로 둔다', async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    const base = makeClient(calls);
    const client: ApiClient = {
      request: async (request) => {
        if (request.path === '/movement/move') {
          calls.push(request);
          throw new ConflictError('unknown conflict', 'UNKNOWN_CONFLICT');
        }
        return base.request(request);
      },
    };
    renderScreen(client);
    await pickSource();
    await userEvent.click(screen.getByRole('button', { name: '이동' }));
    await userEvent.type(screen.getByLabelText('대상 로케이션 검색'), 'B-05');
    await userEvent.click(
      await screen.findByRole('button', { name: 'B-05-03' })
    );
    await userEvent.clear(screen.getByLabelText('이동 수량 직접 입력 (낱개)'));
    await userEvent.type(
      screen.getByLabelText('이동 수량 직접 입력 (낱개)'),
      '5'
    );
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '재고 이동' })).getByRole(
        'button',
        { name: '이동' }
      )
    );

    await waitFor(() =>
      expect(calls.some((call) => call.path === '/movement/move')).toBe(true)
    );
    expect(
      screen.queryByLabelText('대상 로케이션 검색')
    ).not.toBeInTheDocument();
    expect(screen.getByText('B-05-03')).toBeInTheDocument();
    expect(screen.getByLabelText('이동 수량 직접 입력 (낱개)')).toHaveValue(
      '5'
    );
  });

  it('quantity 0 인 ON_HAND 행은 이동 목록에서 제외된다', async () => {
    const contents = {
      locationId: 'l-src',
      locationCode: 'A-01-02',
      warehouseId: 'w-1',
      items: [
        {
          skuId: 's1',
          skuCode: 'CT-001',
          skuName: '코튼셔츠',
          stockState: 'ON_HAND',
          quantity: 12,
          inboundPendingQty: 0,
          generallyMovableQty: 12,
        },
        {
          skuId: 's3',
          skuCode: 'ZR-000',
          skuName: '영수량품',
          stockState: 'ON_HAND',
          quantity: 0,
        },
      ],
    };
    const client: ApiClient = {
      request: (async (opts: {
        path: string;
        method?: string;
        body?: unknown;
      }) => {
        if (opts.path.startsWith('/locations/warehouses/')) {
          if (opts.path.includes('A-01')) {
            return {
              items: [
                {
                  id: 'l-src',
                  code: 'A-01-02',
                  displayName: 'A-01-02',
                  isActive: false,
                  isSystem: false,
                },
              ],
              total: 1,
            };
          }
          return { items: [], total: 0 };
        }
        if (opts.path === '/inventory/stocks/location/l-src') return contents;
        throw new Error(`GET ${opts.path} → 404`);
      }) as unknown as ApiClient['request'],
    };
    renderScreen(client);
    await pickSource();
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.queryByText('영수량품')).not.toBeInTheDocument();
  });

  it('수량을 0 으로 지우면 이동하기가 비활성이다', async () => {
    renderScreen(makeClient([]));
    await pickSource();

    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    await userEvent.type(
      await screen.findByLabelText('대상 로케이션 검색'),
      'B-05'
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /B-05-03/ })
    );

    const sheet = screen.getByRole('dialog', { name: '품목 이동' });
    const backspace = within(sheet).getByRole('button', { name: '지우기' });
    // 12 → 1 → 0
    await userEvent.click(backspace);
    await userEvent.click(backspace);

    await waitFor(() => {
      expect(
        within(sheet).getByRole('button', { name: '이동하기' })
      ).toBeDisabled();
    });
  });

  it('현재 수량을 초과하면 이동하기가 비활성이고 경고를 보여준다', async () => {
    renderScreen(makeClient([]));
    await pickSource();

    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    await userEvent.type(
      await screen.findByLabelText('대상 로케이션 검색'),
      'B-05'
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /B-05-03/ })
    );

    const sheet = screen.getByRole('dialog', { name: '품목 이동' });
    // 12 → 123 (초과)
    await userEvent.click(within(sheet).getByRole('button', { name: '3' }));

    expect(
      await within(sheet).findByText('이동 가능 수량(12)을 초과할 수 없어요.')
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole('button', { name: '이동하기' })
    ).toBeDisabled();
  });
});

it('입고 대기 재고는 이동을 잠그고 SKU와 원위치를 적치 경로에 함께 보낸다', async () => {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const base = makeClient(calls);
  const client: ApiClient = {
    request: async (request) =>
      request.path === '/inventory/stocks/location/l-src'
        ? ({
            ...CONTENTS,
            items: [
              {
                ...CONTENTS.items[0],
                quantity: 10,
                inboundPendingQty: 10,
                generallyMovableQty: 0,
              },
            ],
          } as never)
        : base.request(request),
  };
  renderScreen(client);
  await pickSource();
  expect(await screen.findByRole('button', { name: '이동' })).toBeDisabled();
  const link = screen.getByRole('link', { name: '적치하기' });
  expect(link.getAttribute('href')).toContain('skuId=s1');
  expect(link.getAttribute('href')).toContain('originLocationId=l-src');
  await userEvent.click(screen.getByRole('button', { name: '이동' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});
it('입고 대기와 일반 재고가 섞여 있으면 이동 가능 수량으로 제안하고 상한을 제한한다', async () => {
  const base = makeClient([]);
  const client: ApiClient = {
    request: async (r) =>
      r.path === '/inventory/stocks/location/l-src'
        ? ({
            ...CONTENTS,
            items: [
              {
                ...CONTENTS.items[0],
                quantity: 10,
                inboundPendingQty: 7,
                generallyMovableQty: 3,
              },
            ],
          } as never)
        : base.request(r),
  };
  renderScreen(client);
  await pickSource();
  await userEvent.click(screen.getByRole('button', { name: '이동' }));
  expect(
    await screen.findByLabelText('이동 수량 직접 입력 (낱개)')
  ).toHaveValue('3');
  await userEvent.clear(screen.getByLabelText('이동 수량 직접 입력 (낱개)'));
  await userEvent.type(
    screen.getByLabelText('이동 수량 직접 입력 (낱개)'),
    '4'
  );
  expect(screen.getByRole('button', { name: '이동하기' })).toBeDisabled();
});

it('capability가 없는 서버에서는 새 일반 이동을 열지 않는다', async () => {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  renderScreen(makeClient(calls), true, false);
  await pickSource();
  expect(screen.getByRole('button', { name: '이동' })).toBeDisabled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

for (const change of ['cancel-reopen', 'quantity'] as const) {
  it(`capability 확인 중 ${change} 후 옛 이동 요청을 보내지 않는다`, async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    const f = renderScreen(makeClient(calls));
    await pickSource();
    await userEvent.click(screen.getByRole('button', { name: '이동' }));
    await userEvent.type(
      screen.getByLabelText('대상 로케이션 검색'),
      'B-05-03'
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '이동하기' })).toBeEnabled()
    );
    let release!: (value: { inboundWorkflowConsistency: boolean }) => void;
    const gate = new Promise<{ inboundWorkflowConsistency: boolean }>(
      (resolve) => {
        release = resolve;
      }
    );
    f.runtime.getCapabilities = () => gate;
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '재고 이동' })).getByRole(
        'button',
        { name: '이동' }
      )
    );
    if (change === 'cancel-reopen') {
      await userEvent.click(screen.getByRole('button', { name: '취소' }));
      await userEvent.click(screen.getByRole('button', { name: '이동' }));
    } else
      fireEvent.change(screen.getByLabelText('이동 수량 직접 입력 (낱개)'), {
        target: { value: '4' },
      });
    await act(async () => {
      release({ inboundWorkflowConsistency: true });
      await gate;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    expect(
      screen.getByRole('dialog', { name: '품목 이동' })
    ).toBeInTheDocument();
    if (change === 'quantity')
      expect(screen.getByLabelText('이동 수량 직접 입력 (낱개)')).toHaveValue(
        '4'
      );
  });
}
