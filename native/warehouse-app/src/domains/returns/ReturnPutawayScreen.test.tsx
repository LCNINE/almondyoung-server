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
import { createTestWorkRuntime, TestWorkProvider } from '../inbound/__fixtures__/workRuntime';
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

function mount(request: (o: Request) => Promise<unknown>, runtime?: ReturnType<typeof createTestWorkRuntime>) {
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
        <ScanButton code="RB-2" />
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
          {runtime ? (
            <TestWorkProvider runtime={runtime}>
              <ScanProvider>{children}</ScanProvider>
            </TestWorkProvider>
          ) : (
            <ApiClientProvider client={client}>
              <ScanProvider>{children}</ScanProvider>
            </ApiClientProvider>
          )}
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
    // 더 넣을 수 없는 상품이라 위치 단계에 갇히지 않고 상품 단계로 돌아간다.
    expect(await screen.findByText('넣을 상품을 스캔해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('A-01 에 넣어 주세요')).not.toBeInTheDocument();
  });

  it('상품·위치 단계에서 RB- 바코드를 찍으면 그 바구니로 바꾼다', async () => {
    const { user } = mount(async (o) => {
      if (o.path === '/return-bins/RB-2?warehouseId=wh')
        return { ...BIN, id: 'b2', barcode: 'RB-2', items: [{ ...BIN.items[0], skuName: '노트', qty: 3 }] };
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await toLocationStep(user);
    await user.click(screen.getByRole('button', { name: '스캔:RB-2' }));
    expect(await screen.findByText('[A-01] 노트 3개')).toBeInTheDocument();
    expect(screen.getByText('바구니 RB-2')).toBeInTheDocument();
  });

  it('「다른 상품」을 누르면 상품 단계로 돌아간다', async () => {
    const { user } = mount(async (o) => {
      const found = lookups(o);
      if (found !== undefined) return found;
      throw new Error(`unexpected ${o.path}`);
    });
    await toLocationStep(user);
    await user.click(screen.getByRole('button', { name: '다른 상품' }));
    expect(await screen.findByText('넣을 상품을 스캔해 주세요.')).toBeInTheDocument();
  });

  it('재시작 뒤 복원된 적치는 저장된 키로 다시 보내고, 끝나면 바구니에 남은 것을 보인다', async () => {
    const posts: Request[] = [];
    const api = async (o: Request): Promise<unknown> => {
      if (o.method === 'POST') {
        posts.push(o);
        return {
          putAwayQty: 1,
          returnBin: { id: 'b', barcode: 'RB-1', warehouseId: 'wh' },
          items: [{ skuId: 's-2', skuCode: 'C2', skuName: '노트', sourceLocationId: 'l-2', locationCode: 'B-02', qty: 2 }],
        };
      }
      throw new Error(`unexpected ${o.path}`);
    };
    const runtime = createTestWorkRuntime({ request: api as unknown as ApiClient['request'] });
    await runtime.store.draft('fixture:scan:return-putaway', () => [
      { id: 'k-1', data: { binBarcode: 'RB-1', warehouseId: 'wh', productBarcode: '880', locationCode: 'A-01' } },
    ]);
    mount(api, runtime);
    expect(await screen.findByText('[B-02] 노트 2개')).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(posts[0].idempotencyKey).toBe('k-1');
    expect(posts[0].body).toEqual({ warehouseId: 'wh', barcode: '880', locationCode: 'A-01', quantity: 1 });
    expect(await runtime.store.draft('fixture:scan:return-putaway')).toEqual([]);
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
