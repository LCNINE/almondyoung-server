import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import { ReturnPutawayScreen } from './ReturnPutawayScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const BIN = {
  id: 'b',
  barcode: 'RB-1',
  warehouseId: 'wh',
  items: [{ skuId: 's-1', skuCode: 'C1', skuName: '볼펜', sourceLocationId: 'l-1', locationCode: 'A-01', qty: 1 }],
};

function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: Date.now() })}>
      스캔:{code}
    </button>
  );
}

type Request = { method?: string; path: string; body?: unknown; idempotencyKey?: string };

function mount(request: (o: Request) => Promise<unknown>) {
  const client: ApiClient = { request: request as unknown as ApiClient['request'] };
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="RB-1" />
        <ScanButton code="880" />
        <ScanButton code="A-01" />
        <ScanButton code="Z-99" />
        <ReturnPutawayScreen />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screenRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <WarehouseProvider prefs={prefs}>
        <QueryClientProvider client={new QueryClient()}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </WarehouseProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
  return { user: userEvent.setup() };
}

const lookups = (o: Request): unknown => {
  if (o.path === '/return-bins/RB-1?warehouseId=wh') return BIN;
  if (o.path.startsWith('/inventory/skus?barcode=880')) return [{ id: 's-1', code: 'C1', name: '볼펜' }];
  return undefined;
};

async function toLocationStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '스캔:RB-1' }));
  await screen.findByText('[A-01] 볼펜 1개');
  await user.click(screen.getByRole('button', { name: '스캔:880' }));
  await screen.findByText('A-01 에 넣어 주세요');
}

describe('ReturnPutawayScreen', () => {
  it('바구니 → 상품 → 로케이션을 스캔하면 원래 로케이션에 적치한다', async () => {
    const calls: Request[] = [];
    const { user } = mount(async (o) => {
      calls.push(o);
      if (o.method === 'POST' && o.path === '/return-bins/RB-1/putaways') return { putAwayQty: 1, items: [] };
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await toLocationStep(user);
    await user.click(screen.getByRole('button', { name: '스캔:A-01' }));
    expect(await screen.findByRole('status')).toHaveTextContent('바구니가 비었어요. 다음 바구니를 스캔해 주세요.');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      warehouseId: 'wh',
      barcode: '880',
      locationCode: 'A-01',
      quantity: 1,
    });
  });

  it('다른 로케이션을 스캔하면 서버 거절 문구를 보이고 같은 상품을 계속 기다린다', async () => {
    const { user } = mount(async (o) => {
      if (o.method === 'POST') throw new ConflictError('m', 'RETURN_LOCATION_MISMATCH');
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await toLocationStep(user);
    await user.click(screen.getByRole('button', { name: '스캔:Z-99' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('원래 로케이션이 아니에요. 화면에 보이는 로케이션에 넣어 주세요.');
    expect(screen.getByText('A-01 에 넣어 주세요')).toBeInTheDocument();
  });

  it('배치 복구 중인 물건이면 복구 때까지 바구니에 둔다고 알린다', async () => {
    const { user } = mount(async (o) => {
      if (o.method === 'POST') throw new ConflictError('m', 'PICKING_SESSION_NOT_ACTIVE');
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await toLocationStep(user);
    await user.click(screen.getByRole('button', { name: '스캔:A-01' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('복구가 끝날 때까지 바구니에 두고 관리자에게 문의해 주세요');
  });

  it('바구니에 없는 상품이면 알려 주고 상품을 다시 기다린다', async () => {
    const { user } = mount(async (o) => {
      if (o.path.startsWith('/inventory/skus?barcode=880')) return [{ id: 's-9', code: 'X', name: '다른 상품' }];
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await user.click(await screen.findByRole('button', { name: '스캔:RB-1' }));
    await screen.findByText('[A-01] 볼펜 1개');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이 바구니에 없는 상품이에요.');
  });

  it('결과를 모르는 실패 뒤에는 새 적치 스캔을 받지 않고, 처리 내역 확인이 같은 키로 다시 보낸다', async () => {
    const posts: Request[] = [];
    let fail = true;
    const { user } = mount(async (o) => {
      if (o.method === 'POST') {
        posts.push(o);
        if (fail) {
          fail = false;
          throw new Error('network');
        }
        return { putAwayQty: 1, items: [] };
      }
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await toLocationStep(user);
    await user.click(screen.getByRole('button', { name: '스캔:A-01' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('「처리 내역 확인」');
    await user.click(screen.getByRole('button', { name: '스캔:A-01' }));
    expect(posts).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '처리 내역 확인' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
    expect(await screen.findByRole('status')).toHaveTextContent('바구니가 비었어요');
  });
});
